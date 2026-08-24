// The detail page behind HOW TO PLAY. Rules, game modes, and spells differ
// only in title and body, so their page chrome and way back live here once.
import { Sfx } from './audio.ts';
import { $, hide } from './dom.ts';
import { tap } from './tap.ts';

export interface LearnPageSpec {
  id: string;
  title: string;
  body: string;
}

export function learnPageMarkup(spec: LearnPageSpec): string {
  return `
<div class="ov paged" id="${spec.id}" data-learn-page>
  <div class="shead">
    <button class="ico" data-learn-back="${spec.id}" aria-label="Back">‹</button>
    <span class="ttl">${spec.title}</span><span class="pad"></span>
  </div>
  <div class="pbody">${spec.body}</div>
</div>`;
}

export function bindLearnPageBack(id: string): void {
  tap($(`[data-learn-back="${id}"]`), () => {
    Sfx.tap();
    hide('#' + id);
  });
}
