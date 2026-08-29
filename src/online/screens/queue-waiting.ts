// The queue's ONE visible clock, and the two waits it paints: looking for an
// opponent on the queue panel, and — with the reveal already on screen — the
// opponent's private Rune Trial choice. Both states drive that single
// interval, so changing state can never leave two tickers repainting one
// readout, and the stall timeout that rescues a wait with no answer belongs
// to the same owner as the clock it is watching.
import { formatNumber, t } from '../../i18n/index.ts';
import { $ } from '../../ui/dom.ts';
import { showOnlinePanel } from './shell.ts';
import { RUNE_TRIAL_PICK_SECS } from '../../core/rune-trial-offer.ts';

export interface QueueWaitingPorts {
  goHome: () => void;
}

export interface QueueWaiting {
  showSearching(): void;
  trialWaiting(
    note: (text: string | null) => void,
    deadline: string | null,
    opponentCommitted: boolean,
  ): void;
  /** Stop the ticker, the stall timeout and the visibility watch. The display
      clock keeps its start, so a search re-entered after this adopts the
      running time instead of restarting at 0:00. */
  clear(): void;
  /** Forget when the search became visible, so the next one starts at 0:00. */
  reset(): void;
}

function queueTime(seconds: number): string {
  return formatNumber(Math.floor(seconds / 60), { useGrouping: false }) + ':'
    + formatNumber(seconds % 60, {
      minimumIntegerDigits: 2,
      useGrouping: false,
    });
}

/* THE SERVER'S OWN DEADLINE IS THE ESCAPE HATCH, so this is how long past it
   we are willing to sit before deciding nobody is coming. The wait is now
   inside the reveal, which has no cancel button of its own; the queue panel
   it replaced had one, and losing it silently would turn a backend that
   never publishes the second choice into an overlay with no way out. Going
   home is exactly what that button did. */
const TRIAL_STALL_GRACE_MS = 20000;

export function createQueueWaiting(ports: QueueWaitingPorts): QueueWaiting {
  let tick: ReturnType<typeof setInterval> | null = null;
  let stall: ReturnType<typeof setTimeout> | null = null;
  let searchShownAt: number | null = null;

  const clearStall = (): void => {
    if (stall) clearTimeout(stall);
    stall = null;
  };

  /* ONE closure for the instance, not one per paint: addEventListener dedupes
     by reference, so re-arming costs nothing while a fresh function per call
     would stack listeners. It watches for the looking state only — clear()
     takes it off before the reveal opens, which is why the Trial wait below
     leaves a backgrounded app where it stands instead of sending it home. */
  const hidden = (): void => {
    if (document.hidden && tick) ports.goHome();
  };

  function clear(): void {
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    clearStall();
    document.removeEventListener('visibilitychange', hidden);
  }

  function reset(): void {
    searchShownAt = null;
  }

  /* The ONE looking-state paint. Entry shows it before identity and preference
     checks have resolved, and the queue run re-issues it when the join loop
     actually begins. Its clock is the VISIBLE one — #qTime and the 7s
     "inviting" sub run from the first paint, and a later call ADOPTS the
     running clock rather than restarting it. Matchmaking policy never reads
     this clock: the bot backfill threshold (docs/LADDER.md) is measured in the
     join loop. */
  function showSearching(): void {
    searchShownAt ??= Date.now();
    const shownAt = searchShownAt;
    showOnlinePanel('onQueue');
    document.addEventListener('visibilitychange', hidden);
    const message = $('#onQueue .qmsg');
    message.setAttribute('data-i18n', 'online:matchmaking.looking');
    message.textContent = t('online', 'matchmaking.looking');
    $('#qSub').removeAttribute('data-i18n');
    $('#qSub').innerHTML = '&nbsp;';
    const paint = (): void => {
      const seconds = Math.floor((Date.now() - shownAt) / 1000);
      $('#qTime').textContent = queueTime(seconds);
      if (seconds >= 7) {
        $('#qSub').setAttribute('data-i18n', 'online:matchmaking.inviting');
        $('#qSub').textContent = t('online', 'matchmaking.inviting');
      }
    };
    paint();
    if (tick) clearInterval(tick);
    tick = setInterval(paint, 250);
  }

  /* The wait for the opponent's private choice happens with the reveal already
     on screen, so it is written INTO the reveal — pulling the player back to
     the queue panel for it would be the second surface this flow just lost. */
  function trialWaiting(
    note: (text: string | null) => void,
    deadline: string | null,
    opponentCommitted: boolean,
  ): void {
    const at = deadline ? Date.parse(deadline) : NaN;
    const paint = (): void => {
      const seconds = Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 0;
      note(`${opponentCommitted
        ? t('online', 'matchmaking.trialBothLocked')
        : t('online', 'matchmaking.trialOpponentChoosing')} · ${queueTime(seconds)}`);
    };
    paint();
    if (tick) clearInterval(tick);
    tick = setInterval(paint, 250);
    /* Armed ONCE for the whole wait, deliberately: this repaints on every
       refresh, and re-arming there would push the deadline out by a grace
       period roughly once a second and never fire. */
    stall ??= setTimeout(() => ports.goHome(),
      Math.max(0, (Number.isFinite(at) ? at - Date.now() : RUNE_TRIAL_PICK_SECS * 1000))
        + TRIAL_STALL_GRACE_MS);
  }

  return { showSearching, trialWaiting, clear, reset };
}
