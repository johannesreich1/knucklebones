import { effectiveLocale, subscribeLocale } from '../i18n/index.ts';
import { LEGAL_RELEASE } from '../legal/config.ts';
import { legalLocaleContent } from '../legal/content.ts';
import { legalDocument } from '../legal/documents.ts';
import { legalPageSpec } from '../legal/registry.ts';
import { escapeHtml, renderLegalDocumentBody } from '../legal/render.ts';
import { LEGAL_PAGE_IDS, type LegalPageId } from '../legal/types.ts';
import { Sfx } from './audio.ts';
import { hide, show } from './dom.ts';
import { appRoot } from './embed.ts';
import { whenPageMotionSettled } from './page-motion.ts';
import {
  makeModalBackgroundInert,
  restoreModalBackground,
  type InertSnapshot,
} from './modal-background.ts';

interface OpenLegalPage {
  readonly page: LegalPageId;
  readonly opener: HTMLElement | null;
  readonly inert: readonly InertSnapshot[];
  readonly overlayInert: boolean;
}

let active: OpenLegalPage | null = null;

function isPageId(value: string | undefined): value is LegalPageId {
  return value !== undefined && LEGAL_PAGE_IDS.includes(value as LegalPageId);
}

function renderRelatedNavigation(page: LegalPageId): string {
  const locale = effectiveLocale();
  const content = legalLocaleContent(locale);
  return `<nav class="legal-related" data-legal-navigation aria-label="${escapeHtml(content.pageNavigationLabel)}">
    ${LEGAL_PAGE_IDS.filter((candidate) => candidate !== page).map((candidate) =>
      `<button class="linkbtn" data-legal-open="${candidate}">${escapeHtml(content.pages[candidate].shortTitle)}</button>`).join('')}
  </nav>`;
}

function renderPage(page: LegalPageId, preserveScroll = false): HTMLElement {
  const locale = effectiveLocale();
  const content = legalLocaleContent(locale);
  const spec = legalPageSpec(page);
  const overlay = appRoot().querySelector<HTMLElement>(`#ov${spec.domSuffix}`)!;
  const body = overlay.querySelector<HTMLElement>('[data-legal-body]')!;
  const oldScroll = preserveScroll ? body.scrollTop : 0;
  const focused = document.activeElement instanceof HTMLElement && body.contains(document.activeElement)
    ? document.activeElement
    : null;
  const focusedPage = focused?.dataset.legalOpen;
  const headingFocused = focused?.tagName === 'H1';
  overlay.querySelector<HTMLElement>('[data-legal-title]')!.textContent = content.pages[page].shortTitle;
  overlay.querySelector<HTMLElement>('[data-legal-close]')!
    .setAttribute('aria-label', content.backLabel);
  body.innerHTML = renderLegalDocumentBody(
    legalDocument(locale, page, LEGAL_RELEASE.facts, LEGAL_RELEASE.status),
  )
    + renderRelatedNavigation(page);
  const heading = body.querySelector('h1')!;
  heading.id = `legal-${page}-heading`;
  body.scrollTop = oldScroll;
  if (preserveScroll && headingFocused) heading.focus({ preventScroll: true });
  else if (preserveScroll && isPageId(focusedPage)) {
    body.querySelector<HTMLElement>(`[data-legal-open="${focusedPage}"]`)?.focus({ preventScroll: true });
  }
  return overlay;
}

function focusHeading(overlay: HTMLElement): void {
  void whenPageMotionSettled(appRoot()).then(() => {
    if (overlay.classList.contains('on') && !overlay.inert) {
      overlay.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    }
  });
}

export function openLegalPage(page: LegalPageId, opener?: HTMLElement | null): void {
  const originalOpener = active?.opener ?? opener
    ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if (active) {
    const previous = legalPageSpec(active.page);
    const previousOverlay = appRoot().querySelector<HTMLElement>(`#ov${previous.domSuffix}`)!;
    hide(`#${previousOverlay.id}`);
    restoreModalBackground(active.inert);
    previousOverlay.inert = active.overlayInert;
    active = null;
  }
  const overlay = renderPage(page);
  /* A sheet below us may already have made every existing app child inert.
     Legal is a nested modal in that case: wake only this overlay, then put it
     back exactly as it was when the player returns to the sheet. */
  const overlayInert = overlay.inert;
  overlay.inert = false;
  const inert = makeModalBackgroundInert(appRoot(), overlay);
  active = { page, opener: originalOpener, inert, overlayInert };
  show(`#${overlay.id}`);
  focusHeading(overlay);
}

export function closeOpenLegalPage(restoreFocus = true): boolean {
  if (!active) return false;
  const closing = active;
  active = null;
  const overlay = appRoot().querySelector<HTMLElement>(`#ov${legalPageSpec(closing.page).domSuffix}`)!;
  hide(`#${overlay.id}`);
  restoreModalBackground(closing.inert);
  overlay.inert = closing.overlayInert;
  if (restoreFocus && closing.opener?.isConnected) {
    void whenPageMotionSettled(appRoot()).then(() => {
      const opener = closing.opener;
      const owner = opener?.closest<HTMLElement>('.ov');
      if (!active && opener?.isConnected && !opener.closest('[inert]')
          && (!owner || owner.classList.contains('on'))) {
        opener.focus({ preventScroll: true });
      }
    });
  }
  return true;
}

export function refreshLegalUi(root: HTMLElement): void {
  const locale = effectiveLocale();
  const content = legalLocaleContent(locale);
  root.querySelectorAll<HTMLElement>('[data-legal-navigation]').forEach((navigation) => {
    navigation.setAttribute('aria-label', content.pageNavigationLabel);
  });
  root.querySelectorAll<HTMLElement>('[data-legal-open]').forEach((button) => {
    if (isPageId(button.dataset.legalOpen)) {
      button.textContent = content.pages[button.dataset.legalOpen].shortTitle;
    }
  });
  if (active) renderPage(active.page, true);
}

export function bindLegalPages(root: HTMLElement): void {
  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const open = target?.closest<HTMLElement>('[data-legal-open]');
    if (open && isPageId(open.dataset.legalOpen)) {
      Sfx.tap();
      openLegalPage(open.dataset.legalOpen, open);
      return;
    }
    if (target?.closest('[data-legal-close]')) {
      Sfx.tap();
      closeOpenLegalPage();
    }
  });
  subscribeLocale(() => refreshLegalUi(root));
  refreshLegalUi(root);
}
