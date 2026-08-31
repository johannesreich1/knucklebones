import { Sfx } from '../../ui/audio.ts';
import { $ } from '../../ui/dom.ts';
import { cancelTrialSelection } from '../../ui/trial-select.ts';
import { isNewcomer, offerTutorial } from '../../ui/firstrun.ts';
import { RUNE_TRIAL_FORMAT } from '../../core/ranked-outcomes.ts';
import { enterMatch } from '../play/play.ts';
import { join, type JoinResult } from '../api/match-api.ts';
import { resign, resignedOver } from '../api/match-resignation.ts';
import { createQueueCancellation } from '../api/queue-cancellation.ts';
import { leaveQueue } from '../api/queue-lifecycle.ts';
import { createRunGeneration } from '../api/run-generation.ts';
import { createQueueWaiting } from './queue-waiting.ts';
import {
  rankedRevealSides,
  revealPairing,
  revealRankedMatch,
  trialRevealSides,
} from './queue-reveal.ts';
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

export function createQueueScreen(ports: QueueScreenPorts): QueueScreen {
  const runs = createRunGeneration();
  const cancellation = createQueueCancellation({ leaveQueue, resign, resignedOver });
  const waiting = createQueueWaiting({ goHome: () => ports.goHome() });
  let pendingJoin: Promise<JoinResult | null> | null = null;
  let queueMayExist = false;

  function stop(): void {
    runs.cancel();
    cancelTrialSelection();
    waiting.clear();
    waiting.reset();
    if (queueMayExist) void cancellation.cleanup();
  }

  async function start(): Promise<void> {
    const previousJoin = pendingJoin;
    const hadRemoteRun = queueMayExist;
    const run = runs.begin();
    /* Only the ticker stops here. The display clock keeps running, so a search
       this run re-enters reads on from where the player last saw it. */
    waiting.clear();
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
    waiting.showSearching();
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
        waiting.clear();
        ports.goHome();
        return;
      }
      if (result?.status === 'matched') {
        /* Rejoins deliberately skip the fresh-match theatre, so the reveal
           cannot be their validator. Reject an unknown non-null standard rune
           here for BOTH entry paths; shortening it to an empty hand would make
           this build replay a different match from the server. Legacy missing
           fields and explicit null remain honest empty seats. */
        if (result.match.format !== RUNE_TRIAL_FORMAT && !rankedRevealSides(result)) {
          waiting.clear();
          ports.goHome();
          return;
        }
        if (result.rejoined) {
          const over = await resignedOver(result.match.id);
          if (!runs.owns(run)) return;
          if (over) continue;
        }
        const showReveal = !result.rejoined || result.match.phase === 'selection';
        waiting.clear();
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
            onWaiting: (deadline, committed) => waiting.trialWaiting(note, deadline, committed),
            pairing: revealPairing(match),
          });
          waiting.clear();
          if (!selected || !runs.owns(run)) { abandoned = true; return null; }
          match = selected;
          const sides = trialRevealSides(match);
          /* Two runes this build cannot name are not a reveal we can shorten:
             the board would not be able to hand them out either. Leave the way
             a cancelled selection leaves, rather than entering a match whose
             hands are unreadable. */
          if (!sides) unreadable = true;
          return sides;
        };
        if (showReveal) {
          if (!await revealRankedMatch(match, trialChoice)) unreadable = true;
        } else {
          /* No reveal to run: a rejoin past the selection phase, where the
             resolver only confirms what the server already settled. */
          const settled = await resolveRankedTrial(match, {
            owns: () => runs.owns(run),
            onWaiting: () => undefined,
          });
          if (!settled) return;
          match = settled;
          /* This rejoin deliberately skips the reveal, so it must perform the
             Trial reveal's strict registry check itself. `resolveRankedTrial`
             only establishes that both server seats are strings; an unknown
             future id cannot be shortened to an empty hand at table entry. */
          if (!trialRevealSides(match)) unreadable = true;
        }
        if (unreadable) { ports.goHome(); return; }
        if (abandoned || !runs.owns(run)) return;
        queueMayExist = false; // ownership moves from the queue to play.ts
        waiting.reset();       // the next search starts its display clock fresh
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

  return { bind, showSearching: () => waiting.showSearching(), start, stop };
}
