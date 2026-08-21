// SPELLS — an optional layer of one-use powers over local play.
//
// One registry entry is one whole spell: what it is called, what a cast needs,
// how many casts a player gets, which targets are legal and what it does to the
// two boards. Adding a spell is adding an object here (plus its icon path in
// ui/spellicons) — no flow, no UI and no CSS has to learn its name.
//
// Pure, like the rest of core/: plain data in, plain data out. No DOM, no
// randomness, no timers. RANKED PLAY NEVER CASTS — the server validates a
// match by replaying its move log through core/rules, so a spell would leave
// the client and the server telling different stories. That boundary is why
// this module knows nothing about the network: flow/spells simply deals no
// charges in an online match.
import { SPEC, boardTotalMode, cloneSt, isShielded, freshCharm,
         type CharmSt, type GameState, type Mode, type Player } from './rules.ts';
import { DICE_FACES } from '../config.ts';

/* What a cast may reach BEYOND the two boards: the die in hand, the live
   supply, the persistent charm marks, and the mode the game obeys. Board-only
   spells never read it — which is why it is optional everywhere: a call site
   that has no hand to offer (the current flow, swingOf's weighing) simply
   omits it, and any spell that NEEDS one answers "not castable here". The
   supply is handed in as behaviour (draw), not data, so this module stays
   free of randomness: offline the caller brings Math.random, ranked brings
   the seeded stream, and a replay is deterministic by construction. */
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
  target: 'column' | 'self';   // what a cast aims at — a column, or the caster's own hand
  uses: number;      // casts per player, per game
  /* May this cast happen? Legality is the ONLY failure path a spell has: an
     illegal target is refused before anything moves, so no cast can fail
     halfway through and leave the boards in a state nobody designed. */
  legal(st: GameState, who: Player, col: number, ctx?: CastCtx): boolean;
  /* The effect: a pure mutation of the boards, the hand or the charm. */
  apply(st: GameState, who: Player, col: number, ctx?: CastCtx): void;
}

/* COLUMN SWAP: the column you point at and the one facing it change owners,
   dice and all. Deliberately symmetrical — dropping it on your own column or
   on theirs is the same move, so there is nothing to get wrong at the moment
   of casting. */
const SWAP: SpellSpec = {
  id: 'swap',
  name: 'COLUMN SWAP',
  blurb: 'Trade a column with your opponent.',
  detail: 'Drag the rune onto any column — yours or theirs. That column and the one '
        + 'facing it change owners, dice and all. One cast per game.',
  target: 'column',
  uses: 1,
  legal(st, who, col) {
    if (!Number.isInteger(col) || col < 0 || col >= SPEC.cols) return false;
    // Two identical columns (both empty being the common case) would spend the
    // charge and change nothing. Not an error to report — a target the player
    // simply cannot pick.
    return String(st[who][col]) !== String(st[1 - who][col]);
  },
  apply(st, who, col) {
    const foe = (1 - who) as Player;
    const mine = st[who][col];
    st[who][col] = st[foe][col];
    st[foe][col] = mine;
  },
};

export const SPELLS: SpellSpec[] = [SWAP];

/* ===================== CANDIDATES =====================
   The next roster, under measurement (tools/spellsim.ts) and NOT yet dealt:
   nothing player-facing reads this list — the picker, the library and the
   rail all iterate SPELLS. A candidate graduates by moving up there (and
   SWAP retires) in one roster commit, after the simulations have spoken.
   Every one of them needs a CastCtx, so none is castable through the current
   flow even by accident: legal() without a ctx is simply false. */

/* FATE: throw the die in hand back, draw another. Touches nothing but the
   caster's own hand — the floor of the power range. In LIMITED the redraw
   consumes from the same finite bag (the discard does not return), so the
   game ends one die sooner: the cost is real there, and legality refuses
   the cast when the bag has nothing left to draw. */
const FATE: SpellSpec = {
  id: 'fate',
  name: 'FATE',
  blurb: 'Throw your die back and draw another.',
  detail: 'Discard the die in hand and draw the next from the supply. The new die is yours '
        + 'to place this turn. Two casts per game.',
  target: 'self',
  uses: 2,
  legal(st, who, col, ctx) {
    return !!ctx && ctx.bagLeft !== 0;
  },
  apply(st, who, col, ctx) {
    ctx!.setDie(ctx!.draw());
  },
};

