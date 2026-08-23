// NU1 — THE PIP LANDS. The shell stays planted; only the canonical face cells
// that differ between the old and new values are allowed to move.
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../../ui/audio.ts';
import { appRoot } from '../../ui/embed.ts';
import { REDUCED } from '../../ui/fx.ts';
import { diePipDiff } from '../../ui/die-markup.ts';
import { effectPause, type SpellEffect } from './types.ts';

const REWRITE_MS = 420;

function markPip(pips: readonly HTMLElement[], cell: number, className: string): void {
  pips[cell]?.classList.add(className);
}

export const nudgeEffect: SpellEffect = async (_who, _column, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);

  const stage = appRoot().querySelector<HTMLElement>('#dieStage');
  const oldValue = S.die;
  /* The ordinary reveal pop may still be finishing when the player presses
     NUDGE. NU1 owns a stationary shell, so retire that earlier transform
     before the pip rewrite begins. */
  stage?.classList.remove('pop', 'rolling');
  if (!stage || REDUCED) {
    apply();
    return;
  }

  const generation = S.gen;
  apply();
  if (S.gen !== generation) return;

  const newValue = S.die;
  const die = stage.querySelector<HTMLElement>(':scope > .die');
  if (!die || oldValue === newValue) return;

  const diff = diePipDiff(oldValue, newValue);
  const pips = [...die.querySelectorAll<HTMLElement>(':scope > .pip')];
  diff.shared.forEach((cell) => markPip(pips, cell, 'spell-nudge-shared'));
  diff.removed.forEach((cell) => {
    pips[cell]?.classList.add('on', 'spell-nudge-removed');
  });
  diff.added.forEach((cell) => markPip(pips, cell, 'spell-nudge-added'));

  const newNumber = die.querySelector<HTMLElement>(':scope > .num');
  const oldNumber = newNumber?.cloneNode(false) as HTMLElement | undefined;
  if (newNumber && oldNumber) {
    oldNumber.textContent = String(oldValue);
    oldNumber.classList.add('spell-nudge-number-old');
    oldNumber.setAttribute('aria-hidden', 'true');
    newNumber.classList.add('spell-nudge-number-new');
    die.appendChild(oldNumber);
  }
  die.classList.add('spell-nudge-rewrite');

  try {
    await effectPause(REWRITE_MS);
  } finally {
    oldNumber?.remove();
    newNumber?.classList.remove('spell-nudge-number-new');
    diff.shared.forEach((cell) => pips[cell]?.classList.remove('spell-nudge-shared'));
    diff.removed.forEach((cell) => {
      pips[cell]?.classList.remove('on', 'spell-nudge-removed');
    });
    diff.added.forEach((cell) => pips[cell]?.classList.remove('spell-nudge-added'));
    die.classList.remove('spell-nudge-rewrite');
  }
};
