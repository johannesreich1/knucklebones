import { LEGAL_RELEASE } from '../legal/config.ts';
import { legalLocaleContent } from '../legal/content.ts';
import { assertLegalPublicationReady } from '../legal/documents.ts';
import { LEGAL_PAGE_REGISTRY, legalPageSpec } from '../legal/registry.ts';
import {
  LEGAL_PAGE_IDS,
  type LegalPageId,
  type LegalPublicationConfig,
} from '../legal/types.ts';

const initial = legalLocaleContent('en');

export interface LegalNavigationSpec {
  readonly pages: readonly LegalPageId[];
  readonly className: string;
  readonly idPrefix: string;
}

/**
 * Every public door is emitted through the same fail-closed release gate.
 * Keeping the config injectable lets tests exercise the ready contract while
 * the checked-in production facts remain a draft.
 */
export function legalNavigationMarkup(
  config: LegalPublicationConfig,
  spec: LegalNavigationSpec,
): string {
  if (config.status === 'draft') return '';
  assertLegalPublicationReady(config);
  return `<nav class="${spec.className}" data-legal-navigation aria-label="${initial.pageNavigationLabel}">
    ${spec.pages.map((id) => {
      const { domSuffix } = legalPageSpec(id);
      return `<button type="button" class="linkbtn" id="${spec.idPrefix}${domSuffix}" data-legal-open="${id}">${initial.pages[id].shortTitle}</button>`;
    }).join('\n    ')}
  </nav>`;
}

export const LEGAL_HOME_NAV_MARKUP = legalNavigationMarkup(LEGAL_RELEASE, {
  pages: LEGAL_PAGE_IDS,
  className: 'viewfoot legal-home-nav',
  idPrefix: 'btn',
});

export const LEGAL_SETTINGS_NAV_MARKUP = legalNavigationMarkup(LEGAL_RELEASE, {
  pages: ['imprint', 'privacy'],
  className: 'legal-settings-nav',
  idPrefix: 'btnSettings',
});

export const LEGAL_AUTH_NAV_MARKUP = legalNavigationMarkup(LEGAL_RELEASE, {
  pages: ['privacy'],
  className: 'authlegal',
  idPrefix: 'btnAuth',
});

/**
 * The overlays stay in the shared shell so a reviewed ready build can expose
 * them without a second implementation. Draft builds contain no navigation
 * to them, and the static generator emits no public route.
 */
export const LEGAL_MARKUP = LEGAL_PAGE_REGISTRY.map(({ id, domSuffix }) => {
  const title = initial.pages[id].shortTitle;
  const headingId = `legal-${id}-heading`;
  return `<div class="ov paged legal-page" id="ov${domSuffix}" data-legal-page="${id}"
    role="dialog" aria-modal="true" aria-labelledby="${headingId}">
    <div class="shead">
      <button class="ico" id="btn${domSuffix}Back" data-legal-close
        aria-label="${initial.backLabel}">‹</button>
      <span class="ttl" data-legal-title>${title}</span><span class="pad"></span>
    </div>
    <div class="pbody" data-legal-body></div>
  </div>`;
}).join('\n');
