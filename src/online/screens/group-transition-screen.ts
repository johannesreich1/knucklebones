// LG1 — the ranked result's mandatory living-ladder deck. The result remains
// underneath; one animated group hero always leads, and registry-backed
// feature slides contain only icon, title, and explanatory text.
import { groupRingFill } from '../../core/ladder.ts';
import {
  formatNumber,
  ladderGroupName,
  subscribeLocale,
  t,
} from '../../i18n/index.ts';
import { Sfx } from '../../ui/audio.ts';
import { paintAvatar } from '../../ui/avatar.ts';
import { appRoot, isEmbed } from '../../ui/embed.ts';
import { fit } from '../../ui/layout.ts';
import { ladderRingLayersMarkup } from '../../ui/ladder-ring.ts';
import {
  makeModalBackgroundInert,
  restoreModalBackground,
  type InertSnapshot,
} from '../../ui/modal-background.ts';
import type { GroupTransitionEvent } from '../api/ranked-progression-api.ts';
import { paintGroupTransitionFeature } from './group-transition-feature.ts';
import {
  groupTransitionSlides,
  type GroupTransitionSlide,
} from './group-transition-model.ts';
import { restoreGroupTransitionResultFocus } from './group-transition-focus.ts';

const MARKUP = `<section class="gt-deck" role="dialog" aria-modal="true" tabindex="-1">
  <div class="gt-head"><span class="gt-kicker" id="gtKicker"></span><span class="gt-page" id="gtPage"></span></div>
  <div class="gt-body" id="gtBody"></div>
  <div class="gt-swipe" id="gtSwipe"></div>
  <div class="gt-dots" id="gtDots" role="group"></div>
  <div class="gt-actions">
    <button type="button" class="btn gt-button" id="gtBack"></button>
    <button type="button" class="btn primary gt-button" id="gtNext"></button>
  </div>
  <p class="gt-announcement" id="gtAnnouncement" role="status" aria-live="polite" aria-atomic="true"></p>
</section>`;

interface Presentation {
  readonly event: GroupTransitionEvent;
  readonly slides: readonly GroupTransitionSlide[];
  readonly avatar: string | null | undefined;
  readonly hasCollectedRune: boolean;
  index: number;
  resolve: (result: GroupTransitionResult) => void;
  background: readonly InertSnapshot[];
  opener: HTMLElement | null;
}

export type GroupTransitionResult = 'cancelled' | 'continue' | 'profile';

export interface GroupTransitionOptions {
  /** Unknown or empty fails closed to Continue; Profile never offers a rune
      the latest verified collection did not actually contain. */
  readonly hasCollectedRune?: boolean;
}

