import { Sfx } from './audio.ts';
import { hide, show } from './dom.ts';
import { appRoot } from './embed.ts';
import {
  makeModalBackgroundInert,
  restoreModalBackground,
  type InertSnapshot,
} from './modal-background.ts';

type LegalPageId = 'imprint' | 'privacy';

interface OpenLegalPage {
  readonly page: LegalPageId;
  readonly opener: HTMLElement | null;
  readonly inert: readonly InertSnapshot[];
  readonly overlayInert: boolean;
}

let active: OpenLegalPage | null = null;

function isPageId(value: string | undefined): value is LegalPageId {
  return value === 'imprint' || value === 'privacy';
}

function overlayFor(page: LegalPageId): HTMLElement {
  return appRoot().querySelector<HTMLElement>(`[data-legal-page="${page}"]`)!;
}

export function openLegalPage(page: LegalPageId, opener?: HTMLElement | null): void {
  const originalOpener = active?.opener ?? opener
    ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  if (active) closeOpenLegalPage(false);
  const overlay = overlayFor(page);
  const overlayInert = overlay.inert;
  overlay.inert = false;
  const inert = makeModalBackgroundInert(appRoot(), overlay);
  active = { page, opener: originalOpener, inert, overlayInert };
  show(`#${overlay.id}`);
  requestAnimationFrame(() => overlay.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }));
}

export function closeOpenLegalPage(restoreFocus = true): boolean {
  if (!active) return false;
  const closing = active;
  active = null;
  const overlay = overlayFor(closing.page);
  hide(`#${overlay.id}`);
  restoreModalBackground(closing.inert);
  overlay.inert = closing.overlayInert;
  if (restoreFocus && closing.opener?.isConnected) {
    requestAnimationFrame(() => closing.opener?.focus({ preventScroll: true }));
  }
  return true;
}

/** The draft navigation has no locale-owned controls to repaint yet. */
export function refreshLegalUi(_root: HTMLElement): void {
  // Kept as the shared seam used by the stable auth panel and app shell.
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
}
