// REPAINTING A REVEAL THAT IS ALREADY ON SCREEN.
//
// Changing language mid-sequence must not restart the theatre: the dial is
// still turning, a card may be mid-flip, and the countdown is running against a
// real deadline. So nothing here replaces a node — every function finds the
// element that is already there and writes its text again.
//
// Split out of reveal.ts by ownership: that module sequences the beats, this
// one owns what their words say once they are on screen. The anti-spoiler rule
// travels with the words, which is why `landed` is consulted here too — a beat
// that has not landed has no answer to print, in any language.
import { formatNumber, t } from '../i18n/index.ts';
import type { ActiveReveal, Beat, DialSide } from './reveal-types.ts';

function repaintRating(side: Element | null, player?: DialSide): void {
  const rating = side?.querySelector<HTMLElement>('.rt');
  if (rating && player?.rating != null) rating.textContent = formatNumber(player.rating);
}

/** Paint the prompt and its optional recipient without replacing either node. */
export function repaintTitle(ov: HTMLElement, beat: Beat): void {
  const title = ov.querySelector<HTMLElement>('#wheelTitle');
  const copy = title?.querySelector<HTMLElement>('.wtitlecopy');
  const owner = title?.querySelector<HTMLElement>('#wheelOwner');
  const ownerName = owner?.querySelector<HTMLElement>('.wownername');
  const context = beat.context;
  if (copy) copy.textContent = beat.label;
  if (!title || !owner || !ownerName) return;
  title.classList.toggle('has-owner', !!context);
  owner.hidden = !context;
  ownerName.textContent = context ?? '';
  if (context) owner.style.color = beat.contextHue ?? beat.hue;
  else owner.style.removeProperty('color');
}

/**
 * Repaint only locale-owned text in the live reveal. Theatre markup, settled
 * cards, avatars, listeners, and WAAPI animations remain the exact same nodes.
 */
export function repaintReveal(context: ActiveReveal): void {
  const { ov, beats } = context;
  const beat = beats[context.activeIndex];
  if (!beat) return;

  const who = ov.querySelector<HTMLElement>('#wheelWho');
  const versusLabel = who?.querySelector<HTMLElement>('.dvs');
  if (versusLabel) versusLabel.textContent = t('common', 'versus');
  repaintRating(who?.querySelector('.dside.me') ?? null, context.me);
  repaintRating(who?.querySelector('.dside.foe') ?? null, context.foe);

  repaintTitle(ov, beat);
  const stage = ov.querySelector<HTMLElement>('#wheelStage');
  if (stage) beat.repaintStage?.(stage);

  /* A bare beat prints neither line, and hides the elements rather than
     emptying them: an empty .wname still holds its own height, which would
     leave the cards floating above a gap that reads as a missing answer. */
  const nameLine = ov.querySelector<HTMLElement>('#wheelName');
  const blurbLine = ov.querySelector<HTMLElement>('#wheelBlurb');
  if (nameLine) nameLine.hidden = !!beat.bare;
  if (blurbLine) blurbLine.hidden = !!beat.bare;
  if (context.landed && !beat.bare) {
    const currentName = ov.querySelector<HTMLElement>('#wheelName .wcopy');
    const currentBlurb = ov.querySelector<HTMLElement>('#wheelBlurb');
    if (currentName) currentName.textContent = beat.name;
    if (currentBlurb) currentBlurb.textContent = beat.blurb;
  }

  const settledStrip = ov.querySelector<HTMLElement>('#wheelSettled');
  if (settledStrip) settledStrip.hidden = !!beat.bare;
  ov.querySelectorAll<HTMLElement>('#wheelSettled .wsett').forEach((answer, index) => {
    const settledBeat = beats[index];
    if (!settledBeat) return;
    const name = answer.querySelector<HTMLElement>('.wpill b');
    const owner = answer.querySelector<HTMLElement>('.wownername');
    const blurb = answer.querySelector<HTMLElement>('.wblurb');
    if (name) name.textContent = settledBeat.name;
    if (owner && settledBeat.context) owner.textContent = settledBeat.context;
    if (blurb) blurb.textContent = settledBeat.blurb;
  });
  context.repaintHold?.();
}
