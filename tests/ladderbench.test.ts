// The ladder, simulated. The unit tests pin the arithmetic; this pins the
// BEHAVIOUR — that the thing still ranks people correctly after a season of
// play, and that the shape docs/LADDER.md promises is the shape it produces.
//
// Every claim in LADDER.md's appendix came from a run like this one. Keeping
// it in the gate means a future tweak to K, the multiplier or the bands cannot
// quietly turn the ladder into a coin-flip: fidelity below 0.89 fails.
import { delta, applyDelta, groupOf, GROUPS, SCALE, START } from '../src/core/ladder.ts';

const problems: string[] = [];
const errs: string[] = [];

/* deterministic everywhere: the gate may not depend on the machine's mood */
const seeded = (seed: number) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

function season(players: number, games: number, seed: number) {
  const rnd = seeded(seed);
  const gauss = () => {
    let u = 0, v = 0;
    while (!u) u = rnd();
    while (!v) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  /* true skill on the CLASSIC scale — the simulated world does not know about
     our display scale, which is the point: the ladder has to find the order */
  const skill = Array.from({ length: players }, () => gauss() * 180);
  const pts = Array<number>(players).fill(START);
  const band = 150 * SCALE;
  for (let i = 0; i < games * players / 2; i++) {
    const a = Math.floor(rnd() * players);
    let b = Math.floor(rnd() * players), tries = 0;
    while ((b === a || Math.abs(pts[a] - pts[b]) > band) && tries++ < 40) b = Math.floor(rnd() * players);
    if (b === a) continue;
    const pA = 1 / (1 + Math.pow(10, (skill[b] - skill[a]) / 400));
    const aWon = rnd() < pA;
    pts[a] = applyDelta(pts[a], delta(pts[a], pts[b], aWon ? 1 : 0));
    pts[b] = applyDelta(pts[b], delta(pts[b], pts[a], aWon ? 0 : 1));
  }
  /* Spearman: does the ladder's order match the true order? */
  const byPts = [...pts.keys()].sort((i, j) => pts[i] - pts[j]);
  const bySkill = [...skill.keys()].sort((i, j) => skill[i] - skill[j]);
  const rp = new Map(byPts.map((v, i) => [v, i]));
  const rs = new Map(bySkill.map((v, i) => [v, i]));
  let d2 = 0;
  for (let i = 0; i < players; i++) d2 += (rp.get(i)! - rs.get(i)!) ** 2;
  const sorted = [...pts].sort((x, y) => x - y);
  return {
    fidelity: 1 - (6 * d2) / (players * (players * players - 1)),
    p10: sorted[Math.floor(players * 0.1)],
    median: sorted[players >> 1],
    p90: sorted[Math.floor(players * 0.9)],
    floored: pts.filter((p) => p === 0).length,
    pts,
  };
}

const N = 800, GAMES = 250;
const run = season(N, GAMES, 20260820);

/* 1 · the ladder still ranks people. This is the number that matters: it is
   what a bigger K quietly destroys, and what the whole scale-the-display
   approach exists to protect. */
const FLOOR = 0.89;
if (!(run.fidelity >= FLOOR)) {
  problems.push(`skill fidelity ${run.fidelity.toFixed(3)} is below ${FLOOR} — the ladder has `
    + `stopped ranking players correctly. Check K, LOSS_MULT and especially DENOM.`);
}

/* 2 · nobody is trapped at the floor. A ratchet at zero is the point; a pit is
   not — if a real share of players cannot move, the min-gain clamp is broken. */
if (run.floored > N * 0.02) {
  problems.push(`${run.floored} of ${N} players stuck at 0 — MIN_GAIN is not paying out`);
}

/* 3 · the spread LADDER.md promises. Generous bounds: this is here to catch a
   constant being changed by an order of magnitude, not to freeze the model. */
if (!(run.median > 1500 && run.median < 4200)) {
  problems.push(`median ${run.median} outside the shape LADDER.md describes (1500..4200)`);
}
if (!(run.p90 > run.median && run.median > run.p10)) {
  problems.push('the distribution is not ordered — something is very wrong');
}

/* 4 · every group is REACHABLE and none swallows the field. Equal-width bands
   failed exactly here, and a future retune could too. */
const pop = new Map<string, number>();
for (const p of run.pts) pop.set(groupOf(p).id, (pop.get(groupOf(p).id) ?? 0) + 1);
const biggest = Math.max(...[...pop.values()]);
if (biggest > N * 0.55) {
  problems.push(`one group holds ${biggest} of ${N} players — the bands are not spreading the field`);
}

/* 5 · a fixed apex cannot stay scarce, which is WHY NEON is positional. If this
   ever stops being true the argument in LADDER.md §2 has changed and the doc
   needs revisiting — so the gate asserts the premise, not just the conclusion. */
const long = season(600, 600, 20260821);
const overApex = long.pts.filter((p) => p >= GROUPS[GROUPS.length - 1].floor).length;
if (overApex < 600 * 0.3) {
  problems.push(`only ${overApex} of 600 cleared the apex floor in a long season — the premise `
    + `behind a POSITIONAL apex (LADDER.md §2) no longer holds; re-read it before shipping`);
}

console.log(JSON.stringify({
  season: { games: GAMES, players: N },
  fidelity: +run.fidelity.toFixed(3),
  p10: run.p10, median: run.median, p90: run.p90, flooredAtZero: run.floored,
  groups: Object.fromEntries([...pop].sort((a, b) => b[1] - a[1])),
  longSeasonClearedFixedApex: `${overApex}/600`,
  problems, errs,
}, null, 2));
