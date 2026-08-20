// The ladder's numbers, pinned. Every table here is copied from
// docs/LADDER.md — if the two ever disagree, one of them is a bug, and this
// file is the one that fails the gate.
import {
  SCALE, K, DENOM, START, LOSS_MULT, MIN_GAIN, MAX_LOSS,
  delta, applyDelta, GROUPS, groupOf, rankName, nextRankName,
  groupFill, toNext, peakState, inApex, botShape, matchBand, APEX,
  settle, type LadderRow,
} from '../src/core/ladder.ts';

const problems: string[] = [];
const errs: string[] = [];
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(`${what} :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};

/* ---- §1 constants ------------------------------------------------------ */
eq([SCALE, K, DENOM, START, LOSS_MULT, MIN_GAIN, MAX_LOSS],
   [5, 160, 2000, 0, 0.75, 30, 120], 'the §1 constants drifted');
/* The denominator MUST be the scaled one. Left at 400 it costs 8 points of
   fidelity and squashes the range — the single most expensive silent mistake
   available here, so it gets its own assertion. */
eq(DENOM, 400 * SCALE, 'the logistic denominator no longer scales with the points');

/* ---- §1 "what a match is worth" ---------------------------------------- */
const worth = [2000, 1000, 500, 0, -500, -1000, -2000].map((gap) => ({
  gap, win: delta(1000, 1000 + gap, 1), loss: delta(1000, 1000 + gap, 0),
}));
eq(worth, [
  { gap:  2000, win: 145, loss:  -11 },
  { gap:  1000, win: 122, loss:  -28 },
  { gap:   500, win: 102, loss:  -43 },
  { gap:     0, win:  80, loss:  -60 },
  { gap:  -500, win:  58, loss:  -76 },
  { gap: -1000, win:  38, loss:  -91 },
  { gap: -2000, win:  30, loss: -109 },
], 'the per-match payout table drifted from LADDER.md §1');

/* a draw against an equal opponent is worth nothing either way */
eq(delta(1000, 1000, 0.5), 0, 'an even draw moved the ladder');
/* the clamps bind at the extremes */
eq(delta(0, 9000, 1) >= MIN_GAIN, true, 'a win below the floor paid less than MIN_GAIN');
eq(delta(9000, 0, 0) >= -MAX_LOSS, true, 'a loss cost more than MAX_LOSS');
/* and the floor holds */
eq(applyDelta(0, -120), 0, 'a loss at zero went negative');
eq(applyDelta(40, -120), 0, 'the floor is not zero');

/* ---- §2 the band table ------------------------------------------------- */
eq(GROUPS.map((g) => [g.name, g.floor, g.width]), [
  ['STONE', 0, 300], ['BONE', 300, 420], ['IVORY', 720, 540],
  ['SILVER', 1260, 750], ['GOLD', 2010, 990], ['OBSIDIAN', 3000, 1350],
  ['NEON', 4350, 0],
], 'the band table drifted from LADDER.md §2');

/* floors are exactly cumulative widths — the invariant that keeps a group from
   overlapping its neighbour or leaving a gap nobody can occupy */
let cursor = 0;
for (const g of GROUPS) {
  eq(g.floor, cursor, `${g.name}'s floor is not the sum of the widths below it`);
  cursor += g.width;
}
/* the ring is one continuous fill now, so nothing has to divide evenly into a
   group — but a width of zero would make groupFill divide by it */
for (const g of GROUPS) {
  if (g !== APEX) eq(g.width > 0, true, `${g.name} has no width`);
}

/* ---- naming: a GROUP is the whole rank, there are no divisions --------- */
eq([0, 299, 300, 1259, 2010, 2999, 3000, 4350, 9999].map(rankName),
   ['STONE', 'STONE', 'BONE', 'IVORY', 'GOLD', 'GOLD', 'OBSIDIAN', 'NEON', 'NEON'],
   'rank naming drifted');
eq(nextRankName(2494), 'OBSIDIAN', 'the next rank above GOLD is OBSIDIAN');
eq(nextRankName(5000), 'NEON', 'the apex has nothing above it');
/* nothing anywhere may still speak of divisions */
eq(/\b(I|II|III)\b/.test(rankName(2494)), false, 'a division numeral survived in the rank name');

/* the worked example: 2,494 is GOLD, 506 short of OBSIDIAN (floor 3,000) */
eq(rankName(2494), 'GOLD', 'design card 92d and the ladder disagree');
eq(toNext(2494), 506, 'the gap to the next GROUP is wrong');
eq(toNext(2010), 990, 'a group floor owes the whole width');
eq(toNext(5000), 0, 'the apex has no distance to anything');

/* ---- the ring: ONE continuous fill, a percentage of the group ---------- */
/* GOLD: floor 2010, width 990 */
eq(groupFill(2010), 0, 'a group floor should leave the ring empty');
eq(Math.round(groupFill(2494) * 1000), 489, 'the worked example does not match the ring');
eq(Math.round(groupFill(2999) * 1000), 999, 'the top of a group should very nearly fill the ring');
eq(groupFill(3000), 0, 'crossing into the next group must empty the ring');
eq(groupFill(9999), 1, 'the apex reads as full — it is a position, not a distance');
/* the fill only ever RISES with points, and never leaves 0..1 — the property
   that lets the ring animate by tweening one number */
