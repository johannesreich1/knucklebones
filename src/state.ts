// The game's single mutable state object plus the vocabulary of legal values.
// Everything that renders, saves or decides reads from here; identity vs
// screen-half is the invariant to keep straight (see S.bottom).
import { AI, ME, emptyBoard, freshCharm, type Board, type CharmSt, type Player, type Mode as RulesMode } from './core/rules.ts';
import type { LanguageOverride } from './i18n/index.ts';

export const DIFFS = ['easy', 'medium', 'hard'] as const;
export const MODES = ['cpu', 'duo'] as const;
export const TIMERS = [0, 10, 20] as const;
export const SEATS = ['pass', 'face'] as const;
/* The duel-colour roster (Settings pickers). Each id names a raw hue token
   family in styles/main.css (--<id>, --<id>-rgb, --<id>-hi); the pickers offer
   exactly this list and menu.ts points --p1/--p2 at the chosen families.
   Adding a hue = one entry here + its three tokens in main.css. */
export const DUELHUES = [
  { id: 'cy' },
  { id: 'mg' },
  { id: 'gold' },
  { id: 'green' },
  { id: 'violet' },
  { id: 'orange' },
  /* BLUE was added last (2026-08-22) and deliberately sits clear of the heat
     families: a player wearing it never pushes a multiplier onto its --ice /
     --red fallback, so both heats stay true on both sides. */
  { id: 'blue' },
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
  /* Who opens the NEXT offline game. It alternates after every game (newGame
     flips it), which is the fair thing over a session — but it used to START
     at ME, and it is deliberately NOT persisted, so it reset to the player on
     every reload. A session one game long therefore gave the player the first
     move EVERY time: open the app, play a game, close it, and you opened all
     of them. Drawn once per load instead, so the alternation begins on a coin
     flip. Not core/, so Math.random is allowed here — no replay validator has
     an opinion about an offline game. */
  starter: (Math.random() < 0.5 ? ME : AI) as Player,
  /* null follows the current browser/device language. A concrete supported
     base locale is the user's local and cross-device override. */
  localeOverride: null as LanguageOverride,
  sound: true,
  /* the duel palette: which hue family (DUELHUES id) each side wears. Never
     equal — each picker disables the other side's pick. colorblind OVERRIDES
     the display pair to cyan-vs-gold and locks both pickers, but the stored
     picks survive it, so turning it off restores the chosen combination. */
  p1Hue: 'cy',
  p2Hue: 'mg',
  colorblind: false,
  /* null follows the OS default; the first explicit Settings choice becomes
     a persistent boolean override, including OFF on an iOS device set to
     Reduce Motion. ui/fx owns the effective value. */
  reducedMotion: null as boolean | null,
  busy: false,
  gen: 0,                // bumped whenever a game is abandoned/restarted; async work checks it
  /* the active scoring/destruction mode (core/rules Mode). Ranked supplies it
     from the match; offline newGame copies localMode. Rendering, effects and
     final totals all read this one resolved value. */
  scoring: 0 as RulesMode,
  /* the OFFLINE view's mode pick — newGame copies it into scoring (persisted) */
  localMode: 0 as RulesMode,
  /* LIMITED offline: the remaining undrawn bag; null in every other context */
  pool: null as number[] | null,
  /* BOUNTY mode's banked +1s per Player — permanent, survives destruction */
  bounty: [0, 0] as [number, number],
  /* SPELLS (flow/spells) — an OPTIONAL layer over local play. `spell` is the
     OFFLINE screen's pick, exactly like localMode picks the game mode: '' is
     NONE and the game is then what it always was. The two random promise ids
     remain here while the resolved per-seat deal lives in spellCharges.
     spellCharges holds casts LEFT per player for this game, keyed by spell id;
     an empty hand means this seat holds no spells at all (NONE, ranked,
     tutorial) and is the ONE thing the runtime asks. spellArmed is the spell
     waiting for a target. ANVIL is the one aim whose markings commit before a
     target is selected, so that reservation records who already paid for the
     armed cast. */
  spell: '',
  spellCharges: [{}, {}] as [Record<string, number>, Record<string, number>],
  spellArmed: null as string | null,
  spellAimCommitted: null as null | { id: string; who: Player },
  /* The active turn may commit at most one cast. Player identity, rather than
     a boolean, keeps test/host turn changes honest and lets the other seat act
     after the real placement boundary clears this marker. */
  spellCastThisTurn: null as Player | null,
  /* persistent spell marks (wards, a pending sunder) — core/rules CharmSt.
     Reset wherever charges are dealt (resetSpells / clearSpells); rendering
     derives WARD's live score bonus from it, and hostile actions consume it. */
  charm: freshCharm() as CharmSt,
};

// re-export the identities for modules that get S anyway
export { AI, ME };
