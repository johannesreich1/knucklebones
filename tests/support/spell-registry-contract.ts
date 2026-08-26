// Focused registry and picker-promise contracts shared by the spell rules gate.
import {
  SPELLS,
  RANDOM_DUAL_SPELL,
  RANDOM_SPELL,
  spellById,
  freshCharges,
} from '../../src/core/spells.ts';
import { resolveSpellDeal } from '../../src/flow/spell-deal.ts';

type Check = (condition: boolean, message: string, extra?: unknown) => void;

export function checkSpellRegistryContract(check: Check): void {
  const ids = SPELLS.map((spell) => spell.id);
  check(new Set(ids).size === ids.length, 'spell ids must be unique', ids);
  check(!ids.includes('swap'), 'COLUMN SWAP retired 2026-08-21 (70.5% one-sided) — it must not return', ids);
  for (const spell of SPELLS) {
    check(spell.uses >= 1, 'a spell with no uses can never be cast: ' + spell.id, spell.uses);
    check(spell.target === 'column' || spell.target === 'self', 'unknown target kind: ' + spell.id, spell.target);
  }
  check(spellById('nonsense') === null, 'unknown id is null, never a silent fallback');
  check(spellById(null) === null, 'null id is null');
  check(spellById('swap') === null, 'the retired swap must not resolve (persisted picks fall back to NONE)');

  // Picker promises never enter the rune registry or create phantom charges.
  check(spellById(RANDOM_SPELL) === null, 'RANDOM must never resolve to a spell');
  check(spellById(RANDOM_DUAL_SPELL) === null, 'RANDOM ×2 must never resolve to a spell');
  check(!ids.includes(RANDOM_SPELL), 'RANDOM must stay out of the dealt roster', ids);
  check(!ids.includes(RANDOM_DUAL_SPELL), 'RANDOM ×2 must stay out of the dealt roster', ids);
  check(Object.keys(freshCharges(RANDOM_SPELL)).length === 0,
    'RANDOM dealt as itself must give an empty hand, never a phantom charge');
  check(Object.keys(freshCharges(RANDOM_DUAL_SPELL)).length === 0,
    'RANDOM ×2 dealt as itself must give an empty hand, never a phantom charge');

  for (const spell of SPELLS) {
    const hand = freshCharges(spell.id);
    check(hand[spell.id] === spell.uses, 'a hand must deal the picked spell its uses: ' + spell.id, hand);
    check(Object.keys(hand).length === 1, 'a hand holds exactly what was brought: ' + spell.id, hand);
  }
  for (const none of ['', 'nonsense', 'swap', null, undefined]) {
    check(Object.keys(freshCharges(none)).length === 0, 'must deal an empty hand: ' + JSON.stringify(none),
      freshCharges(none));
  }

  // Explicit and old RANDOM stay shared; RANDOM ×2 is ordered [AI, ME],
  // distinct, and a constant stream cannot trigger a retry loop.
  check(String(resolveSpellDeal('ward', () => .9)) === 'ward,ward',
    'an explicit rune must remain shared');
  check(String(resolveSpellDeal(RANDOM_SPELL, () => 0)) === 'fate,fate',
    'shared RANDOM did not resolve its boundary sample once');
  const low = resolveSpellDeal(RANDOM_DUAL_SPELL, () => 0);
  const high = resolveSpellDeal(RANDOM_DUAL_SPELL, () => 1);
  check(low[0] !== low[1] && high[0] !== high[1],
    'RANDOM ×2 returned the same rune twice', { low, high });
  check(low.every((id) => !!spellById(id)) && high.every((id) => !!spellById(id)),
    'RANDOM ×2 returned a picker promise or unknown rune', { low, high });
}
