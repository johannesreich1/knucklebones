// LG1 — the ranked result's mandatory living-ladder deck. The result remains
// underneath; one animated group hero always leads, and registry-backed
// feature slides contain only icon, title, and explanatory text.
import { groupFill } from '../../core/ladder.ts';
import { RUNE_TRIAL_FORMAT, rankedOutcomeById } from '../../core/ranked-outcomes.ts';
import { RANDOM_SPELL } from '../../core/spells.ts';
import {
  formatNumber,
  ladderGroupName,
  modeCopy,
  runeTrialCopy,
  spellCopy,
  subscribeLocale,
  t,
} from '../../i18n/index.ts';
import { Sfx } from '../../ui/audio.ts';
import { paintAvatar } from '../../ui/avatar.ts';
import { appRoot, isEmbed } from '../../ui/embed.ts';
import { fit } from '../../ui/layout.ts';
import {
  makeModalBackgroundInert,
  restoreModalBackground,
  type InertSnapshot,
} from '../../ui/modal-background.ts';
import { modeHue, modeIcon } from '../../ui/modeicons.ts';
import { spellHue, spellIcon } from '../../ui/spellicons.ts';
import type { GroupTransitionEvent } from '../api/ranked-progression-api.ts';
import {
  groupTransitionSlides,
  type GroupTransitionSlide,
} from './group-transition-model.ts';

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
  index: number;
  resolve: (completed: boolean) => void;
  background: readonly InertSnapshot[];
  opener: HTMLElement | null;
}

export interface GroupTransitionScreen {
  present(event: GroupTransitionEvent, avatar?: string | null): Promise<boolean>;
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

  const restoreResultFocus = (closing: Presentation): void => {
    const root = appRoot();
    const result = root.querySelector<HTMLElement>('#ovEnd.on');
    if (!result) return;
    const opener = closing.opener && root.contains(closing.opener)
      ? closing.opener : null;
    const candidates = [
      ...result.querySelectorAll<HTMLElement>('#btnAgain, #btnEndQuiet'),
      ...(opener ? [opener] : []),
    ];
    const focus = (): boolean => {
      if (!result.classList.contains('on')) return true;
      if (result.inert) return false;
      const target = candidates.find((candidate) => candidate.isConnected
        && !candidate.inert && !candidate.hasAttribute('disabled')
        && candidate.getClientRects().length > 0);
      if (!target) return true;
      target.focus({ preventScroll: true });
      return true;
    };
    if (focus()) return;

    /* Result persistence may briefly make the restored screen inert again
       after present() resolves. Follow that explicit state instead of racing
       it with a timeout, then focus the first usable result action. */
    const observer = new MutationObserver(() => {
      if (!focus()) return;
      observer.disconnect();
    });
    observer.observe(result, { attributes: true, attributeFilter: ['class', 'inert'] });
  };

