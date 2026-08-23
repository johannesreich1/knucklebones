// Player-visible spell effects. Flow owns legality and authoritative state;
// these leaves choreograph the single apply() beat selected by each rune.
import { AI, ME, type Player } from '../core/rules.ts';
import { Sfx, vibrate } from '../ui/audio.ts';
import { renderSide } from '../ui/game/board.ts';
import { anvilEffect } from './spell-effects/anvil.ts';
import { fateEffect } from './spell-effects/fate.ts';
import { nudgeEffect } from './spell-effects/nudge.ts';
import { pilferEffect } from './spell-effects/pilfer.ts';
import { sunderEffect } from './spell-effects/sunder.ts';
import type { SpellEffect } from './spell-effects/types.ts';
import { wardEffect } from './spell-effects/ward.ts';

const defaultEffect: SpellEffect = async (_who, _column, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  apply();
  renderSide(AI, true);
  renderSide(ME, true);
};

const EFFECTS: Record<string, SpellEffect> = {
  fate: fateEffect,
  nudge: nudgeEffect,
  ward: wardEffect,
  sunder: sunderEffect,
  pilfer: pilferEffect,
  anvil: anvilEffect,
};

export function runSpellEffect(
  id: string,
  who: Player,
  column: number,
  apply: () => void,
): Promise<void> {
  return (EFFECTS[id] ?? defaultEffect)(who, column, apply);
}