export interface GroupTransitionScreen {
  present(
    event: GroupTransitionEvent,
    avatar?: string | null,
    options?: GroupTransitionOptions,
  ): Promise<GroupTransitionResult>;
  cancel(): void;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Group transition requires ${selector}`);
  return found;
}

export function createGroupTransitionScreen(): GroupTransitionScreen {
  const overlay = document.createElement('div');
  overlay.className = 'ov group-transition';
  overlay.id = 'ovGroupTransition';
  overlay.hidden = true;
  overlay.innerHTML = MARKUP;
  const deck = required<HTMLElement>(overlay, '.gt-deck');
  const body = required<HTMLElement>(overlay, '#gtBody');
  const kicker = required<HTMLElement>(overlay, '#gtKicker');
  const page = required<HTMLElement>(overlay, '#gtPage');
  const swipe = required<HTMLElement>(overlay, '#gtSwipe');
  const dots = required<HTMLElement>(overlay, '#gtDots');
  const back = required<HTMLButtonElement>(overlay, '#gtBack');
  const next = required<HTMLButtonElement>(overlay, '#gtNext');
  const announcement = required<HTMLElement>(overlay, '#gtAnnouncement');
  let active: Presentation | null = null;
  let pointer: { id: number; x: number; y: number } | null = null;

  const close = (result: GroupTransitionResult): void => {
    const closing = active;
    if (!closing) return;
    active = null;
    pointer = null;
    overlay.classList.remove('on');
    overlay.hidden = true;
    restoreModalBackground(closing.background);
    fit();
    closing.resolve(result);
    /* Promise continuations run before this queued job. If the owner needs to
       re-lock the result while persisting acknowledgement, the observer below
       waits for that exact lock to clear before restoring keyboard focus. */
    if (result === 'continue') queueMicrotask(() => {
      if (!active) restoreGroupTransitionResultFocus(closing.opener);
    });
  };

  const move = (step: -1 | 1): void => {
    if (!active) return;
    const index = Math.max(0, Math.min(active.slides.length - 1, active.index + step));
    if (index === active.index) return;
    active.index = index;
    Sfx.tap();
    paint();
  };

  const advance = (): void => {
    if (!active) return;
    if (active.index < active.slides.length - 1) {
      move(1);
      return;
    }
    Sfx.tap();
    const slide = active.slides[active.index];
    close(slide.kind === 'rune-seat' && active.hasCollectedRune
      ? 'profile' : 'continue');
  };

  const paintGroup = (
    presentation: Presentation,
    slide: Extract<GroupTransitionSlide, { kind: 'group' }>,
  ): void => {
    const { event } = presentation;
    const promoted = slide.direction === 'promotion';
    deck.className = `gt-deck gt-${slide.direction}`;
    deck.style.setProperty('--gt-tier', `var(--g-${slide.to})`);
    deck.style.setProperty('--gt-old', `var(--g-${slide.from})`);
    kicker.hidden = true;
    kicker.textContent = '';
    body.className = 'gt-body gt-group-body';
    body.innerHTML = `<div class="ringwrap gt-ring">
        ${ladderRingLayersMarkup({ material: true, previousMaterial: true })}
        <span class="gt-avatar"></span>
        <i class="gt-mote"></i><i class="gt-mote"></i><i class="gt-mote"></i>
        <i class="gt-mote"></i><i class="gt-mote"></i><i class="gt-mote"></i>
      </div>
      <span class="gt-overline"></span><h2 class="gt-group" id="gtTitle"></h2>
      <p class="gt-copy" id="gtCopy"></p>`;
    const ring = required<HTMLElement>(body, '.gt-ring');
    ring.style.setProperty('--lr-fill', 'var(--gt-tier)');
    ring.style.setProperty('--lr-material', 'var(--gt-tier)');
    ring.style.setProperty('--lr-previous', 'var(--gt-old)');
    ring.style.setProperty(
      '--lr-fill-glow',
      'color-mix(in srgb,var(--gt-tier) 52%,transparent)',
    );
    ring.style.setProperty(
      '--p',
      String(groupRingFill(event.afterPoints, slide.to === 'neon', event.curveVersion)),
    );
    paintAvatar(required<HTMLElement>(body, '.gt-avatar'), presentation.avatar, 72);
    required<HTMLElement>(body, '.gt-overline').textContent = t('online', promoted
      ? 'groupTransition.promotedTo' : 'groupTransition.demotedTo');
    required<HTMLElement>(body, '#gtTitle').textContent = ladderGroupName(slide.to);
    required<HTMLElement>(body, '#gtCopy').textContent = t('online', promoted
      ? 'groupTransition.promotionBody' : 'groupTransition.demotionBody');
  };

  function paint(): void {
    if (!active) return;
    const slide = active.slides[active.index];
    if (slide.kind === 'group') paintGroup(active, slide);
    else paintGroupTransitionFeature(deck, body, kicker, slide);

    const current = active.index + 1;
    const total = active.slides.length;
    const single = total === 1;
    deck.classList.toggle('gt-single', single);
    swipe.textContent = t('online', 'groupTransition.swipeExplore');
    page.textContent = `${formatNumber(current)} / ${formatNumber(total)}`;
    page.hidden = single;
    const slideLabel = t('online', 'groupTransition.slideLabel', { current, total });
    dots.setAttribute('aria-label', slideLabel);
    dots.replaceChildren(...active.slides.map((_, index) => {
      const dot = document.createElement('i');
      dot.setAttribute('aria-hidden', 'true');
      if (index === active!.index) dot.setAttribute('aria-current', 'true');
      return dot;
    }));
    back.hidden = active.index === 0;
    back.textContent = t('common', 'actions.back');
    const final = active.index === total - 1;
    const opensProfile = final && slide.kind === 'rune-seat' && active.hasCollectedRune;
    next.textContent = opensProfile
      ? t('online', 'groupTransition.openProfile')
      : t('common', final ? 'actions.continue' : 'actions.next');
    swipe.hidden = single;
    deck.setAttribute('aria-label', t('online', 'groupTransition.dialogLabel', {
      from: ladderGroupName(active.event.beforeGroup),
      to: ladderGroupName(active.event.afterGroup),
    }));
    const title = body.querySelector<HTMLElement>('#gtTitle')?.textContent?.trim() ?? '';
    const copy = body.querySelector<HTMLElement>('#gtCopy')?.textContent?.trim() ?? '';
    announcement.textContent = [slideLabel, title, copy].filter(Boolean).join('. ');
    next.focus({ preventScroll: true });
  }

  back.addEventListener('click', () => move(-1));
  next.addEventListener('click', advance);
  deck.addEventListener('pointerdown', (event) => {
    if (!active || !event.isPrimary || event.button !== 0) return;
    /* Capturing a button's pointer retargets WebKit's click to the deck. The
       swipe surface is everything around the controls; buttons keep their
       native click/focus semantics. */
    if (event.target instanceof Element && event.target.closest('button')) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      deck.setPointerCapture?.(event.pointerId);
    } catch {
      /* Synthetic regression pointers are not registered as active in WebKit;
         the same bubbled stream still exercises the gesture without capture. */
    }
  });
  deck.addEventListener('pointerup', (event) => {
    const start = pointer;
    pointer = null;
    if (!active || !start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) advance();
    else move(-1);
  });
  deck.addEventListener('pointercancel', () => { pointer = null; });
  const handleKey = (event: KeyboardEvent): void => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [back, next].filter((control) => !control.hidden);
    if (!controls.length) return;
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    const target = event.shiftKey
      ? controls[(index <= 0 ? controls.length : index) - 1]
      : controls[(index + 1) % controls.length];
    event.preventDefault();
    target.focus({ preventScroll: true });
  };
  if (isEmbed()) appRoot().addEventListener('keydown', handleKey, true);
  else document.addEventListener('keydown', handleKey, true);
  subscribeLocale(() => { if (active) paint(); });

  return {
    present(event, avatar, options = {}): Promise<GroupTransitionResult> {
      const slides = groupTransitionSlides(event);
      if (!slides.length) return Promise.resolve('continue');
      close('cancelled');
      if (!overlay.isConnected) appRoot().appendChild(overlay);
      overlay.hidden = false;
      const opener = document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      return new Promise<GroupTransitionResult>((resolve) => {
        const background = makeModalBackgroundInert(appRoot(), overlay);
        active = {
          event,
          slides,
          avatar,
          hasCollectedRune: options.hasCollectedRune === true,
          index: 0,
          resolve,
          background,
          opener,
        };
        overlay.classList.add('on');
        /* Make the live region part of the visible accessibility tree before
           its initial text mutation; later slide paints are already visible. */
        paint();
        fit();
      });
    },
    cancel(): void { close('cancelled'); },
  };
}
