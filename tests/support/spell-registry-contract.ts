// Focused registry and picker-promise contracts shared by the spell rules gate,
// plus the DECLARATIONS the registry makes about itself — the flags other code
// trusts without re-deriving. Those are checked against real behaviour rather
// than read off the source, which is the only reading worth having.
import {
  SPELLS,
  RANDOM_DUAL_SPELL,
  RANDOM_SPELL,
  spellById,
  freshCharges,
  type CastCtx,
  type SpellSpec,
} from '../../src/core/spells.ts';
import {
  AI, CLASSIC, ME, SPEC, emptyBoard, freshCharm,
  type GameState, type Mode, type Player,
} from '../../src/core/rules.ts';
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


/**
 * The registry's self-declarations, each checked against what it actually does.
 *
 * These flags are read by code that cannot re-derive them — ranked decides
 * whether it may paint a cast at tap time purely from `drawsFromSupply` — so a
 * declaration that stops matching behaviour is not a stale comment, it is a
 * screen showing an outcome the server never committed.
 */
export function checkSpellDeclarations(check: Check): void {
  /* ---- WHO DRAWS IS DECLARED, AND THE DECLARATION IS CHECKED ----
     core holds no randomness of its own: the die supply arrives as
     CastCtx.draw. A spell that never reaches it is fully determined by (state,
     seat, column, die), so a client running this same registry computes the
     committed row exactly — which is what lets online/play paint the whole rune
     the moment it is tapped. A spell that started drawing without saying so
     would silently become unpredictable on a screen that had already painted
     its outcome.

     So do not read the flag off the source — POISON THE SUPPLY and see who
     reaches for it. Every spell is cast against a draw() that records being
     called, on a board arranged so the cast is legal; reaching it must mean the
     flag says so, and the flag saying so must mean it is reached. */
  for (const spell of SPELLS) {
    const st = [emptyBoard(), emptyBoard()] as GameState;
    /* Both halves filled enough that a column cast has something to act on, and
       the caster's own column is FULL so ANVIL's "only a column you can no
       longer place into" is satisfied. */
    st[ME][0] = [2, 4, 6];
    st[AI][0] = [3, 5, 1];
    st[ME][1] = [1];
    st[AI][1] = [1];
    let reached = false;
    const ctx: CastCtx = {
      mode: CLASSIC as Mode, die: 3, setDie() {},
      draw: () => { reached = true; return 4; },
      bagLeft: null, charm: freshCharm(),
    };
    const col = spell.target === 'self' ? 0 : firstLegalColumn(spell, st, ME, ctx);
    if (col === null) {
      check(false, `no legal column to cast ${spell.id} for this check`, spell.id);
      continue;
    }
    /* Legality is the caller's job, not this check's: a throw from deep inside
       apply() still answers the only question here, which is whether draw() was
       reached. */
    try { spell.apply(structuredClone(st), ME, col, ctx); } catch { /* see above */ }
    check(reached === !!spell.drawsFromSupply,
      `${spell.id} ${reached
        ? 'draws from the supply without declaring it — ranked would paint an '
          + 'outcome it cannot predict'
        : 'declares drawsFromSupply but never draws'}`,
      { id: spell.id, declared: !!spell.drawsFromSupply, reached });
  }

  /* ---- AIM-TIME LOCKS ARE DECLARATIVE ----
     Every completed cast is final. ANVIL is the one earlier commitment: its aim
     marks reveal the exact die before a column is chosen, so the registry must
     declare both the commitment and the die-level preview that explains it.
     PILFER locks the question without spending its charge until it is answered. */
  for (const spell of SPELLS) {
    if (!spell.commitsOnAim) continue;
    check(spell.target === 'column' && typeof spell.previewDieIndex === 'function',
      'a spell that commits while aiming must show the exact board target: ' + spell.id);
  }
  check(spellById('anvil')?.commitsOnAim === true,
    'ANVIL markings commit before column selection');
  check(spellById('pilfer')?.locksOnAim === true && !spellById('pilfer')?.commitsOnAim,
    'PILFER aim locks until answered but spends only on a legal target');
}

function firstLegalColumn(
  spell: SpellSpec, st: GameState, who: Player, ctx: CastCtx,
): number | null {
  for (let col = 0; col < SPEC.cols; col++) if (spell.legal(st, who, col, ctx)) return col;
  return null;
}
