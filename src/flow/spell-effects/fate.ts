// FA4 — THE PASS. The authoritative redraw resolves immediately, while this
// leaf keeps its new face (and LIMITED count) behind one contained exchange
// until the incoming die reaches the centre stage.
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../../ui/audio.ts';
import { appRoot } from '../../ui/embed.ts';
import { REDUCED } from '../../ui/fx.ts';
import { effectPause, type SpellEffect } from './types.ts';

const PASS_MS = 280;

interface BagVisual {
  count: string;
  empty: boolean;
  gone: readonly boolean[];
}

function bagVisual(bag: HTMLElement | null): BagVisual | null {
  if (!bag || bag.hidden) return null;
  const count = bag.querySelector<HTMLElement>('.bn');
  if (!count) return null;
  return {
    count: count.textContent ?? '',
    empty: bag.classList.contains('empty'),
    gone: [...bag.querySelectorAll<HTMLElement>('.pile .die')]
      .map((die) => die.classList.contains('gone')),
  };
}

function showBagVisual(bag: HTMLElement, visual: BagVisual, pulse: boolean): void {
  const count = bag.querySelector<HTMLElement>('.bn');
  if (count) count.textContent = visual.count;
  bag.classList.toggle('empty', visual.empty);
  bag.querySelectorAll<HTMLElement>('.pile .die').forEach((die, index) => {
    die.classList.toggle('gone', visual.gone[index] ?? false);
  });
  bag.classList.remove('tick');
  if (pulse) {
    void bag.offsetWidth;
    bag.classList.add('tick');
  }
}

function visualDie(source: HTMLElement, className: string): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.classList.add('spell-stage-copy', className);
  clone.removeAttribute('role');
  clone.removeAttribute('aria-label');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.removeProperty('opacity');
  clone.style.removeProperty('visibility');
  return clone;
}

export const fateEffect: SpellEffect = async (_who, _column, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);

  const root = appRoot();
  const stage = root.querySelector<HTMLElement>('#dieStage');
  const oldDie = stage?.querySelector<HTMLElement>(':scope > .die') ?? null;
  /* A cast can be pressed on the same frame the ordinary roll reveals. Its
     320ms pop is roll-owned and must not rotate either FA4 traveller. */
  stage?.classList.remove('pop', 'rolling');
  if (!stage || !oldDie || REDUCED) {
    apply();
    return;
  }

  const generation = S.gen;
  const bag = root.querySelector<HTMLElement>('#bagStack');
  const beforeBag = bagVisual(bag);
  const oldVisual = visualDie(oldDie, 'spell-fate-old');

  /* apply() must run to learn the drawn face. Nothing can paint between this
     synchronous mutation and the visual cover below, so neither that face nor
     the updated bag count is exposed before its arrival beat. */
  apply();
  if (S.gen !== generation) return;

  const newDie = stage.querySelector<HTMLElement>(':scope > .die');
  if (!newDie) return;
  const afterBag = bagVisual(bag);
  if (bag && beforeBag) showBagVisual(bag, beforeBag, false);

  const lane = document.createElement('span');
  lane.className = 'spell-fate-lane';
  lane.setAttribute('aria-hidden', 'true');
  lane.append(oldVisual, visualDie(newDie, 'spell-fate-new'));
  newDie.classList.add('spell-fate-live');
  stage.classList.add('spell-fate-pass');
  stage.appendChild(lane);

  try {
    await effectPause(PASS_MS);
    if (S.gen === generation) {
      newDie.classList.remove('spell-fate-live');
      if (bag && afterBag) {
        showBagVisual(bag, afterBag, beforeBag?.count !== afterBag.count);
      }
    }
  } finally {
    lane.remove();
    newDie.classList.remove('spell-fate-live');
    stage.classList.remove('spell-fate-pass');
  }
};
