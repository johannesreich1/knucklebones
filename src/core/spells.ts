// SPELLS — an optional layer of one-use powers over local play.
//
// One registry entry is one whole spell rule: what a cast needs, how many
// casts a player gets, which targets are legal, what it does, and how a
// machine weighs it (cpuCast). Player-visible copy is keyed by the stable id
// in the localization catalogs; core remains locale-free. Adding a spell is
// adding an object here (plus its localized copy, icon path in
// src/ui/spellicons.ts, and cast animation in src/flow/spell-effects.ts).
//
// Pure, like the rest of core/: plain data in, plain data out. No DOM, no
// timers, no randomness — the supply is handed in as behaviour (CastCtx.draw),
// so offline brings Math.random and a future ranked deal brings the seeded
// stream, and a replay stays deterministic by construction. RANKED PLAY NEVER
// CASTS today, by decision (docs/STATUS.md §6): flow/spells deals ranked an
// empty hand, and the server validates by replaying plain move logs.
//
// The first roster (COLUMN SWAP) retired 2026-08-21: tools/spellsim.ts
// measured a one-sided holder at 70.5% in classic and 81.8% under
// SINGLESTRIKE. This roster measured 53–61% under the same harness.
import { BOUNTY, COLSHIELD, SPEC, cloneCharm, isShielded, type CharmSt, type Player } from './rules.ts';
import { DICE_FACES } from '../config.ts';
import type { CastCtx, SpellSpec } from './spell-types.ts';
import { bestTarget, colScoreOf, immediatePlacementGain, placeGain } from './spell-policy.ts';

export type { CastCtx, SpellSpec } from './spell-types.ts';
export {
  bestTarget,
  immediatePlacementGain,
  machineCast,
  machineCastPlan,
  placeGain,
  swingOf,
} from './spell-policy.ts';
export type { ImmediatePlacementOptions, MachineCastPlan } from './spell-policy.ts';

/* FATE: throw the die in hand back, draw another. Touches nothing but the
   caster's own hand — the floor of the power range (sim: 56.1% one-sided at
   two casts). In LIMITED the redraw consumes from the same finite bag (the
   discard does not return), so the game ends one die sooner: the cost is
   real there, and legality refuses the cast when nothing is left to draw. */
const FATE: SpellSpec = {
  id: 'fate',
  target: 'self',
  uses: 2,
  /* The redraw reveals the live supply. Like every committed cast it cannot
     be put back; in LIMITED that also means the discarded die stays spent. */
  legal(st, who, col, ctx) {
    return !!ctx && ctx.bagLeft !== 0;
  },
  apply(st, who, col, ctx) {
    ctx!.setDie(ctx!.draw());
  },
  cpuCast(st, who, ctx, demand) {
    let mean = 0;
    for (let f = 1; f <= DICE_FACES; f++) mean += placeGain(st, who, f, ctx.mode) / DICE_FACES;
    // a hand far below the average roll is worth throwing back
    return mean - placeGain(st, who, ctx.die, ctx.mode) >= demand / 4 ? -1 : null;
  },
};

/* NUDGE: the die in hand ticks up one pip, 6 wrapping to 1. Bounded, self-
   side, deterministic — the wrap is what keeps "always cast on anything below
   6" from being free. ONE cast: at two the sim measured 61.3% one-sided, at
   one 53.9%. */
const NUDGE: SpellSpec = {
  id: 'nudge',
  target: 'self',
  uses: 1,
  legal(st, who, col, ctx) {
    return !!ctx;
  },
  apply(st, who, col, ctx) {
    ctx!.setDie(ctx!.die % DICE_FACES + 1);
  },
  cpuCast(st, who, ctx, demand) {
    const up = ctx.die % DICE_FACES + 1;
    return placeGain(st, who, up, ctx.mode) - placeGain(st, who, ctx.die, ctx.mode) >= demand / 3 ? -1 : null;
  },
};

/* WARD: one of the caster's own columns absorbs the next strike that would
   take dice there, then burns out. Cast in anticipation, never in reaction —
   the mark just sits in the charm until destruction consults it (core/rules
   applyMove / openStrikes). A strike with no victims costs the ward nothing. */
