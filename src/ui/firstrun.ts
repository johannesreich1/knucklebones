// The first-run tutorial offer.
//
// Asked once, before a newcomer's first REAL game — offline or ranked alike,
// so it lives in ui/ and knows about neither. The caller decides what "yes"
// means; this only asks, and only when it is worth asking.
import { S } from '../state.ts';
import { $, show, hide } from './dom.ts';
import { Sfx } from './audio.ts';

/* Nothing to offer somebody who has already played, or who has already been
   taught. Both facts are persisted, so this is a once-in-a-lifetime prompt. */
export const isNewcomer = (): boolean => !S.played && !S.tutDone;

let built = false;
function build(): void {
  if (built) return;
  built = true;
  document.body.insertAdjacentHTML('beforeend', `
<div class="ov" id="ovFirst">
  <div class="firstcard">
    <div class="fh">First time?</div>
    <p class="fp">The tutorial is one guided game — five lessons, played rather than read.
       It takes about a minute, and you only ever see this once.</p>
    <button class="btn primary" id="btnFirstYes">Play the tutorial</button>
    <button class="btn ghost" id="btnFirstNo">Skip, I know the rules</button>
  </div>
</div>`);
}

/* resolves TRUE when the player wants the tutorial. Never rejects: a newcomer
   who taps past this must land in the game they asked for. */
export function offerTutorial(): Promise<boolean> {
  build();
  show('#ovFirst');
  return new Promise<boolean>((resolve) => {
    const done = (yes: boolean) => () => {
      Sfx.tap();
      hide('#ovFirst');
      resolve(yes);
    };
    const yes = $('#btnFirstYes') as HTMLButtonElement;
    const no = $('#btnFirstNo') as HTMLButtonElement;
    yes.onclick = done(true);
    no.onclick = done(false);
  });
}
