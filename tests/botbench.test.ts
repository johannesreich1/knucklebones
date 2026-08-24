// The bot ladder, simulated. ladder.test.ts pins the per-group shape NUMBERS;
// this pins what they are FOR — that the seven groups produce seven genuinely
// ordered opponents, and that STONE is gentle enough for someone who has just
// learned the rules. A future retune edits the registry and then has to get
// past this suite, which is the "measure, don't guess" rule in gate form.
//
// Deterministic: Math.random is replaced by a seeded stream and passed into
// core/ai.ts for tie-break jitter — the gate may not depend on the machine's
// mood. The margins below sit well under the tuned values (bench 2026-08-21,
// mulberry32, floor retune: STONE 41.7% vs random, BONE 66.4%, NEON 81.0% /
// 59.2% vs medium, newcomer-first 74.4% vs STONE and 57.0% vs BONE,
// colshield-aware 51.8% vs blind), so they catch a broken retune, not
// simulation drift.
import {
  AI, ME, emptyBoard, legalCols, applyMove, totalOf, isOver, CLASSIC, COLSHIELD, type Mode, type GameState,
} from '../src/core/rules.ts';
import { searchRoot } from '../src/core/ai.ts';
import { GROUPS, botShapeAt, type BotShape } from '../src/core/ladder.ts';
import { botMove } from '../src/core/bot.ts';

const problems: string[] = [];
const errs: string[] = [];

/* mulberry32, NOT a bare LCG: MINSTD's lattice swung near-deterministic
   policy duels by ±7pp run to run (the colshield decomposition, 2026-08-21
   — 60.6% one stream, 46.0% the next, far beyond sampling error). These
   thresholds may not depend on which stream position a duel starts at. */
const seeded = (a: number) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Math.random = seeded(20260820);

interface Policy extends Partial<BotShape> { random?: boolean; mode?: Mode }
const rnd = (n: number) => Math.floor(Math.random() * n);

function pick(p: Policy, st: ReturnType<typeof emptyBoard>[], who: 0 | 1, die: number): number {
  const legal = legalCols(st[who]);
  if (p.random || (p.slip && Math.random() < p.slip)) return legal[rnd(legal.length)];
  return searchRoot(st as never, who, die, p.depth ?? 1, {
    mode: p.mode ?? CLASSIC,
    random: Math.random,
    riskWeight: p.risk ?? 0,
    opponentWeight: p.oppW ?? 1,
  }).c;
}

/* seatME moves first, like the human in a ranked bot match; returns the
   AI seat's score for one game. world is the mode the GAME obeys — a policy
   may search a different one (that mismatch is what §4 measures). */
function play(seatAI: Policy, seatME: Policy, world: Mode = CLASSIC): number {
  const st = [emptyBoard(), emptyBoard()];
  let turn: 0 | 1 = ME as 1, i = 0;
  for (;;) {
    const die = 1 + rnd(6);
    applyMove(st as never, turn, pick(turn === AI ? seatAI : seatME, st, turn, die), die, world);
    i++;
    if (isOver(st[turn], null)) break;
    turn = (1 - turn) as 0 | 1;
  }
  const a = totalOf(st[AI], 0, world), m = totalOf(st[ME], 0, world);
  return a > m ? 1 : a < m ? 0 : 0.5;
}

const vsAnchor = (bot: Policy, anchor: Policy, n: number) => {
  let w = 0;
  for (let g = 0; g < n; g++) w += play(bot, anchor);
  return w / n;
};
/* seats alternate so the first-move edge cancels; share for a */
const duel = (a: Policy, b: Policy, n: number, world: Mode = CLASSIC) => {
  let w = 0;
  for (let g = 0; g < n; g++) w += g % 2 ? 1 - play(b, a, world) : play(a, b, world);
  return w / n;
};

const RANDOM: Policy = { random: true };
const MEDIUM: Policy = { depth: 2, risk: 0.9 };   // the offline Medium anchor