  const close = (completed: boolean): void => {
    const closing = active;
    if (!closing) return;
    active = null;
    pointer = null;
    overlay.classList.remove('on');
    overlay.hidden = true;
    restoreModalBackground(closing.background);
    fit();
    closing.resolve(completed);
    /* Promise continuations run before this queued job. If the owner needs to
       re-lock the result while persisting acknowledgement, the observer below
       waits for that exact lock to clear before restoring keyboard focus. */
    if (completed) queueMicrotask(() => {
      if (!active) restoreResultFocus(closing);
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

  const paintGroup = (
    presentation: Presentation,
    slide: Extract<GroupTransitionSlide, { kind: 'group' }>,
  ): void => {
    const { event } = presentation;
    const promoted = slide.direction === 'promotion';
    deck.className = `gt-deck gt-${slide.direction}`;
    deck.style.setProperty('--gt-tier', `var(--g-${slide.to})`);
    deck.style.setProperty('--gt-old', `var(--g-${slide.from})`);
    kicker.textContent = t('online', promoted
      ? 'groupTransition.newGroup' : 'groupTransition.groupChanged');
    body.className = 'gt-body gt-group-body';
    body.innerHTML = `<div class="ringwrap gt-ring">
        <i class="lring"></i><i class="gt-tierhalo"></i><i class="gt-oldarc"></i><i class="gt-orbit"></i>
        <span class="gt-avatar"></span>
        <i class="gt-mote"></i><i class="gt-mote"></i><i class="gt-mote"></i>
        <i class="gt-mote"></i><i class="gt-mote"></i><i class="gt-mote"></i>
      </div>
      <span class="gt-overline"></span><h2 class="gt-group" id="gtTitle"></h2>
      <p class="gt-copy" id="gtCopy"></p><div class="gt-step"></div>`;
    const ring = required<HTMLElement>(body, '.gt-ring');
    ring.style.setProperty('--p1', 'var(--gt-tier)');
    ring.style.setProperty('--p', slide.to === 'neon' ? '1' : String(groupFill(event.afterPoints)));
    paintAvatar(required<HTMLElement>(body, '.gt-avatar'), presentation.avatar, 72);
    required<HTMLElement>(body, '.gt-overline').textContent = t('online', promoted
      ? 'groupTransition.promotedTo' : 'groupTransition.demotedTo');
    required<HTMLElement>(body, '#gtTitle').textContent = ladderGroupName(slide.to);
    required<HTMLElement>(body, '#gtCopy').textContent = t('online', promoted
      ? 'groupTransition.promotionBody' : 'groupTransition.demotionBody');
    const step = required<HTMLElement>(body, '.gt-step');
    const before = document.createElement('span');
    before.textContent = `${formatNumber(event.beforePoints)} ${ladderGroupName(slide.from)}`;
    const delta = document.createElement('i');
    const change = event.afterPoints - event.beforePoints;
    delta.textContent = `${change >= 0 ? '+' : '−'}${formatNumber(Math.abs(change))}`;
    const after = document.createElement('b');
    after.textContent = `${formatNumber(event.afterPoints)} ${ladderGroupName(slide.to)}`;
    step.replaceChildren(before, delta, after);
    swipe.textContent = t('online', promoted
      ? 'groupTransition.swipeExplore' : 'groupTransition.swipeChanges');
  };

  const paintOutcome = (
    slide: Extract<GroupTransitionSlide, { kind: 'outcome' }>,
  ): void => {
    const outcome = rankedOutcomeById(slide.outcomeId);
    const trial = outcome.id === RUNE_TRIAL_FORMAT;
    const copy = trial ? runeTrialCopy() : modeCopy(outcome.id);
    const hue = modeHue(trial ? RUNE_TRIAL_FORMAT : outcome.id);
    deck.className = 'gt-deck gt-feature-deck';
    deck.style.setProperty('--gt-tier', hue);
    deck.style.setProperty('--gt-old', hue);
    kicker.textContent = t('online', 'groupTransition.newMode');
    body.className = 'gt-body gt-feature-body';
    body.innerHTML = `<span class="gt-feature-icon" aria-hidden="true"></span><h2 id="gtTitle"></h2><p id="gtCopy"></p>`;
    const icon = required<HTMLElement>(body, '.gt-feature-icon');
    icon.style.setProperty('--gt-accent', hue);
    icon.innerHTML = modeIcon(trial ? RUNE_TRIAL_FORMAT : outcome.id, 46);
    required<HTMLElement>(body, '#gtTitle').textContent = copy.name;
    required<HTMLElement>(body, '#gtCopy').textContent = copy.blurb;
    swipe.textContent = t('online', 'groupTransition.swipeOrButtons');
  };

  const paintEquipment = (
    presentation: Presentation,
    slide: Extract<GroupTransitionSlide, { kind: 'equipped-rune' }>,
  ): void => {
    const random = presentation.event.randomRuneMode;
    const id = random ? RANDOM_SPELL : presentation.event.equippedRune!;
    const copy = spellCopy(id);
    const activeNow = slide.state === 'active';
    const hue = spellHue(id);
    deck.className = 'gt-deck gt-feature-deck gt-equipment-deck';
    deck.style.setProperty('--gt-tier', hue);
    deck.style.setProperty('--gt-old', hue);
    kicker.textContent = t('online', 'groupTransition.whatChanges');
    body.className = 'gt-body gt-feature-body';
    body.innerHTML = `<span class="gt-feature-icon" aria-hidden="true"></span><h2 id="gtTitle"></h2><p id="gtCopy"></p>`;
    const icon = required<HTMLElement>(body, '.gt-feature-icon');
    icon.style.setProperty('--gt-accent', hue);
    icon.innerHTML = spellIcon(id, 46);
    required<HTMLElement>(body, '#gtTitle').textContent = t('online', activeNow
      ? 'groupTransition.runeActiveTitle' : 'groupTransition.runeRestingTitle');
    required<HTMLElement>(body, '#gtCopy').textContent = t('online', random
      ? activeNow ? 'groupTransition.randomActiveBody' : 'groupTransition.randomRestingBody'
      : activeNow ? 'groupTransition.runeActiveBody' : 'groupTransition.runeRestingBody',
    { rune: copy.name });
    swipe.textContent = t('online', 'groupTransition.swipeOrButtons');
  };

  function paint(): void {
    if (!active) return;
    const slide = active.slides[active.index];
    if (slide.kind === 'group') paintGroup(active, slide);
    else if (slide.kind === 'outcome') paintOutcome(slide);
    else paintEquipment(active, slide);

    const current = active.index + 1;
    const total = active.slides.length;
    page.textContent = `${formatNumber(current)} / ${formatNumber(total)}`;
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
    next.textContent = t('common', final ? 'actions.continue' : 'actions.next');
    swipe.hidden = total === 1;
    deck.setAttribute('aria-label', t('online', 'groupTransition.dialogLabel', {
      from: ladderGroupName(active.event.beforeGroup),
      to: ladderGroupName(active.event.afterGroup),
    }));
    const title = body.querySelector<HTMLElement>('#gtTitle')?.textContent?.trim() ?? '';
    const copy = body.querySelector<HTMLElement>('#gtCopy')?.textContent?.trim() ?? '';
    announcement.textContent = [slideLabel, title, copy].filter(Boolean).join('. ');
    requestAnimationFrame(() => {
      if (active) next.focus({ preventScroll: true });
    });
  }

  back.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => {
    if (!active) return;
    if (active.index < active.slides.length - 1) move(1);
    else {
      Sfx.tap();
      close(true);
    }
  });
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
    move(dx < 0 ? 1 : -1);
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
    present(event, avatar): Promise<boolean> {
      const slides = groupTransitionSlides(event);
      if (!slides.length) return Promise.resolve(true);
      close(false);
      if (!overlay.isConnected) appRoot().appendChild(overlay);
      overlay.hidden = false;
      const opener = document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      return new Promise<boolean>((resolve) => {
        const background = makeModalBackgroundInert(appRoot(), overlay);
        active = { event, slides, avatar, index: 0, resolve, background, opener };
        overlay.classList.add('on');
        /* Make the live region part of the visible accessibility tree before
           its initial text mutation; later slide paints are already visible. */
        paint();
        fit();
      });
    },
    cancel(): void { close(false); },
  };
}
