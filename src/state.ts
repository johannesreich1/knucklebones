// The game's single mutable state object plus the vocabulary of legal values.
// Everything that renders, saves or decides reads from here; identity vs
// screen-half is the invariant to keep straight (see S.bottom).
import { AI, ME, emptyBoard, freshCharm, type Board, type CharmSt, type Player, type Mode as RulesMode } from './core/rules.ts';

export const DIFFS = ['easy', 'medium', 'hard'] as const;
export const MODES = ['cpu', 'duo'] as const;
export const TIMERS = [0, 10, 20] as const;
export const SEATS = ['pass', 'face'] as const;
export const DIFF_LABEL: Record<string, string> = { easy: 'EASY', medium: 'NORMAL', hard: 'HARD' };
/* The duel-colour roster (Settings pickers). Each id names a raw hue token
   family in styles/main.css (--<id>, --<id>-rgb, --<id>-hi); the pickers offer
   exactly this list and menu.ts points --p1/--p2 at the chosen families.
   Adding a hue = one entry here + its three tokens in main.css. */
export const DUELHUES = [
  { id: 'cy',     name: 'CYAN' },
  { id: 'mg',     name: 'MAGENTA' },
  { id: 'gold',   name: 'GOLD' },
  { id: 'green',  name: 'GREEN' },
  { id: 'violet', name: 'VIOLET' },
  { id: 'orange', name: 'ORANGE' },
] as const;
export const HUE_IDS = DUELHUES.map(h => h.id);

export type Diff = typeof DIFFS[number];
export type Mode = typeof MODES[number];
export type Seat = typeof SEATS[number];
export type Phase = 'menu' | 'roll' | 'choose' | 'pass' | 'anim' | 'over';

export interface TutState {
  turnNo: number;
  prolls: number[];   // scripted player rolls
  crolls: number[];   // scripted CPU rolls
  cmoves: number[];   // scripted CPU column choices
  firstCol: number | null;
  restrict: number | null;
}

/* accept a stored value only if it is one we recognise, else keep the current one */
export function oneOf<T>(list: readonly T[], val: unknown, fallback: T): T {
  return list.indexOf(val as T) >= 0 ? (val as T) : fallback;
}

/* Player indices are fixed identities: 1 = cyan (you / Player 1), 0 = magenta
   (CPU / Player 2). Which HALF OF THE SCREEN each one occupies is S.bottom,
   which swaps on hand-off so the active player is always nearest their thumbs. */
export const S = {
  boards: [emptyBoard(), emptyBoard()] as [Board, Board],
  turn: ME as Player,
  die: 0,
  phase: 'menu' as Phase,
  mode: 'cpu' as Mode,
  bottom: ME as Player,  // which player is rendered in the lower half
  diff: 'hard' as Diff,
  wins: 0, losses: 0, draws: 0,
  p1: 0, p2: 0, ties: 0, // duo-mode session record
  best: 0,               // highest single-game score, persisted
  numerals: false,       // show numbers on dice instead of pips
  timer: 10,             // two-player turn clock in seconds; 0 = off
  seat: 'pass' as Seat,  // duo seating: pass the phone, or sit facing each other
  tut: null as TutState | null, // tutorial script state while the guided game runs
  tutDone: false,        // persisted: has the tutorial ever been finished
  /* persisted: has ANY real game been finished — offline or ranked. The first
     -run tutorial offer and the hub's highlight both ask this, and they must
     never disagree, so there is one flag and not one per flow. */
  played: false,
  starter: ME as Player,
  sound: true,
  /* the duel palette: which hue family (DUELHUES id) each side wears. Never
     equal — each picker disables the other side's pick. colorblind OVERRIDES
     the display pair to cyan-vs-gold and locks both pickers, but the stored
     picks survive it, so turning it off restores the chosen combination. */
  p1Hue: 'cy',
  p2Hue: 'mg',
  colorblind: false,
  busy: false,
  gen: 0,                // bumped whenever a game is abandoned/restarted; async work checks it
  /* the active scoring/destruction mode (core/rules Mode). ONLY online play
     sets it (the ranked wheel); local play is always 0 = classic. Rendering
     and destroy animations read it so boards/totals match the server. */
  scoring: 0 as RulesMode,
  /* the OFFLINE view's mode pick — newGame copies it into scoring (persisted) */
  localMode: 0 as RulesMode,
  /* LIMITED offline: the remaining undrawn bag; null in every other context */
  pool: null as number[] | null,
  /* BOUNTY mode's banked +1s per Player — permanent, survives destruction */
  bounty: [0, 0] as [number, number],
  /* SPELLS (flow/spells) — an OPTIONAL layer over local play. `spell` is the
     OFFLINE screen's pick, exactly like localMode picks the game mode: '' is
     NONE and the game is then what it always was. spellCharges holds casts
     LEFT per player for this game, keyed by spell id; an empty hand means this
     seat holds no spells at all (NONE, ranked, tutorial) and is the ONE thing
     the runtime asks. spellArmed is the spell waiting for a target. */
  spell: '',
  spellCharges: [{}, {}] as [Record<string, number>, Record<string, number>],
  spellArmed: null as string | null,
  /* persistent spell marks (wards, a pending sunder) — core/rules CharmSt.
     Reset wherever charges are dealt (resetSpells / clearSpells); the render
     paints ward chips from it, destruction consults it. */
  charm: freshCharm() as CharmSt,
  /* THE TAKE-BACK. A spell that lands on the die in hand casts the moment you
     press it, so pressing it again puts it back — until the die is placed and
     the turn is spent for real. This holds what the cast changed, as a
     snapshot rather than a per-spell inverse: the spell does not need to know
     it can be undone. Null means there is nothing to take back. */
  spellUndo: null as null | {
    id: string;
    who: Player;
    die: number;                  // the die that was in hand before the cast
    pool: number[] | null;        // the supply before it (FATE draws from it)
    charm: CharmSt;               // the marks before it (SUNDER sets one)
  }
};

// re-export the identities for modules that get S anyway
export { AI, ME };
