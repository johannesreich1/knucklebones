import { modeById } from '../core/modes.ts';
import { Sfx } from '../ui/audio.ts';
import { $, hide } from '../ui/dom.ts';
import { reveal } from '../ui/reveal.ts';
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

export interface QueueScreen {
  bind(): void;
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
  let tick: ReturnType<typeof setInterval> | null = null;
  let pendingJoin: Promise<JoinResult | null> | null = null;
  let queueMayExist = false;

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
    clearWaiting();
    if (queueMayExist) void cancellation.cleanup();
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
    showOnlinePanel('onQueue');
    document.addEventListener('visibilitychange', hidden);
    const started = Date.now();
    $('#qTime').textContent = '0:00';
    $('#qSub').innerHTML = '&nbsp;';
    if (tick) clearInterval(tick);
    tick = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      $('#qTime').textContent = Math.floor(seconds / 60) + ':'
        + String(seconds % 60).padStart(2, '0');
      if (seconds >= 7) $('#qSub').textContent = 'Inviting anyone available…';
    }, 250);
    while (runs.owns(run)) {
      const waited = Date.now() - started;
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
      if (result?.status === 'matched') {
        if (result.rejoined) {
          const over = await resignedOver(result.match.id);
          if (!runs.owns(run)) return;
          if (over) continue;
        }
        clearWaiting();
        if (!result.rejoined) {
          hide('#ovOnline');
          const mine = result.you === 1 ? 'p1' : 'p2';
          const theirs = mine === 'p1' ? 'p2' : 'p1';
          const side = (seat: 'p1' | 'p2') => ({
            name: result.names[seat],
            rating: result.names.ratings?.[seat] ?? null,
            avatar: result.names.avatars?.[seat] ?? null,
          });
          await reveal({
            mode: modeById(result.match.modifier),
            me: side(mine),
            foe: side(theirs),
            peer: readyPeer(result.match.id),
          });
          if (!runs.owns(run)) return;
        }
        queueMayExist = false; // ownership moves from the queue to play.ts
        await enterMatch(result);
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

  return { bind, start, stop };
}
