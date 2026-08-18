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
import { SPEC, boardTotalMode, cloneSt, type GameState, type Mode, type Player } from './rules.ts';

export interface SpellSpec {
  id: string;        // stable — persisted, tested and styled against; never rename
  name: string;      // the rune's label
  blurb: string;     // one line: what it does
  detail: string;    // the long form (screen readers, and any future sheet)
  target: 'column';  // what a cast needs. A vocabulary of one, for now.
  uses: number;      // casts per player, per game
  /* May this cast happen? Legality is the ONLY failure path a spell has: an
     illegal target is refused before anything moves, so no cast can fail
     halfway through and leave the boards in a state nobody designed. */
  legal(st: GameState, who: Player, col: number): boolean;
  /* The effect, as a pure mutation of the two boards. */
  apply(st: GameState, who: Player, col: number): void;
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

export function spellById(id: string | null | undefined): SpellSpec | null {
  return SPELLS.find((s) => s.id === id) ?? null;
}

/* ---- what a cast is WORTH ----
   Written against the SpellSpec interface, never against one spell: any future
   spell gets a CPU that can weigh it the day it is registered. Pure, so the
   machine's policy asks exactly the question the effect will answer. */

/* the swing in the score DIFFERENCE, from `who`'s side: what they gain plus
   what the opponent loses, under the mode actually being played */
export function swingOf(st: GameState, who: Player, spell: SpellSpec, col: number, mode: Mode): number {
  const foe = (1 - who) as Player;
  const lead = (s: GameState) => boardTotalMode(s[who], mode) - boardTotalMode(s[foe], mode);
  const after = cloneSt(st);
  spell.apply(after, who, col);
  return lead(after) - lead(st);
}

/* the best legal target and what it is worth, or null if none is legal.
   Ties go to the lower column, so the choice is deterministic and replayable. */
export function bestTarget(st: GameState, who: Player, spell: SpellSpec, mode: Mode): { col: number; swing: number } | null {
  let best: { col: number; swing: number } | null = null;
  for (let c = 0; c < SPEC.cols; c++) {
    if (!spell.legal(st, who, c)) continue;
    const swing = swingOf(st, who, spell, c, mode);
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
