import type { CharmSt, GameState, Mode, Player } from './rules.ts';

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
  /* The status line while the rune is armed — and it lives in a RESERVED box:
     one line in portrait, two in landscape's fixed 104px lane. Outgrow it and
     the box grows with the text, which walks the stage die up the screen on
     every cast. So this line says WHICH TARGET the tap wants and stops — the
     verb is already on the rune the player just pressed, in its name, its icon
     and its `blurb`, and the board rings the legal targets in gold. The one
     thing the rings CANNOT say is why they are silent, which is exactly what
     "a filled column" or "an enemy column" answers. For a SELF spell the which
     is the die in hand, so the line is "Drop it on your die" and stops there
     too — the three of them carried their verb for a while because the rule
     was read as being about columns, and in SF Pro Rounded they happened to
     fit. In a fallback face ~8-10% wider they became THREE landscape lines and
     shoved the stage die 6.2px, which is the very drift this rule exists to
     prevent (CI, 2026-08-22). Not a character budget: long WORDS break lines,
     so measure rather than count (the spell browser suite arms every entry on
     the narrowest phone, in both orientations). */
  aim: string;
  target: 'column' | 'self';   // what a cast aims at — a column, or the die in hand
  /* WHOSE half a column cast points at. The board rings only the columns a
     cast can actually land on, so this is what stops a ward from advertising
     the enemy's columns (and a pilfer from advertising your own). */
  side?: 'own' | 'foe';
  uses: number;      // casts per player, per game
  /* May this cast never be taken back? A self spell lands on the die in hand
     the instant it is pressed, so pressing it again normally puts it back
     (flow/spells) — but ONLY when putting it back leaves the caster exactly
     where they were. A cast that already PAID OUT cannot be unpaid, and the
     commonest way to pay out is to show the player something: FATE draws the
     next die from the supply, and no take-back can un-see it. "Cast, peek,
     undo" would be a free look at the supply, every game, for nothing.
     Board spells never get the window at all — their dice have visibly
     flown — so this is only ever asked of the self spells. */
  final?: boolean;
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