/* NUDGE: the die in hand ticks up one pip, 6 wrapping to 1. Bounded, self-
   side, deterministic — the wrap is what keeps "always cast on anything
   below 6" from being free: past the top you land on the bottom. */
const NUDGE: SpellSpec = {
  id: 'nudge',
  name: 'NUDGE',
  blurb: 'Tick your die up one pip.',
  detail: 'The die in hand turns one pip higher — a 6 wraps around to 1. Two casts per game.',
  target: 'self',
  uses: 2,
  legal(st, who, col, ctx) {
    return !!ctx;
  },
  apply(st, who, col, ctx) {
    ctx!.setDie(ctx!.die % DICE_FACES + 1);
  },
};

/* WARD: one of the caster's own columns absorbs the next strike that would
   take dice there, then burns out. Cast in anticipation, never in reaction —
   the mark just sits in the charm until destruction consults it (core/rules
   applyMove). A strike with no victims costs the ward nothing. */
const WARD: SpellSpec = {
  id: 'ward',
  name: 'WARD',
  blurb: 'Shield a column against the next strike.',
  detail: 'Mark one of your columns: the next enemy strike that would destroy dice there '
        + 'fizzles instead, and the ward is spent. One cast per game.',
  target: 'column',
  uses: 1,
  legal(st, who, col, ctx) {
    if (!ctx || !Number.isInteger(col) || col < 0 || col >= SPEC.cols) return false;
    return ctx.charm.wards[who][col] === 0;    // one ward per column — a second buys nothing
  },
  apply(st, who, col, ctx) {
    ctx!.charm.wards[who][col]++;
  },
};

/* SUNDER: the placement that follows this cast strikes EVERY enemy column
   holding its face, not just the facing one. The power is earned by the die
   actually in hand — the cast is only worth what the board and the roll
   agree it is worth. The mark lives exactly one placement: a cast happens
   inside the caster's own turn, and their placement consumes it. */
const SUNDER: SpellSpec = {
  id: 'sunder',
  name: 'SUNDER',
  blurb: 'This die strikes every column, not just its own.',
  detail: 'Cast before placing: this turn your die destroys matching dice in EVERY enemy '
        + 'column, not only the facing one. Shields and wards still answer, column by '
        + 'column. One cast per game.',
  target: 'self',
  uses: 1,
  legal(st, who, col, ctx) {
    return !!ctx && !ctx.charm.sunder[who];
  },
  apply(st, who, col, ctx) {
    ctx!.charm.sunder[who] = true;
  },
};

/* PILFER: the top die of the enemy column you point at crosses the centre
   line onto your facing column. One die, not a stack — the bounded cousin of
   the swap it replaces. The stolen die LANDS, it is not thrown: only a
   thrown die strikes, so nothing is destroyed by its arrival. A shielded
   column cannot be touched — the mode's promise holds against spells too. */
const PILFER: SpellSpec = {
  id: 'pilfer',
  name: 'PILFER',
  blurb: 'Steal the top die of an enemy column.',
  detail: 'Drag onto an enemy column: its top die crosses to your facing column. The stolen '
        + 'die lands without striking. Needs room on your side; a shielded column cannot be '
        + 'robbed. One cast per game.',
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
};

export const CANDIDATES: SpellSpec[] = [FATE, NUDGE, WARD, SUNDER, PILFER];

export function spellById(id: string | null | undefined): SpellSpec | null {
  return SPELLS.find((s) => s.id === id) ?? null;
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

/* One player's opening hand: the chosen spell, with its uses. An EMPTY object
   is the honest way to say "this seat holds no spells" — NONE picked, the
   tutorial and ranked play all deal exactly that, and every entry point in the
   runtime reads the hand rather than asking a separate on/off flag. */
export function freshCharges(id: string | null | undefined): Record<string, number> {
  const s = spellById(id);
  return s ? { [s.id]: s.uses } : {};
}
