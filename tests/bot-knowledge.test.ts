// What a bot KNOWS is league-independent: weakness comes from errors, never
// from ignorance (docs/LADDER.md §4). Every league evaluates under the real
// mode and knows every rune; what changes with league is how often it errs.
// So understanding is measured once, the way the COLSHIELD precedent measured
// it: a mode-aware search against a twin that evaluates Classic while the
// world runs the mode. Parity means the awareness is inert; below parity it
// is a handicap; a mode whose scoring or supply differs must WIN.
//
// Deterministic: every draw is keyed (tests/support/policy-duel-bench.ts).
// Run: mise exec -- node --experimental-strip-types tests/bot-knowledge.test.ts
import { MODES } from '../src/core/modes.ts';
import { CLASSIC, COLSHIELD, type Mode } from '../src/core/rules.ts';
import { duel, type Policy } from './support/policy-duel-bench.ts';
import { emitReport } from './support/emit-report.mjs';

const problems: string[] = [];
const errs: string[] = [];
const GAMES = 1200;                    // SE ≈ 1.4pp per cell
const DEPTH = 2;
const RISK = 0.9;                      // the offline Medium anchor, as botbench's precedent

/* Bars. COLSHIELD is parity BY DESIGN: the rule lives in applyMove, both twins
   have it, and the risk-model shield skip that once "understood" it measured
   44.5% here — it may not return, so this floor refuses a handicap, nothing
   more. ROWSWITCH and ROWMULT change scoring and are measured real (floors
   sit 5pp under the keyed measurement). Every other mode changes what the
   game is played for and must win outright. */
const NEVER_A_HANDICAP = 0.47;
const REAL = 0.55;
const MODE_BARS: Record<string, number> = {
  rowswitch: 0.71,                     // measured 76.5% (2026-09-02, keyed)
  rowmult: 0.55,                       // measured 60.0%
  colshield: NEVER_A_HANDICAP,
  singlestrike: REAL,
  bounty: REAL,
  limited: REAL,
};

/* Modes the search does not yet understand, with the release that fixes
   each. The assertion runs every time; a listed mode that clears its bar
   fails ("remove the entry"), so this list can only shrink. */
const KNOWLEDGE_DEBT = new Map<string, string>([
  // Measured 2026-09-02 (keyed, 1,200 games): 51.4 / 50.3 / 50.5.
  ['bounty', 'banked points live outside GameState, so evalSt never sees what it is playing for — stage 6.1 threads the bank through search'],
  ['singlestrike', 'the riskOf SINGLESTRIKE term wins nothing — stage 6.2 measures it and fixes or deletes it'],
  ['limited', 'the search assumes uniform dice; the bag is countable — stage 6.3 weights the expectation by what remains'],
]);

const cells: Record<string, number> = {};
const knownRed: Array<{ mode: string; share: number; bar: number; why: string }> = [];
for (const m of MODES) {
  if (m.mode === CLASSIC) continue;
  const aware: Policy = { depth: DEPTH, risk: RISK, mode: m.mode as Mode };
  const blind: Policy = { depth: DEPTH, risk: RISK, mode: CLASSIC };
  const share = duel(aware, blind, GAMES, m.mode as Mode, 0x1000 + m.mode);
  cells[m.id] = +(share * 100).toFixed(1);
  const bar = MODE_BARS[m.id];
  const debt = KNOWLEDGE_DEBT.get(m.id);
  if (bar === undefined) {
    problems.push(`${m.id} has no knowledge bar — a new mode ships with a measured aware-vs-blind cell`);
  } else if (share < bar && !debt) {
    problems.push(`${m.id}: the mode-aware search wins only ${cells[m.id]}% of ${m.id} games vs a `
      + `Classic-eval twin (bar ${(bar * 100).toFixed(0)}%) — `
      + (bar === NEVER_A_HANDICAP ? 'a losing mode heuristic is back in the eval' : 'the bot does not understand this mode'));
  } else if (share >= bar && debt) {
    problems.push(`${m.id} now clears its ${(bar * 100).toFixed(0)}% bar at ${cells[m.id]}% — remove its KNOWLEDGE_DEBT entry`);
  } else if (share < bar && debt) {
    knownRed.push({ mode: m.id, share: cells[m.id], bar, why: debt });
  }
}
void COLSHIELD;

emitReport({ games: GAMES, cells, knownRed, problems, errs }, problems.length);
