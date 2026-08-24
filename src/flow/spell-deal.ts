// Pure resolution of the offline rune pick. Randomness is an explicit input so
// the browser may use Math.random while tests can pin every boundary sample.
import { RANDOM_DUAL_SPELL, RANDOM_SPELL, SPELLS } from '../core/spells.ts';

export type SpellDeal = [ai: string, me: string];

function indexFrom(random: () => number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.trunc(random() * count)));
}

export function resolveSpellDeal(selected: string, random: () => number): SpellDeal {
  if (selected === RANDOM_DUAL_SPELL) {
    const firstIndex = indexFrom(random, SPELLS.length);
    /* Choose uniformly among the other n-1 positions by walking at least one
       step around the registry. No retry loop means even a constant random
       source terminates and can never return the first rune twice. */
    const offset = 1 + indexFrom(random, SPELLS.length - 1);
    const secondIndex = (firstIndex + offset) % SPELLS.length;
    return [SPELLS[firstIndex].id, SPELLS[secondIndex].id];
  }
  const id = selected === RANDOM_SPELL ? SPELLS[indexFrom(random, SPELLS.length)].id : selected;
  return [id, id];
}
