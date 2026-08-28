// The reveal's last five seconds: the answer has to be READ, not glimpsed.
// Split out of ui/reveal.ts so the shell keeps room for its sequencing; this
// file owns only the countdown, the "I have read it" tap, and the peer wait.
import { formatNumber, t } from '../i18n/index.ts';
import { $ } from './dom.ts';
import { Sfx } from './audio.ts';
import type { DialPeer } from './reveal-types.ts';

/** The live reveal, as far as the hold needs it: one repaint slot to borrow. */
export interface HoldHost {
  repaintHold?: () => void;
}

const HOLD_SECS = 5;

/* A tap says "I have read it" — once everyone has, the wait ends there. */
export function hold(ov: HTMLElement, host: HoldHost, peer?: DialPeer): Promise<void> {
  const count = $('#wheelCount'), hint = $('#wheelHint');
  let left = HOLD_SECS;
  let mine = false;
  let theirs = !peer;                      // nobody to wait for when alone
  const paint = (): void => {
    count.textContent = formatNumber(Math.max(0, left));
    hint.textContent = !mine ? t('game', 'reveal.tapReady')
      : theirs ? t('game', 'reveal.starting') : t('game', 'reveal.readyWaiting');
    ov.classList.toggle('ready', mine);
  };
  host.repaintHold = paint;
  paint();
  return new Promise<void>((resolve) => {
    let ticker = 0, off: (() => void) | null = null;
    const done = (): void => {
      clearInterval(ticker);
      ov.removeEventListener('pointerdown', tap);
      off?.();
      if (host.repaintHold === paint) host.repaintHold = undefined;
      resolve();
    };
    const both = (): void => { if (mine && theirs) done(); };
    function tap(): void {
      if (mine) return;
      mine = true;
      Sfx.tap();
      peer?.announce();
      paint();
      both();
    }
    ticker = setInterval(() => {
      left -= 1;
      paint();
      if (left <= 0) done();
    }, 1000) as unknown as number;
    ov.addEventListener('pointerdown', tap);
    off = peer?.onPeer(() => { theirs = true; paint(); both(); }) ?? null;
  });
}
