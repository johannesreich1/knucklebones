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
import { SPEC, type GameState, type Player } from './rules.ts';

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

/* One player's opening hand of charges. An EMPTY object is the honest way to
   say "this seat holds no spells" — the tutorial, ranked play and the layer
   switched off all deal exactly that. */
export function freshCharges(): Record<string, number> {
  const c: Record<string, number> = {};
  for (const s of SPELLS) c[s.id] = s.uses;
  return c;
}
