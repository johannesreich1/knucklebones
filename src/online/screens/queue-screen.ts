import { modeById } from '../../core/modes.ts';
import {
  RUNE_TRIAL_CAPABILITY,
  RUNE_TRIAL_FORMAT,
  rankedOutcomeRoster,
} from '../../core/ranked-outcomes.ts';
import { spellById } from '../../core/spells.ts';
import { formatNumber, modeCopy, t } from '../../i18n/index.ts';
import { Sfx } from '../../ui/audio.ts';
import { $, hide } from '../../ui/dom.ts';
import { reveal } from '../../ui/reveal.ts';
import { cancelTrialSelection } from '../../ui/trial-select.ts';
import { isNewcomer, offerTutorial } from '../../ui/firstrun.ts';
import { enterMatch } from '../play/play.ts';
import {
  join,
  readyPeer,
  leaveQueue,
  resign,
  resignedOver,
  type JoinResult,
} from '../api/match-api.ts';
import { createQueueCancellation } from '../api/queue-cancellation.ts';
import { createRunGeneration } from '../api/run-generation.ts';
import { showOnlinePanel } from './shell.ts';
import { resolveRankedTrial } from '../runes/trial-offer.ts';

export interface QueueScreen {
  bind(): void;
  showSearching(): void;
  start(): Promise<void>;
  stop(): void;
}

export interface QueueScreenPorts {
  goHome: () => void;
  startTutorial: () => void;
}

function queueTime(seconds: number): string {
  return formatNumber(Math.floor(seconds / 60), { useGrouping: false }) + ':'
    + formatNumber(seconds % 60, {
      minimumIntegerDigits: 2,
      useGrouping: false,
    });
}

