// The bot ladder, simulated. ladder.test.ts pins the per-group shape NUMBERS;
// this pins what they are FOR — that the seven groups produce seven genuinely
// ordered opponents, and that STONE is gentle enough for someone who has just
// learned the rules. A future retune edits the registry and then has to get
// past this suite, which is the "measure, don't guess" rule in gate form.
//
// Deterministic: Math.random is replaced by a seeded stream, which also seeds
// core/ai.ts's tie-break jitter — the gate may not depend on the machine's
// mood. The margins below sit well under the tuned values (bench 2026-08-20:
// STONE 49.8% vs random, BONE 64.7%, NEON 80.0% / 58.7% vs medium), so they
// catch a broken retune, not simulation drift.
import {
  AI, ME, emptyBoard, legalCols, applyMove, totalOf, isOver, CLASSIC,
} from '../src/core/rules.ts';
import { searchRoot, setRiskW, setOppW } from '../src/core/ai.ts';
import { GROUPS, type BotShape } from '../src/core/ladder.ts';

const problems: string[] = [];
const errs: string[] = [];

const seeded = (seed: number) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
Math.random = seeded(20260820);

interface Policy extends Partial<BotShape> { random?: boolean }
const rnd = (n: number) => Math.floor(Math.random() * n);

function pick(p: Policy, st: ReturnType<typeof emptyBoard>[], who: 0 | 1, die: number): number {
  const legal = legalCols(st[who]);
  if (p.random || (p.slip && Math.random() < p.slip)) return legal[rnd(legal.length)];
  setRiskW(p.risk ?? 0);
  setOppW(p.oppW ?? 1);
  return searchRoot(st as never, who, die, p.depth ?? 1, CLASSIC).c;
}

/* seatME moves first, like the human in a ranked bot match; returns the
   AI seat's score for one game */
function play(seatAI: Policy, seatME: Policy): number {
  const st = [emptyBoard(), emptyBoard()];
  let turn: 0 | 1 = ME as 1, i = 0;
  for (;;) {
    const die = 1 + rnd(6);
    applyMove(st as never, turn, pick(turn === AI ? seatAI : seatME, st, turn, die), die, CLASSIC);
    i++;
    if (isOver(st[turn], null)) break;
    turn = (1 - turn) as 0 | 1;
  }
  const a = totalOf(st[AI], 0, CLASSIC), m = totalOf(st[ME], 0, CLASSIC);
  return a > m ? 1 : a < m ? 0 : 0.5;
}

const vsAnchor = (bot: Policy, anchor: Policy, n: number) => {
  let w = 0;
  for (let g = 0; g < n; g++) w += play(bot, anchor);
  return w / n;
};
/* seats alternate so the first-move edge cancels; share for a */
const duel = (a: Policy, b: Policy, n: number) => {
  let w = 0;
  for (let g = 0; g < n; g++) w += g % 2 ? 1 - play(b, a) : play(a, b);
  return w / n;
};

const RANDOM: Policy = { random: true };
const MEDIUM: Policy = { depth: 2, risk: 0.9 };   // the offline Medium anchor

/* 1 · the ladder of strength: win rate vs a random mover must climb, and the
   floor must sit near random-parity. N shrinks with depth for gate time (the
   deep groups dominate the runtime); the run is seeded, so these are exact
   reruns, not samples. */
const n4 = (d: number) => (d >= 4 ? 60 : d >= 3 ? 150 : 600);
const vsRandom = GROUPS.map((g) => vsAnchor(g.bot, RANDOM, n4(g.bot.depth)));
if (!(vsRandom[0] <= 0.58)) {
  problems.push(`STONE wins ${(vsRandom[0] * 100).toFixed(1)}% vs a random mover — the floor is `
    + `not gentle. Someone who has just learned the rules must be able to beat it.`);
}
for (let i = 1; i < GROUPS.length; i++) {
  if (vsRandom[i] < vsRandom[i - 1] - 0.06) {
    problems.push(`${GROUPS[i].name} (${(vsRandom[i] * 100).toFixed(1)}%) is weaker vs random than `
      + `${GROUPS[i - 1].name} (${(vsRandom[i - 1] * 100).toFixed(1)}%) — the ladder is not ordered`);
  }
}
if (!(vsRandom[GROUPS.length - 1] >= 0.70)) {
  problems.push(`NEON wins only ${(vsRandom[GROUPS.length - 1] * 100).toFixed(1)}% vs random — the apex has gone soft`);
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

console.log(JSON.stringify({
  vsRandom: Object.fromEntries(GROUPS.map((g, i) => [g.name, +(vsRandom[i] * 100).toFixed(1)])),
  boneVsStone: +(boneVsStone * 100).toFixed(1),
  neonVsMedium: +(neonVsMedium * 100).toFixed(1),
  problems, errs,
}, null, 2));
