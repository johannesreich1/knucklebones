import { modeById } from '../core/modes.ts';
import {
  RUNE_TRIAL_CAPABILITY,
  RUNE_TRIAL_FORMAT,
  rankedOutcomeRoster,
} from '../core/ranked-outcomes.ts';
import { spellById } from '../core/spells.ts';
import { formatNumber, modeCopy, t } from '../i18n/index.ts';
import { Sfx } from '../ui/audio.ts';
import { $, hide } from '../ui/dom.ts';
import { reveal } from '../ui/reveal.ts';
import { cancelTrialSelection } from '../ui/trial-select.ts';
import { isNewcomer, offerTutorial } from '../ui/firstrun.ts';
import { enterMatch } from './play.ts';
import {
  join,
  readyPeer,
  leaveQueue,
  resign,
  resignedOver,
  type JoinResult,
} from './match-api.ts';
import { createQueueCancellation } from './queue-cancellation.ts';
import { createRunGeneration } from './run-generation.ts';
import { showOnlinePanel } from './shell.ts';
import { resolveRankedTrial } from './trial-offer.ts';

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

  const trialWaiting = (deadline: string | null, opponentCommitted: boolean): void => {
    showOnlinePanel('onQueue');
    $('#qSub').removeAttribute('data-i18n');
    $('#qSub').textContent = opponentCommitted
      ? t('online', 'matchmaking.trialBothLocked')
      : t('online', 'matchmaking.trialOpponentChoosing');
    const paint = (): void => {
      const at = deadline ? Date.parse(deadline) : NaN;
      const seconds = Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 0;
      $('#qTime').textContent = queueTime(seconds);
      const message = $('#onQueue .qmsg');
      message.textContent = t('online', 'matchmaking.trialLocked');
    };
    paint();
    if (tick) clearInterval(tick);
    tick = setInterval(paint, 250);
  };

  const hidden = (): void => {
    if (document.hidden && tick) ports.goHome();
  };

  function clearWaiting(): void {
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
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
        const selected = await resolveRankedTrial(result, {
          owns: () => runs.owns(run),
          onWaiting: trialWaiting,
        });
        if (!selected || !runs.owns(run)) return;
        const match = selected;
        clearWaiting();
        if (showReveal) {
          hide('#ovOnline');
          const mine = match.you === 1 ? 'p1' : 'p2';
          const theirs = mine === 'p1' ? 'p2' : 'p1';
          const side = (seat: 'p1' | 'p2') => ({
            name: match.names[seat],
            rating: match.names.ratings?.[seat] ?? null,
            avatar: match.names.avatars?.[seat] ?? null,
          });
          const myRune = spellById(mine === 'p1' ? match.match.p1_rune : match.match.p2_rune);
          const theirRune = spellById(theirs === 'p1' ? match.match.p1_rune : match.match.p2_rune);
          await reveal({
            mode: { id: match.match.format === RUNE_TRIAL_FORMAT
              ? RUNE_TRIAL_FORMAT : modeById(match.match.modifier).id },
            modeCandidates: revealCandidates(match),
            modeCopy: revealCopy,
            trialRunes: match.match.format === RUNE_TRIAL_FORMAT && myRune && theirRune
              ? [
                { spell: myRune, name: () => side(mine).name, hue: 'var(--p1)' },
                { spell: theirRune, name: () => side(theirs).name, hue: 'var(--p2)' },
              ] : undefined,
            me: side(mine),
            foe: side(theirs),
            peer: readyPeer(match.match.id),
          });
          if (!runs.owns(run)) return;
        }
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