const WARD: SpellSpec = {
  id: 'ward',
  target: 'column',
  side: 'own',
  uses: 1,
  legal(st, who, col, ctx) {
    if (!ctx || !Number.isInteger(col) || col < 0 || col >= SPEC.cols) return false;
    // A COLUMN SHIELD column is already untouchable, so a ward on it would
    // spend the charge and buy nothing — the same reason a second ward on
    // one column is refused. Not an error to report: a target you cannot pick.
    if (isShielded(st[who][col], ctx.mode)) return false;
    return ctx.charm.wards[who][col] === 0;    // one ward per column — a second buys nothing
  },
  apply(st, who, col, ctx) {
    ctx!.charm.wards[who][col]++;
  },
  cpuCast(st, who, ctx, demand) {
    // guard the fattest column an enemy placement can still reach
    const foe = (1 - who) as Player;
    let bestC: number | null = null, bestV = 0;
    for (let c = 0; c < SPEC.cols; c++) {
      if (!this.legal(st, who, c, ctx)) continue;
      if (isShielded(st[who][c], ctx.mode)) continue;          // already safe
      if (st[foe][c].length >= SPEC.rows) continue;            // no strike can come
      const v = colScoreOf(st[who][c]);
      if (v > bestV) { bestV = v; bestC = c; }
    }
    return bestV >= demand * 1.5 ? bestC : null;
  },
  cpuForbiddenPlacements(st, who, castTarget, ctx) {
    /* Filling the warded column immediately makes it permanently untouchable
       in COLUMN SHIELD, so the fresh ward would never be able to help. */
    return ctx.mode === COLSHIELD && st[who][castTarget].length === SPEC.rows - 1
      ? [castTarget]
      : [];
  },
};

/* SUNDER: the placement that follows this cast strikes EVERY enemy column
   holding its face, not just the facing one. The power is earned by the die
   actually in hand. The mark lives exactly one placement: a cast happens
   inside the caster's own turn, and their placement consumes it
   (core/rules openStrikes). */
function armedSunderCharm(ctx: CastCtx, who: Player): CharmSt {
  const charm = cloneCharm(ctx.charm);
  charm.sunder[who] = true;
  return charm;
}

const SUNDER: SpellSpec = {
  id: 'sunder',
  target: 'self',
  uses: 1,
  legal(st, who, col, ctx) {
    return !!ctx && !ctx.charm.sunder[who];
  },
  apply(st, who, col, ctx) {
    ctx!.charm.sunder[who] = true;
  },
  cpuRootCharm(st, who, castTarget, ctx) {
    return armedSunderCharm(ctx, who);
  },
  cpuCast(st, who, ctx, demand) {
    const bankPerKill = ctx.mode === BOUNTY ? 1 : 0;
    const wide = immediatePlacementGain(st, who, ctx.die, ctx.mode, {
      charm: armedSunderCharm(ctx, who), bankPerKill,
    });
    const plain = immediatePlacementGain(st, who, ctx.die, ctx.mode, {
      charm: cloneCharm(ctx.charm), bankPerKill,
    });
    return wide - plain >= demand * 0.75 ? -1 : null;
  },
};

/* PILFER: the top die of the enemy column you point at crosses the centre
   line onto your facing column. One die, not a stack — the bounded cousin of
   the swap it replaced. The stolen die LANDS, it is not thrown: only a thrown
   die strikes, so nothing is destroyed by its arrival. A shielded column
   cannot be touched — the mode's promise holds against spells too. */
const PILFER: SpellSpec = {
  id: 'pilfer',
  target: 'column',
  side: 'foe',
  uses: 1,
  locksOnAim: true,
  previewDieIndex(st, who, col) {
    const foe = (1 - who) as Player;
    return st[foe][col].length ? st[foe][col].length - 1 : null;
  },
  legal(st, who, col, ctx) {
    if (!ctx || !Number.isInteger(col) || col < 0 || col >= SPEC.cols) return false;
    const foe = (1 - who) as Player;
    if (!st[foe][col].length || isShielded(st[foe][col], ctx.mode)) return false;
    return st[who][col].length < SPEC.rows;
  },
  apply(st, who, col, ctx) {
    const foe = (1 - who) as Player;
    st[who][col].push(st[foe][col].pop()!);
  },
  // no cpuCast: the steal shows on the boards, so the default policy —
  // best swing vs demand — weighs it exactly right
};