export function createQueueScreen(ports: QueueScreenPorts): QueueScreen {
  const runs = createRunGeneration();
  const cancellation = createQueueCancellation({ leaveQueue, resign, resignedOver });
  let tick: ReturnType<typeof setInterval> | null = null;
  let pendingJoin: Promise<JoinResult | null> | null = null;
  let queueMayExist = false;
  let searchShownAt: number | null = null;

  const revealCandidates = (result: Extract<JoinResult, { status: 'matched' }>) => {
    const tier = result.match.pool_tier;
    if (!tier) return undefined;
    return rankedOutcomeRoster([{
      tier,
      capabilities: result.match.protocol_version === 2 ? [RUNE_TRIAL_CAPABILITY] : [],
    }]).map(({ id }) => ({ id }));
  };

  const revealCopy = (id: string) => id === RUNE_TRIAL_FORMAT
    ? {
      name: t('game', 'modes.runeTrial.name'),
      blurb: t('game', 'modes.runeTrial.blurb'),
    }
    : modeCopy(id);

  /* THE SERVER'S OWN DEADLINE IS THE ESCAPE HATCH, so this is how long past it
     we are willing to sit before deciding nobody is coming. The wait is now
     inside the reveal, which has no cancel button of its own; the queue panel
     it replaced had one, and losing it silently would turn a backend that
     never publishes the second choice into an overlay with no way out. Going
     home is exactly what that button did. */
  const TRIAL_STALL_GRACE_MS = 20000;
  let stall: ReturnType<typeof setTimeout> | null = null;
  const clearStall = (): void => {
    if (stall) clearTimeout(stall);
    stall = null;
  };

  /* The wait for the opponent's private choice happens with the reveal already
     on screen, so it is written INTO the reveal — pulling the player back to
     the queue panel for it would be the second surface this flow just lost. */
  const trialWaiting = (
    note: (text: string | null) => void,
    deadline: string | null,
    opponentCommitted: boolean,
  ): void => {
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
      Math.max(0, (Number.isFinite(at) ? at - Date.now() : 30000)) + TRIAL_STALL_GRACE_MS);
  };

  /* Both public choices, in the seating the reveal reads: mine first, in my
     colour. Null when the row is missing one — the resolver only returns after
     the server has published both, so this is a contract check, not a state. */
  const trialSides = (match: Extract<JoinResult, { status: 'matched' }>) => {
    const mine = match.you === 1 ? 'p1' : 'p2';
    const theirs = mine === 'p1' ? 'p2' : 'p1';
    const rune = (seat: 'p1' | 'p2') =>
      spellById(seat === 'p1' ? match.match.p1_rune : match.match.p2_rune);
    const [myRune, theirRune] = [rune(mine), rune(theirs)];
    if (!myRune || !theirRune) return null;
    return [
      { spell: myRune, name: () => match.names[mine], hue: 'var(--p1)' },
      { spell: theirRune, name: () => match.names[theirs], hue: 'var(--p2)' },
    ] as const;
  };

  const hidden = (): void => {
    if (document.hidden && tick) ports.goHome();
  };

  function clearWaiting(): void {
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    clearStall();
    document.removeEventListener('visibilitychange', hidden);
  }

  function stop(): void {
    runs.cancel();
    cancelTrialSelection();
    clearWaiting();
    searchShownAt = null;
    if (queueMayExist) void cancellation.cleanup();
  }

  /* The ONE looking-state paint. Entry shows it before identity and preference
     checks have resolved, and start() re-issues it when the join loop actually
     begins. Its clock is the VISIBLE one — #qTime and the 7s "inviting" sub
     run from the first paint, and a later call ADOPTS the running clock rather
     than restarting it. Matchmaking policy never reads this clock: the bot
     backfill threshold (docs/LADDER.md) is measured in start()'s join loop. */
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

  async function start(): Promise<void> {
    const previousJoin = pendingJoin;
    const hadRemoteRun = queueMayExist;
    const run = runs.begin();
    clearWaiting();
    /* Tear a replaced run down completely before this generation may enqueue.
       If its join is in flight, the guarded promise performs a second cleanup
       after it settles; waiting here prevents either cleanup landing late and
       deleting the replacement run's queue row. */
    if (hadRemoteRun) await cancellation.cleanup();
    if (previousJoin) await previousJoin.catch(() => null);
    if (!runs.owns(run)) return;
    queueMayExist = false;
    const tutorial = isNewcomer() && await offerTutorial();
    if (!runs.owns(run)) return;
    if (tutorial) {
      ports.goHome();
      ports.startTutorial();
      return;
    }
    showSearching();
    /* The join clock is matchmaking POLICY, not display: the visible timer may
       have been running since entry painted the search, but the bot-backfill
       threshold counts how long this run has actually been enqueued. */
    const joinStarted = Date.now();
    while (runs.owns(run)) {
      const waited = Date.now() - joinStarted;
      queueMayExist = true;
      const request = (async (): Promise<JoinResult | null> => {
        try {
          const settled = await join(waited > 7000);
          if (!runs.owns(run)) {
            await cancellation.cleanup(settled);
            queueMayExist = false;
            return null;
          }
          return settled;
        } catch (error) {
          if (!runs.owns(run)) {
            await cancellation.cleanup();
            queueMayExist = false;
            return null;
          }
          throw error;
        }
      })();
      pendingJoin = request;
      let result: JoinResult | null;
      try {
        result = await request;
      } finally {
        if (pendingJoin === request) pendingJoin = null;
      }
      if (!runs.owns(run)) return;
      if (result?.status === 'incompatible') {
        queueMayExist = false;
        clearWaiting();
        ports.goHome();
        return;
      }
      if (result?.status === 'matched') {
        if (result.rejoined) {
          const over = await resignedOver(result.match.id);
          if (!runs.owns(run)) return;
          if (over) continue;
        }
        const showReveal = !result.rejoined || result.match.phase === 'selection';
        clearWaiting();
        /* The private choice belongs INSIDE the reveal: the dial lands on RUNE
           TRIAL, the three cards open over the mode it just found, and the two
           answers turn over on the same stage. One overlay, one spin, one
           countdown. `match` is what the choice settled on — the reveal cannot
           return it, so the act writes it here. */
        let match = result;
        let abandoned = false;
        let unreadable = false;
        const trialChoice = async (note: (text: string | null) => void) => {
          const selected = await resolveRankedTrial(match, {
            owns: () => runs.owns(run),
            onWaiting: (deadline, committed) => trialWaiting(note, deadline, committed),
          });
          clearWaiting();
          if (!selected || !runs.owns(run)) { abandoned = true; return null; }
          match = selected;
          const sides = trialSides(match);
          /* Two runes this build cannot name are not a reveal we can shorten:
             the board would not be able to hand them out either. Leave the way
             a cancelled selection leaves, rather than entering a match whose
             hands are unreadable. */
          if (!sides) unreadable = true;
          return sides;
        };
        if (showReveal) {
          hide('#ovOnline');
          const mine = match.you === 1 ? 'p1' : 'p2';
          const side = (seat: 'p1' | 'p2') => ({
            name: match.names[seat],
            rating: match.names.ratings?.[seat] ?? null,
            avatar: match.names.avatars?.[seat] ?? null,
          });
          await reveal({
            mode: { id: match.match.format === RUNE_TRIAL_FORMAT
              ? RUNE_TRIAL_FORMAT : modeById(match.match.modifier).id },
            modeCandidates: revealCandidates(match),
            modeCopy: revealCopy,
            trial: match.match.format === RUNE_TRIAL_FORMAT
              ? { resolve: trialChoice } : undefined,
            me: side(mine),
            foe: side(mine === 'p1' ? 'p2' : 'p1'),
            peer: readyPeer(match.match.id),
          });
        } else {
          /* No reveal to run: a rejoin past the selection phase, where the
             resolver only confirms what the server already settled. */
          const settled = await resolveRankedTrial(match, {
            owns: () => runs.owns(run),
            onWaiting: () => undefined,
          });
          if (!settled) return;
          match = settled;
        }
        if (unreadable) { ports.goHome(); return; }
        if (abandoned || !runs.owns(run)) return;
        queueMayExist = false; // ownership moves from the queue to play.ts
        searchShownAt = null; // the next search starts its display clock fresh
        await enterMatch(match);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }

  function bind(): void {
    $('#btnQueueCancel').addEventListener('click', () => {
      Sfx.tap();
      ports.goHome();
    });
  }

  return { bind, showSearching, start, stop };
}
