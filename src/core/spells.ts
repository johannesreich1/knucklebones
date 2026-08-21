// SPELLS — an optional layer of one-use powers over local play.
//
// One registry entry is one whole spell: what it is called, what a cast needs,
// how many casts a player gets, which targets are legal, what it does — and
// how a machine weighs it (cpuCast). Adding a spell is adding an object here
// (plus its icon path in ui/spellicons and its cast animation in flow/spells)
// — the rail, the gestures, the charge accounting and the CSS never learn its
// name.
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
import { SPEC, boardTotalMode, cloneSt, isShielded, isFull, legalCols, applyMove, freshCharm,
         AI, ME, type CharmSt, type GameState, type Mode, type Player } from './rules.ts';
import { DICE_FACES } from '../config.ts';

/* What a cast may reach BEYOND the two boards: the die in hand, the live
   supply, the persistent charm marks, and the mode the game obeys. Board-only
   spells never read it — which is why it is optional everywhere: a call site
   that has no hand to offer simply omits it, and any spell that NEEDS one
   answers "not castable here". */
export interface CastCtx {
  mode: Mode;
  die: number;                 // the die in hand
  setDie(v: number): void;     // hand transforms write back through this
  draw(): number;              // the next die from the live supply
  bagLeft: number | null;      // dice left in a finite supply — null = endless
  charm: CharmSt;              // persistent marks (see core/rules)
}

export interface SpellSpec {
  id: string;        // stable — persisted, tested and styled against; never rename
  name: string;      // the rune's label
  blurb: string;     // one line: what it does
  detail: string;    // the long form (screen readers, and any future sheet)
  aim: string;       // the status line while the rune is armed
  target: 'column' | 'self';   // what a cast aims at — a column, or the die in hand
  uses: number;      // casts per player, per game
  /* May this cast happen? Legality is the ONLY failure path a spell has: an
     illegal target is refused before anything moves, so no cast can fail
     halfway through and leave the boards in a state nobody designed. */
  legal(st: GameState, who: Player, col: number, ctx?: CastCtx): boolean;
  /* The effect: a pure mutation of the boards, the hand or the charm. */
  apply(st: GameState, who: Player, col: number, ctx?: CastCtx): void;
  /* The machine's eye: where to aim and whether the cast clears `demand`
     (points of score difference — the difficulty knob). Spells whose value
     never shows on the boards MUST provide this, or a machine will never cast
     them: the default policy (machineCast) weighs board swing alone. */
  cpuCast?(st: GameState, who: Player, ctx: CastCtx, demand: number): number | null;
}

/* the immediate worth of placing this die as well as possible: the best swing
   in the score difference one placement can buy. The yardstick every hand
   policy measures against; charm-aware when a scratch charm is passed. */
export function placeGain(st: GameState, who: Player, die: number, mode: Mode, charm?: CharmSt): number {
  const foe = (1 - who) as Player;
  const lead = (s: GameState) => boardTotalMode(s[who], mode) - boardTotalMode(s[foe], mode);
  let best = -Infinity;
  for (const c of legalCols(st[who])) {
    const ns = cloneSt(st);
    const scratch = charm && { wards: [charm.wards[0].slice(), charm.wards[1].slice()] as [number[], number[]],
                               sunder: [charm.sunder[0], charm.sunder[1]] as [boolean, boolean] };
    applyMove(ns, who, c, die, mode, scratch);
    const g = lead(ns) - lead(st);
    if (g > best) best = g;
  }
  return best;
}

/* FATE: throw the die in hand back, draw another. Touches nothing but the
   caster's own hand — the floor of the power range (sim: 56.1% one-sided at
   two casts). In LIMITED the redraw consumes from the same finite bag (the
   discard does not return), so the game ends one die sooner: the cost is
   real there, and legality refuses the cast when nothing is left to draw. */