/* ANVIL: the weakest die in a column you have FILLED is recast to the face in
   hand. Nothing moves, nothing is destroyed, the column keeps its height — and
   you still place, because a cast is not a move.

   It exists for the one board state nothing else in the roster can reach: a
   full column is finished, and [6,6,1] is stuck at 25 forever because there is
   nowhere left to place. Every other rune works on the die in hand, the die in
   flight, or the enemy's board.

   FULL COLUMNS ONLY, and that restriction is the spell's whole price. The
   unrestricted version (any column, measured as TEMPER) reads the same on a
   bare twin but lets a good column snowball; refusing a column you can still
   place into keeps the cast a repair rather than an accelerator, and keeps the
   decision honest — you must have committed the column before you may fix it.

   WHICH die is not a second aim: the lowest face, ties to the die closest to
   the centre line. One tap, and the player can always predict the answer. */
export function anvilTargetIndex(column: readonly number[]): number | null {
  if (!column.length) return null;
  let target = 0;
  for (let index = 1; index < column.length; index++) {
    if (column[index] < column[target]) target = index;
  }
  return target;
}

const ANVIL: SpellSpec = {
  id: 'anvil',
  target: 'column',
  side: 'own',
  uses: 1,
  commitsOnAim: true,
  legal(st, who, col, ctx) {
    if (!ctx || !Number.isInteger(col) || col < 0 || col >= SPEC.cols) return false;
    const c = st[who][col];
    if (c.length < SPEC.rows) return false;          // only a column you can no longer place into
    const at = anvilTargetIndex(c);
    return at !== null && c[at] !== ctx.die;         // a cast that changes nothing is illegal
  },
  previewDieIndex(st, who, col, ctx) {
    return this.legal(st, who, col, ctx) ? anvilTargetIndex(st[who][col]) : null;
  },
  apply(st, who, col, ctx) {
    const c = st[who][col];
    const at = anvilTargetIndex(c);
    if (at !== null) c[at] = ctx!.die;
  },
  /* The effect shows on the boards, so the default policy CAN weigh it — but
     it would weigh it at the wrong scale. swingOf measures the score
     DIFFERENCE, and a two-sided spell like PILFER is counted twice there (it
     adds to one board and subtracts from the other) while ANVIL only ever adds
     to its own. Same units, half the reach — so the demand is halved, the same
     re-scaling FATE (/4), NUDGE (/3), SUNDER (×0.75) and WARD (×1.5) already
     do. Measured: at the unscaled demand it casts too rarely to be worth a
     rune (57.3 one-sided); halved, 59.8. */
  cpuCast(st, who, ctx, demand) {
    const best = bestTarget(st, who, this, ctx.mode, ctx);
    return best && best.swing >= demand / 2 ? best.col : null;
  },
};

export const SPELLS: SpellSpec[] = [FATE, NUDGE, WARD, SUNDER, PILFER, ANVIL];

/* The OFFLINE picker's last slice: not a spell, but "surprise me" — the same
   shape as the mode wheel's RANDOM. Kept OUT of SPELLS on purpose: it must
   never be dealt as itself, and spellById must never resolve it. Which rune
   it becomes is drawn where the game is dealt (flow/spells), because core
   holds no randomness. Both seats always draw the SAME one. */
export const RANDOM_SPELL = 'random';

export function spellById(id: string | null | undefined): SpellSpec | null {
  return SPELLS.find((s) => s.id === id) ?? null;
}

/* One player's opening hand: the chosen spell, with its uses. An EMPTY object
   is the honest way to say "this seat holds no spells" — NONE picked, the
   tutorial and ranked play all deal exactly that, and every entry point in the
   runtime reads the hand rather than asking a separate on/off flag. */
export function freshCharges(id: string | null | undefined): Record<string, number> {
  const s = spellById(id);
  return s ? { [s.id]: s.uses } : {};
}

/* freshCharges read backwards: WHICH rune this hand was dealt, '' for none.
   Spending the last use leaves the key at zero rather than removing it — you
   still brought the rune — so this answers "what is this game playing with"
   for the whole game, which is what the HUD badge names. Derived rather than
   stored, so the badge and the rail cannot come to disagree. */
export function dealtOf(charges: Record<string, number>): string {
  for (const id in charges) return id;
  return '';
}