let last = -1, lastGroup = groupOf(0);
for (let p = 0; p <= 4400; p += 3) {
  const f = groupFill(p);
  if (f < 0 || f > 1) { problems.push(`fill out of range at ${p}: ${f}`); break; }
  const g = groupOf(p);
  if (g === lastGroup && f < last - 1e-9) { problems.push(`fill went backwards at ${p}`); break; }
  last = f; lastGroup = g;
}
/* and the fill agrees with the distance still owed, at every point */
for (const g of GROUPS) {
  if (!g.width) continue;
  for (const p of [g.floor, g.floor + 1, g.floor + (g.width >> 1), g.floor + g.width - 1]) {
    const implied = Math.round((1 - groupFill(p)) * g.width);
    if (Math.abs(implied - toNext(p)) > 1) {
      problems.push(`fill and toNext disagree at ${p} (${g.name}): ${implied} vs ${toNext(p)}`);
    }
  }
}

/* ---- §5 the peak notch ------------------------------------------------- */
eq(peakState(2494, 2494), { kind: 'at' }, 'peak == points should draw no notch');
eq(peakState(2494, 2000), { kind: 'at' }, 'a peak behind the fill is impossible and must read as at');
eq(peakState(2494, 2610).kind, 'ahead', 'a peak further up the same group should sit on the ring');
eq(Math.round((peakState(2494, 2610) as { fill: number }).fill * 1000), 606,
   'the notch is not where the card draws it');
const demoted = peakState(2494, 3200);
eq(demoted.kind, 'above', 'a peak in a higher group should pin right');
eq((demoted as { group: { name: string } }).group.name, 'OBSIDIAN',
   'the pinned notch must still name the group it really sits in');
/* the invariant: never behind the fill, anywhere */
for (let p = 0; p < 4350; p += 53) {
  for (const extra of [0, 40, 400, 2000]) {
    const st = peakState(p, p + extra);
    if (st.kind === 'ahead' && st.fill < groupFill(p) - 1e-9) {
      problems.push(`notch behind the fill at ${p} (+${extra})`);
    }
  }
}

/* ---- the apex is a position -------------------------------------------- */
eq(inApex(9000, 40, 800), false, 'rank 40 of 800 is not the top 1%');
eq(inApex(500, 3, 800), true, 'the apex is a POSITION — points must not gate it');
eq(inApex(4400, 90, 40), true, 'a population too small for a 1% falls back to the point floor');
eq(inApex(4000, 1, 40), false, 'the small-population fallback still needs the floor');
eq(APEX.name, 'NEON', 'the apex is not NEON');

/* ---- settling a match --------------------------------------------------- */
const row = (points: number, peak = points): LadderRow => ({ points, peak, wins: 0, losses: 0, draws: 0 });

/* an even match: the winner gains more than the loser drops — the whole point */
const even = settle(row(1000), row(1000), 1);
eq([even.da, even.db], [80, -60], 'an even match settled wrong');
eq([even.a.points, even.b.points], [1080, 940], 'the settled points are wrong');
eq([even.a.wins, even.a.losses, even.b.wins, even.b.losses], [1, 0, 0, 1], 'the record did not follow the result');

/* a draw moves nothing and is recorded as neither */
const drawn = settle(row(1000), row(1000), 0.5);
eq([drawn.da, drawn.db, drawn.a.draws, drawn.b.draws], [0, 0, 1, 1], 'a draw was settled as something else');

/* peak is a high-water mark: it survives the loss that follows it */
const fell = settle(row(1000, 1400), row(1000), 0);
eq(fell.a.peak, 1400, 'the peak was lowered by a loss');
eq(fell.a.points < 1000, true, 'the loser did not lose points');

/* and it rises the moment the points do */
const rose = settle(row(1000, 1000), row(1000), 1);
eq(rose.a.peak, rose.a.points, 'a new high did not move the peak');

/* the floor holds through a settle, not just through applyDelta */
eq(settle(row(0), row(4000), 0).a.points, 0, 'a loss at zero went negative through settle');

/* whoever wins, the pair gains more than it loses — the inflation is real and
   deliberate, and this is the assertion that says so out loud */
eq(even.da + even.db > 0, true, 'the ladder stopped climbing');

/* ---- §4 difficulty and matchmaking ------------------------------------- */
eq([0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((p) => botShape(p).depth), [1, 1, 1, 1, 2, 3, 3],
   'the bot depth ramp drifted from LADDER.md §4');
eq(botShape(0).risk, 0, 'the bottom of the ladder must meet a bot blind to danger');
eq(botShape(0.05).slip > 0.4, true, 'a brand-new player must meet a bot that blunders');
eq(botShape(0.95).slip, 0, 'the top of the ladder must meet a bot that does not blunder');
/* risk ramps IN, never out */
let prev = -1;
for (let p = 0; p <= 1.0001; p += 0.02) {
  const r = botShape(p).risk;
  if (r < prev - 1e-9) { problems.push(`bot risk went backwards at pct ${p.toFixed(2)}`); break; }
  prev = r;
}
eq(matchBand(20), 750, 'a crowded band should stay tight');
eq(matchBand(0), 4500, 'an empty band should open all the way');
eq(matchBand(6) > matchBand(12), true, 'a sparser band must be wider');

console.log(JSON.stringify({ groups: GROUPS.length, problems, errs }, null, 2));
