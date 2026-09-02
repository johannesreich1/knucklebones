// The detail page behind HOW TO PLAY. Rules, game modes, and spells differ
// only in title and body, so their page chrome and way back live here once.
import { Sfx } from './audio.ts';
import { t, type LocaleKey } from '../i18n/index.ts';
import { $, hide } from './dom.ts';
import { tap } from './tap.ts';
import { pageBackButton } from './page-chrome.ts';

export interface LearnPageSpec {
  id: string;
  title: string;
  /** Static Learn pages can repaint their title through the shared locale root. */
  titleKey?: LocaleKey<'learn'>;
  body: string;
}

export function learnPageMarkup(spec: LearnPageSpec): string {
  return `
<div class="ov paged" id="${spec.id}" data-learn-page>
  <div class="shead">
    ${pageBackButton({
      label: t('common', 'actions.back'),
      attributes: { 'data-learn-back': spec.id },
    })}
    <span class="ttl"${spec.titleKey ? ` data-i18n="learn:${spec.titleKey}"` : ''}>${spec.title}</span><span class="pad"></span>
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
