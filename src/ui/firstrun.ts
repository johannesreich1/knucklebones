// The first-run tutorial offer.
//
// Asked once, before a newcomer's first REAL game — offline or ranked alike,
// so it lives in ui/ and knows about neither. The caller decides what "yes"
// means; this only asks, and only when it is worth asking.
import { S } from '../state.ts';
import { t } from '../i18n/index.ts';
import { $, show, hide } from './dom.ts';
import { Sfx } from './audio.ts';
import { appRoot } from './embed.ts';

/* Nothing to offer somebody who has already played, or who has already been
   taught. Both facts are persisted, so this is a once-in-a-lifetime prompt. */
export const isNewcomer = (): boolean => !S.played && !S.tutDone;

let built = false;
function build(): void {
  if (built) return;
  built = true;
  appRoot().insertAdjacentHTML('beforeend', `
<div class="ov" id="ovFirst">
  <div class="askcard">
    <div class="fh" data-i18n="learn:firstRun.title">${t('learn', 'firstRun.title')}</div>
    <p class="fp" data-i18n="learn:firstRun.body">${t('learn', 'firstRun.body')}</p>
    <button class="btn primary" id="btnFirstYes" data-i18n="learn:firstRun.play">${t('learn', 'firstRun.play')}</button>
    <button class="btn ghost" id="btnFirstNo" data-i18n="learn:firstRun.skip">${t('learn', 'firstRun.skip')}</button>
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
