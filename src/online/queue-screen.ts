import { modeById } from '../core/modes.ts';
import { Sfx } from '../ui/audio.ts';
import { $, hide } from '../ui/dom.ts';
import { reveal } from '../ui/reveal.ts';
import { isNewcomer, offerTutorial } from '../ui/firstrun.ts';
import { newGame } from '../flow/game.ts';
import { enterMatch } from './play.ts';
import { join, readyPeer, leaveQueue, resignedOver } from './match-api.ts';
import { showOnlinePanel } from './shell.ts';

export interface QueueScreen {
  bind(): void;
  start(): Promise<void>;
  stop(): void;
}

export function createQueueScreen(goHome: () => void): QueueScreen {
  let aborted = false;
  let tick: ReturnType<typeof setInterval> | null = null;

  const hidden = (): void => {
    if (document.hidden && !aborted) goHome();
  };

  function stop(): void {
    aborted = true;
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    document.removeEventListener('visibilitychange', hidden);
    leaveQueue();
  }

  async function start(): Promise<void> {
    if (isNewcomer() && await offerTutorial()) {
      goHome();
      newGame({ tutorial: true });
      return;
    }
    showOnlinePanel('onQueue');
    aborted = false;
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
    while (!aborted) {
      const waited = Date.now() - started;
      const result = await join(waited > 7000);
      if (aborted) break;
      if (result?.status === 'matched') {
        if (result.rejoined && await resignedOver(result.match.id)) continue;
        stop();
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
        }
        await enterMatch(result);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    stop();
  }

  function bind(): void {
    $('#btnQueueCancel').addEventListener('click', () => {
      Sfx.tap();
      goHome();
    });
  }

  return { bind, start, stop };
}
