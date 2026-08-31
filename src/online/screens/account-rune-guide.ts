// The SILVER handoff teaches the profile's real rune doors. It never creates
// equipment, duplicates the picker, or pretends an empty collection contains a
// default. Players without a rune simply continue; this guide begins only once
// a collected rune makes the existing seat a real door.
import { t } from '../../i18n/index.ts';
import { $ } from '../../ui/dom.ts';

export interface AccountRuneGuideRequest {
  complete(): void;
  cancel(): void;
}

interface InertState {
  readonly element: HTMLElement;
  readonly inert: boolean;
}

interface ActiveGuide {
  readonly request: AccountRuneGuideRequest;
  readonly callout: HTMLElement;
  readonly target: HTMLElement;
  readonly describedBy: string | null;
  readonly inert: readonly InertState[];
}

let active: ActiveGuide | null = null;

function restore(result: 'complete' | 'cancel'): void {
  const closing = active;
  if (!closing) return;
  active = null;
  closing.inert.forEach(({ element, inert }) => { element.inert = inert; });
  closing.target.classList.remove('acc-rune-guide-target');
  if (closing.describedBy === null) closing.target.removeAttribute('aria-describedby');
  else closing.target.setAttribute('aria-describedby', closing.describedBy);
  $('#onAccount').classList.remove('rune-guiding', 'rune-guide-seat');
  closing.callout.remove();
  if (result === 'complete') closing.request.complete();
  else closing.request.cancel();
}

export function cancelAccountRuneGuide(): void {
  restore('cancel');
}

/** Called by the canonical equipped-seat handler before it opens its sheet. */
export function completeAccountRuneSeatGuide(): void {
  if (active) restore('complete');
}

export function repaintAccountRuneGuide(): void {
  if (!active) return;
  active.callout.querySelector<HTMLElement>('.acc-rune-guide-title')!.textContent = t(
    'online', 'profile.runeGuideSeatTitle',
  );
  active.callout.querySelector<HTMLElement>('.acc-rune-guide-body')!.textContent = t(
    'online', 'profile.runeGuideSeatBody',
  );
}

export function startAccountRuneGuide(
  collected: readonly string[],
  request: AccountRuneGuideRequest,
): void {
  cancelAccountRuneGuide();
  if (!collected.length) {
    request.cancel();
    return;
  }
  const panel = $('#onAccount');
  const ring = $('#accRing');
  const seat = $('#accSeat') as HTMLButtonElement;
  const callout = document.createElement('aside');
  callout.id = 'accRuneGuide';
  callout.className = 'acc-rune-guide seat';
  callout.setAttribute('role', 'note');
  callout.innerHTML = '<b class="acc-rune-guide-title" id="accRuneGuideTitle"></b>'
    + '<p class="acc-rune-guide-body" id="accRuneGuideBody"></p>';
  ring.after(callout);

  const head = $('#ovOnline').querySelector<HTMLElement>('.shead');
  const blocks = [
    ...(head ? [head] : []),
    ...[...panel.children].filter((element): element is HTMLElement =>
      element instanceof HTMLElement && element !== callout && element !== ring),
    $('#btnAvatar'),
  ];
  const inert = [...new Set(blocks)].map((element) => ({
    element,
    inert: element.inert,
  }));
  inert.forEach(({ element }) => { element.inert = true; });
  const describedBy = seat.getAttribute('aria-describedby');
  seat.classList.add('acc-rune-guide-target');
  seat.setAttribute('aria-describedby', 'accRuneGuideBody');
  panel.classList.add('rune-guiding', 'rune-guide-seat');
  active = { request, callout, target: seat, describedBy, inert };
  repaintAccountRuneGuide();
  ring.scrollIntoView({ block: 'center' });
  requestAnimationFrame(() => seat.focus({ preventScroll: true }));
}
