// The ladder's numbers, pinned. Every table here is copied from
// docs/LADDER.md — if the two ever disagree, one of them is a bug, and this
// file is the one that fails the gate.
import {
  SCALE, K, DENOM, START, LOSS_MULT, MIN_GAIN, MAX_LOSS,
  delta, applyDelta, GROUPS, groupOf, divisionOf, rankName, nextRankName,
  ringFill, groupFill, toNext, peakState, inApex, botShape, matchBand, APEX,
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
/* every group divides into three whole numbers, because the ring draws three
   equal segments and a fractional division would make it lie */
for (const g of GROUPS) {
  if (g.width) eq(g.width % 3, 0, `${g.name} does not split into three whole divisions`);
}

/* ---- naming ------------------------------------------------------------ */
eq([0, 299, 300, 1259, 2010, 2339, 2340, 2669, 2670, 2999, 3000, 4350, 9999]
     .map(rankName),
   ['STONE III', 'STONE I', 'BONE III', 'IVORY I', 'GOLD III', 'GOLD III',
    'GOLD II', 'GOLD II', 'GOLD I', 'GOLD I', 'OBSIDIAN III', 'NEON', 'NEON'],
   'rank naming drifted');
eq(nextRankName(2494), 'GOLD I', 'the next rank from GOLD II is wrong');
eq(nextRankName(2900), 'OBSIDIAN III', 'the top division should point at the next GROUP');
eq(nextRankName(5000), 'NEON', 'the apex has nothing above it');

/* the card's own worked example: 2,494 is GOLD II with 176 to GOLD I */
eq(rankName(2494), 'GOLD II', 'design card 92d and the ladder disagree');
eq(toNext(2494), 176, 'design card 92d and the ladder disagree on the gap');

/* ---- the ring ---------------------------------------------------------- */
/* GOLD: floor 2010, width 990, divisions of 330 */
eq(ringFill(2010), [0, 0, 0], 'a group floor should leave the ring empty');
eq(ringFill(2340), [1, 0, 0], 'one division cleared should fill exactly one segment');
eq(ringFill(2999).map((f) => Math.round(f * 1000)), [1000, 1000, 997],
   'the top of a group should very nearly fill the ring');
eq(ringFill(2494).map((f) => Math.round(f * 1000)), [1000, 467, 0],
   'the worked example does not match the ring the card draws');
eq(Math.round(groupFill(2494) * 1000), 489, 'the overall sweep drifted');
/* segments never run backwards, at any point of any group */
for (const g of GROUPS) {
  if (!g.width) continue;
  for (let p = g.floor; p < g.floor + g.width; p += 7) {
    const f = ringFill(p);
    if (!(f[0] >= f[1] && f[1] >= f[2])) {
      problems.push(`ring segments out of order at ${p} (${g.name}): ${JSON.stringify(f)}`);
      break;
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