/* 1 · the ladder of strength: win rate vs a random mover must climb, and the
   floor must sit near random-parity. N shrinks with depth for gate time (the
   deep groups dominate the runtime); the run is seeded, so these are exact
   reruns, not samples. */
/* deep groups need N too: at 60 games the apex's SE was ~6pp and the ordered-
   ladder check tripped on pure noise the day the PRNG changed */
const n4 = (d: number) => (d >= 4 ? 150 : d >= 3 ? 250 : 600);
const vsRandom = GROUPS.map((g) => vsAnchor(g.bot, RANDOM, n4(g.bot.depth)));
if (!(vsRandom[0] <= 0.58)) {
  problems.push(`STONE wins ${(vsRandom[0] * 100).toFixed(1)}% vs a random mover — the floor is `
    + `not gentle. Someone who has just learned the rules must be able to beat it.`);
}
for (let i = 1; i < GROUPS.length; i++) {
  if (vsRandom[i] < vsRandom[i - 1] - 0.06) {
    problems.push(`${GROUPS[i].id} (${(vsRandom[i] * 100).toFixed(1)}%) is weaker vs random than `
      + `${GROUPS[i - 1].id} (${(vsRandom[i - 1] * 100).toFixed(1)}%) — the ladder is not ordered`);
  }
}
if (!(vsRandom[GROUPS.length - 1] >= 0.70)) {
  problems.push(`NEON wins only ${(vsRandom[GROUPS.length - 1] * 100).toFixed(1)}% vs random — the apex has gone soft`);
}

/* 1c · the onboarding promise (2026-08-21): in the PRODUCTION lens (vs a bot
   the human is p1 and moves first), a newcomer who has merely understood
   stacking — the pure builder — must WIN clearly in STONE and still win in
   BONE. "If I lose 50% in the beginning, I quit" is the requirement; the
   kill-averse STONE (negative oppW) and the slackened BONE are its shape.
   Measured 76.6% / 59.0%; the bars sit under them by real margins. */
const NEWCOMER: Policy = { depth: 1, oppW: 0, risk: 0, slip: 0 };
const stoneNewcomer = 1 - vsAnchor(GROUPS[0].bot, NEWCOMER, 600);
if (!(stoneNewcomer >= 0.70)) {
  problems.push(`a stacking newcomer wins only ${(stoneNewcomer * 100).toFixed(1)}% vs the STONE bot — `
    + `the floor is not a place where new players WIN`);
}
const boneNewcomer = 1 - vsAnchor(GROUPS[1].bot, NEWCOMER, 600);
if (!(boneNewcomer >= 0.54)) {
  problems.push(`a stacking newcomer wins only ${(boneNewcomer * 100).toFixed(1)}% vs the BONE bot — `
    + `the first promotion may read "harder", never "losing"`);
}

/* 2 · the first promotion must be felt: BONE (sees your board) beats STONE
   (destroy-blind) clearly. This is the seam the whole rework exists for. */
const boneVsStone = duel(GROUPS[1].bot, GROUPS[0].bot, 600);
if (!(boneVsStone >= 0.55)) {
  problems.push(`BONE beats STONE only ${(boneVsStone * 100).toFixed(1)}% — the destroy-blind floor is not doing its job`);
}

/* 3 · the top must clear a real bar, not just the weak anchors */
const neonVsMedium = vsAnchor(GROUPS[GROUPS.length - 1].bot, MEDIUM, 60);
if (!(neonVsMedium >= 0.50)) {
  problems.push(`NEON wins only ${(neonVsMedium * 100).toFixed(1)}% vs the offline Medium — the apex is not hard`);
}

/* 4 · COLSHIELD awareness must not COST anything. The risk model once skipped
   shielded columns — true, and a measured 44.5% vs a mode-blind twin: closing
   a column deleted its risk from the eval, so the searcher slammed columns
   shut on junk (see riskOf in core/ai.ts for the full finding). With the skip
   cut, aware-vs-blind is parity (~50%). This duel refuses the skip's return:
   it sat ~44.5% and cannot clear the bar. */