const FATE: SpellSpec = {
  id: 'fate',
  name: 'FATE',
  blurb: 'Throw your die back and draw another.',
  detail: 'Discard the die in hand and draw the next from the supply. The new die is yours '
        + 'to place this turn. Two casts per game.',
  aim: 'Drop it on your die to redraw',
  target: 'self',
  uses: 2,
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
  name: 'NUDGE',
  blurb: 'Tick your die up one pip.',
  detail: 'The die in hand turns one pip higher — a 6 wraps around to 1. One cast per game.',
  aim: 'Drop it on your die to nudge',
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
  name: 'WARD',
  blurb: 'Shield a column against the next strike.',
  detail: 'Mark one of your columns: the next enemy strike that would destroy dice there '
        + 'fizzles instead, and the ward is spent. One cast per game.',
  aim: 'Tap one of your columns to guard',
  target: 'column',
  uses: 1,
  legal(st, who, col, ctx) {
    if (!ctx || !Number.isInteger(col) || col < 0 || col >= SPEC.cols) return false;
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
};

/* SUNDER: the placement that follows this cast strikes EVERY enemy column
   holding its face, not just the facing one. The power is earned by the die
   actually in hand. The mark lives exactly one placement: a cast happens
   inside the caster's own turn, and their placement consumes it
   (core/rules openStrikes). */
const SUNDER: SpellSpec = {
  id: 'sunder',
  name: 'SUNDER',
  blurb: 'This die strikes every column, not just its own.',
  detail: 'Cast before placing: this turn your die destroys matching dice in EVERY enemy '
        + 'column, not only the facing one. Shields and wards still answer, column by '
        + 'column. One cast per game.',
  aim: 'Drop it on your die to charge it',
  target: 'self',
  uses: 1,
  legal(st, who, col, ctx) {
    return !!ctx && !ctx.charm.sunder[who];
  },
  apply(st, who, col, ctx) {
    ctx!.charm.sunder[who] = true;
  },
  cpuCast(st, who, ctx, demand) {
    const scratch = freshCharm();
    scratch.sunder[who] = true;
    const wide = placeGain(st, who, ctx.die, ctx.mode, scratch);
    return wide - placeGain(st, who, ctx.die, ctx.mode) >= demand * 0.75 ? -1 : null;
  },
};

/* PILFER: the top die of the enemy column you point at crosses the centre
   line onto your facing column. One die, not a stack — the bounded cousin of
   the swap it replaced. The stolen die LANDS, it is not thrown: only a thrown
   die strikes, so nothing is destroyed by its arrival. A shielded column
   cannot be touched — the mode's promise holds against spells too. */
const PILFER: SpellSpec = {
  id: 'pilfer',
  name: 'PILFER',
  blurb: 'Steal the top die of an enemy column.',
  detail: 'Drag onto an enemy column: its top die crosses to your facing column. The stolen '
        + 'die lands without striking. Needs room on your side; a shielded column cannot be '
        + 'robbed. One cast per game.',
  aim: 'Tap an enemy column to steal',
  target: 'column',
  uses: 1,
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

export const SPELLS: SpellSpec[] = [FATE, NUDGE, WARD, SUNDER, PILFER];

export function spellById(id: string | null | undefined): SpellSpec | null {
  return SPELLS.find((s) => s.id === id) ?? null;
}

/* colScore without importing the whole scoring surface here — the one column
   valuation WARD's policy needs */
function colScoreOf(col: number[]): number {
  let s = 0;
  for (let v = 1; v <= DICE_FACES; v++) {
    let k = 0;
    for (const d of col) if (d === v) k++;
    if (k) s += v * k * k;
  }
  return s;
}

/* ---- what a cast is WORTH ----
   Written against the SpellSpec interface, never against one spell: any future
   spell gets a CPU that can weigh it the day it is registered. Pure, so the
   machine's policy asks exactly the question the effect will answer. */

/* the swing in the score DIFFERENCE, from `who`'s side: what they gain plus
   what the opponent loses, under the mode actually being played. Weighing a
   cast must never PLAY it, so any ctx offered is sandboxed: the boards are a
   clone, the charm is a copy, and the hand cannot be written or drawn from.
   Hand-only spells therefore weigh 0 here — this measures the BOARDS. */
export function swingOf(st: GameState, who: Player, spell: SpellSpec, col: number, mode: Mode, ctx?: CastCtx): number {
  const foe = (1 - who) as Player;
  const lead = (s: GameState) => boardTotalMode(s[who], mode) - boardTotalMode(s[foe], mode);
  const after = cloneSt(st);
  spell.apply(after, who, col, ctx && sandbox(ctx));
  return lead(after) - lead(st);
}

function sandbox(ctx: CastCtx): CastCtx {
  return {
    mode: ctx.mode, die: ctx.die, bagLeft: ctx.bagLeft,
    setDie() {}, draw: () => ctx.die,
    charm: { wards: [ctx.charm.wards[0].slice(), ctx.charm.wards[1].slice()],
             sunder: [ctx.charm.sunder[0], ctx.charm.sunder[1]] },
  };
}

/* the best legal target and what it is worth, or null if none is legal.
   Ties go to the lower column, so the choice is deterministic and replayable. */
export function bestTarget(st: GameState, who: Player, spell: SpellSpec, mode: Mode, ctx?: CastCtx): { col: number; swing: number } | null {
  let best: { col: number; swing: number } | null = null;
  for (let c = 0; c < SPEC.cols; c++) {
    if (!spell.legal(st, who, c, ctx)) continue;
    const swing = swingOf(st, who, spell, c, mode, ctx);
    if (!best || swing > best.swing) best = { col: c, swing };
  }
  return best;
}

/* THE machine's cast decision — the offline CPU and the measurement harness
   both ask this one question, so what ships and what was measured can never
   be two policies. Returns the column to cast at (−1 for a self spell), or
   null: hold the charge. `demand` is the difficulty knob, in points of score
   difference; spells whose value lives off the boards scale it inside their
   own cpuCast. */
export function machineCast(st: GameState, who: Player, spell: SpellSpec, ctx: CastCtx, demand: number): number | null {
  // a charge that survives the last turn was worth nothing: with one slot
  // left to fill, any gain at all beats keeping it
  const room = st[who].reduce((n, c) => n + (SPEC.rows - c.length), 0);
  const dem = room <= 1 ? 1 : demand;
  let pick: number | null;
  if (spell.cpuCast) {
    pick = spell.cpuCast(st, who, ctx, dem);
  } else {
    const best = bestTarget(st, who, spell, ctx.mode, ctx);
    pick = best && best.swing >= dem ? best.col : null;
  }
  if (pick === null || !spell.legal(st, who, pick, ctx)) return null;
  // never end the game ON ITSELF from behind: a cast that fills a grid
  // settles the match immediately, so it must settle it in the caster's favour
  const after = cloneSt(st);
  spell.apply(after, who, pick, sandbox(ctx));
  if (isFull(after[ME]) || isFull(after[AI])) {
    const foe = (1 - who) as Player;
    if (boardTotalMode(after[who], ctx.mode) <= boardTotalMode(after[foe], ctx.mode)) return null;
  }
  return pick;
}

/* One player's opening hand: the chosen spell, with its uses. An EMPTY object
   is the honest way to say "this seat holds no spells" — NONE picked, the
   tutorial and ranked play all deal exactly that, and every entry point in the
   runtime reads the hand rather than asking a separate on/off flag. */
export function freshCharges(id: string | null | undefined): Record<string, number> {
  const s = spellById(id);
  return s ? { [s.id]: s.uses } : {};
}
