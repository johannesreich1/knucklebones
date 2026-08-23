// Player-visible spell effects. The flow owns legality and state transitions;
// this leaf owns only the animation around the registry's apply() beat.
import { AI, ME, SPEC, type Player } from '../core/rules.ts';
import { S } from '../state.ts';
import { colEl, faceRotated, slotEl, slotIdx } from '../ui/dom.ts';
import { appRoot } from '../ui/embed.ts';
import { Sfx, vibrate } from '../ui/audio.ts';
import { REDUCED, burst, flash, fxRoot, pin, shake } from '../ui/fx.ts';
import { spellHue } from '../ui/spellicons.ts';
import { renderSide } from '../ui/game/board.ts';
import { colorOf } from '../ui/identity.ts';
import { animateStageRoll } from '../ui/game/motion.ts';

type SpellEffect = (who: Player, col: number, apply: () => void) => Promise<void>;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const defaultEffect: SpellEffect = async (_who, _col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  apply();
  renderSide(AI, true);
  renderSide(ME, true);
};

/* FATE re-rolls the die on its stage: a short rattle, then the drawn face
   pops — the same language rollDice speaks, shortened. */
const fateEffect: SpellEffect = async (who, _col, apply) => {
  const stage = appRoot().querySelector<HTMLElement>('#dieStage');
  Sfx.spell();
  vibrate([10, 30, 14]);
  const gen = S.gen;
  const die = await animateStageRoll({
    who,
    durationMs: 330,
    tickMs: 55,
    leadingTick: true,
    scramble: !REDUCED,
    playRollSound: false,
    vibrateOnReveal: false,
    isCurrent: () => S.gen === gen,
    resolveDie: () => { apply(); return S.die; },
  });
  if (die !== null && stage) {
    const rect = stage.getBoundingClientRect();
    burst(rect.left + rect.width / 2, rect.top + rect.height / 2, spellHue('fate'), 12);
  }
};

/* NUDGE ticks the face where it stands. */
const nudgeEffect: SpellEffect = async (_who, _col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  apply();
  const stage = appRoot().querySelector<HTMLElement>('#dieStage');
  if (stage) {
    stage.classList.add('pop');
    setTimeout(() => stage.classList.remove('pop'), 320);
    const rect = stage.getBoundingClientRect();
    burst(rect.left + rect.width / 2, rect.top + rect.height / 2, spellHue('nudge'), 10);
  }
  await wait(REDUCED ? 0 : 200);
};

/* WARD lands its mark on the column chip — the repaint pops it in. */
const wardEffect: SpellEffect = async (who, col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  apply();
  renderSide(who, true);
  const rect = colEl(who, col)?.getBoundingClientRect();
  if (rect) burst(rect.left + rect.width / 2, rect.top + rect.height / 2, spellHue('ward'), 14);
  await wait(REDUCED ? 0 : 260);
};

/* SUNDER charges the die in hand: the strike happens on placement. */
const sunderEffect: SpellEffect = async (_who, _col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  apply();
  const stage = appRoot().querySelector<HTMLElement>('#dieStage');
  if (stage) {
    stage.classList.add('sundered');
    const rect = stage.getBoundingClientRect();
    burst(rect.left + rect.width / 2, rect.top + rect.height / 2, spellHue('sunder'), 14);
  }
  shake(4);
  await wait(REDUCED ? 0 : 200);
};

/* PILFER: the stolen die physically crosses the centre line. */
const pilferEffect: SpellEffect = async (who, col, apply) => {
  const foe = (1 - who) as Player;
  Sfx.spell();
  vibrate([10, 30, 14]);
  const sourceIndex = S.boards[foe][col].length - 1;
  const targetIndex = S.boards[who][col].length;
  const source = slotEl(foe, col, slotIdx(foe, sourceIndex))?.firstElementChild as HTMLElement | null;
  const target = slotEl(who, col, slotIdx(who, targetIndex));
  if (!REDUCED && source && target) {
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.classList.toggle('p2flip', faceRotated(who));
    pin(ghost, from);
    fxRoot().appendChild(ghost);
    source.style.visibility = 'hidden';
    const animation = ghost.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: `translate(${(to.left - from.left) / 2}px,${(to.top - from.top) / 2}px) scale(1.12) rotate(8deg)`, offset: .5 },
      { transform: `translate(${to.left - from.left}px,${to.top - from.top}px) scale(1) rotate(0deg)` },
    ], { duration: 420, easing: 'cubic-bezier(.55,.05,.25,1)', fill: 'both' });
    await animation.finished.catch(() => undefined);
    apply();
    renderSide(who, true);
    renderSide(foe, true);
    revealColumn(who, col);
    revealColumn(foe, col);
    ghost.remove();
  } else {
    apply();
    renderSide(who, true);
    renderSide(foe, true);
    revealColumn(who, col);
    revealColumn(foe, col);
  }
  for (const player of [who, foe] as Player[]) {
    const rect = colEl(player, col)?.getBoundingClientRect();
    if (rect) burst(rect.left + rect.width / 2, rect.top + rect.height / 2, colorOf(player), 12);
  }
  Sfx.mult();
  shake(5);
  flash(0.18);
};

/* ANVIL recasts the registry-selected lowest die where it lies. */
const anvilEffect: SpellEffect = async (who, col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  const column = S.boards[who][col];
  let at = 0;
  for (let i = 1; i < column.length; i++) if (column[i] < column[at]) at = i;
  apply();
  renderSide(who, true);
  const die = slotEl(who, col, slotIdx(who, at))?.firstElementChild as HTMLElement | null;
  const rect = die?.getBoundingClientRect();
  if (die && !REDUCED) {
    await die.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.35) rotate(-6deg)', offset: .45 },
      { transform: 'scale(1)' },
    ], { duration: 320, easing: 'cubic-bezier(.2,1.5,.4,1)' }).finished.catch(() => undefined);
  }
  if (rect) burst(rect.left + rect.width / 2, rect.top + rect.height / 2, spellHue('anvil'), 14);
  Sfx.mult();
  shake(4);
  await wait(REDUCED ? 0 : 180);
};

const EFFECTS: Record<string, SpellEffect> = {
  fate: fateEffect,
  nudge: nudgeEffect,
  ward: wardEffect,
  sunder: sunderEffect,
  pilfer: pilferEffect,
  anvil: anvilEffect,
};

export function runSpellEffect(id: string, who: Player, col: number, apply: () => void): Promise<void> {
  return (EFFECTS[id] ?? defaultEffect)(who, col, apply);
}

/* A repaint may reuse the hidden source node; clear every surviving die. */
function revealColumn(who: Player, col: number): void {
  for (let i = 0; i < SPEC.rows; i++) {
    const die = slotEl(who, col, slotIdx(who, i))?.firstElementChild as HTMLElement | null;
    if (die) die.style.visibility = '';
  }
}