const csAware: Policy = { depth: 2, risk: 0.9, mode: COLSHIELD };
const csBlind: Policy = { depth: 2, risk: 0.9 };
const csAwareVsBlind = duel(csAware, csBlind, 800, COLSHIELD);
if (!(csAwareVsBlind >= 0.47)) {
  problems.push(`COLSHIELD-aware search wins only ${(csAwareVsBlind * 100).toFixed(1)}% of colshield games `
    + `vs a mode-blind twin — a losing mode heuristic is back in the eval (the risk-model shield skip `
    + `measured 44.5% here; awareness may be neutral, never a handicap)`);
}

/* ---- core/bot botMove(): the ONE implementation both Edge Functions ask ----
   Extracted from pvp-move 2026-08-22 so pvp-join can play a bot's OPENING move
   (a bot can be seated first now that the seat handicap applies to bots too).
   Equivalence to the block it replaced was proven off-gate at 113,400 calls
   across all 7 modes and all 7 groups, 0 differences; what is pinned HERE is
   the contract that keeps it safe to call from two places. */
{
  const check = (c: boolean, m: string, x?: unknown) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
  const seeded = (a: number) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const st0: GameState = [emptyBoard(), emptyBoard()];
  // an OPENING move on an empty board is the case pvp-join newly depends on
  for (const g of GROUPS) {
    const c = botMove(st0, ME, 4, g.floor + 10, CLASSIC, seeded(7));
    check(c >= 0 && c < 3, 'botMove must open with a legal column: ' + g.id, c);
  }
  // deterministic given the SAME stream — replay and the gate both need this.
  const mid: GameState = [[[5, 5], [2], []], [[4], [6, 6], [1]]];
  for (const mode of [CLASSIC, COLSHIELD] as Mode[]) {
    const a = botMove(mid, AI, 4, 2020, mode, seeded(99));
    const b = botMove(mid, AI, 4, 2020, mode, seeded(99));
    check(a === b, 'botMove must be deterministic on one seeded stream', { mode, a, b });
  }
  // it must never answer with a column it cannot play
  const nearlyFull: GameState = [[[1, 2, 3], [1, 2, 3], [4]], [[], [], []]];
  for (let i = 0; i < 60; i++) {
    const c = botMove(nearlyFull, AI, 1 + (i % 6), GROUPS[i % GROUPS.length].floor + 10, CLASSIC, seeded(i));
    check(legalCols(nearlyFull[AI]).includes(c), 'botMove returned an illegal column', { i, c });
  }
  // a full board has nothing to answer with, and says so rather than guessing
  const full: GameState = [[[1, 2, 3], [1, 2, 3], [1, 2, 3]], [[], [], []]];
  check(botMove(full, AI, 4, 0, CLASSIC, seeded(1)) === -1, 'a bot with no legal column must return -1');
  // Search options are per call: a ranked bot cannot change how the next
  // offline search in the same process plays.
  const independent = () => searchRoot(mid, AI, 4, 2, {
    mode: CLASSIC, random: seeded(515), riskWeight: 0.9, opponentWeight: 1,
  }).c;
  const before = independent();
  botMove(mid, AI, 4, 0, CLASSIC, seeded(3));          // STONE: risk 0, oppW -0.5
  const after = independent();
  check(before === after, 'botMove leaked configuration into an independent search', { before, after });
  check(botShapeAt(0).oppW === -0.5, 'STONE is still the kill-averse shape botMove borrows', botShapeAt(0));
}

console.log(JSON.stringify({
  vsRandom: Object.fromEntries(GROUPS.map((g, i) => [g.id, +(vsRandom[i] * 100).toFixed(1)])),
  stoneNewcomer: +(stoneNewcomer * 100).toFixed(1),
  boneNewcomer: +(boneNewcomer * 100).toFixed(1),
  boneVsStone: +(boneVsStone * 100).toFixed(1),
  neonVsMedium: +(neonVsMedium * 100).toFixed(1),
  csAwareVsBlind: +(csAwareVsBlind * 100).toFixed(1),
  problems, errs,
}, null, 2));
