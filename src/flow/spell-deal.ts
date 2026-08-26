// Pure resolution of the offline rune pick. Randomness is an explicit input so
// the browser may use Math.random while tests can pin every boundary sample.
import { RANDOM_DUAL_SPELL, RANDOM_SPELL, SPELLS, type SpellSpec } from '../core/spells.ts';

export type SpellDeal = [ai: string, me: string];

function indexFrom(random: () => number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.trunc(random() * count)));
}

export function resolveSpellDeal(
  selected: string,
  random: () => number,
  candidates: readonly SpellSpec[] = SPELLS,
): SpellDeal {
  const roster = [...new Map(candidates.map((spell) => [spell.id, spell])).values()];
  if (selected === RANDOM_DUAL_SPELL) {
    if (roster.length < 2) return ['', ''];
    const firstIndex = indexFrom(random, roster.length);
    /* Choose uniformly among the other n-1 positions by walking at least one
       step around the registry. No retry loop means even a constant random
       source terminates and can never return the first rune twice. */
    const offset = 1 + indexFrom(random, roster.length - 1);
    const secondIndex = (firstIndex + offset) % roster.length;
    return [roster[firstIndex].id, roster[secondIndex].id];
  }
  if (selected === RANDOM_SPELL && !roster.length) return ['', ''];
  const id = selected === RANDOM_SPELL ? roster[indexFrom(random, roster.length)].id : selected;
  if (id && !roster.some((spell) => spell.id === id)) return ['', ''];
  return [id, id];
}
