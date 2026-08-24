// FA4 — THE PASS. The authoritative redraw resolves immediately, while this
// leaf keeps its new face (and LIMITED count) behind one contained exchange
// until the incoming die reaches the centre stage.
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../../ui/audio.ts';
import { appRoot } from '../../ui/embed.ts';
import { REDUCED } from '../../ui/fx.ts';
import { bagLeft, renderBag } from '../../ui/bag.ts';
import { effectPause, type SpellEffect } from './types.ts';

const PASS_MS = 280;

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
  /* what the bag is painting right now — LIMITED's count must not answer the
     redraw before the die itself arrives. -1 in every other mode. */
  const bagBefore = bagLeft();
  const oldVisual = visualDie(oldDie, 'spell-fate-old');

  /* apply() must run to learn the drawn face. Nothing can paint between this
     synchronous mutation and the visual cover below, so neither that face nor
     the updated bag count is exposed before its arrival beat. */
  apply();
  if (S.gen !== generation) return;

  const newDie = stage.querySelector<HTMLElement>(':scope > .die');
  if (!newDie) return;
  const bagAfter = bagLeft();
  const bagMoved = bagAfter !== bagBefore;
  if (bagMoved) renderBag(bagBefore, { silent: true });

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
      /* now, with the die on the stage: the count ticks and the drawn shell
         comes off the top of the pile, exactly as an ordinary roll's would */
      if (bagMoved) renderBag(bagAfter);
    }
  } finally {
    lane.remove();
    newDie.classList.remove('spell-fate-live');
    stage.classList.remove('spell-fate-pass');
  }
};
