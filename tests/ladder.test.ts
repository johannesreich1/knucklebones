// The ladder's numbers, pinned. Every table here is copied from
// docs/LADDER.md — if the two ever disagree, one of them is a bug, and this
// file is the one that fails the gate.
import {
  SCALE, K, DENOM, START, LOSS_MULT, MIN_GAIN, MAX_LOSS,
  LADDER_CURVE_V1, LADDER_CURVE_V2, LADDER_CURVE_VERSION,
  LADDER_FORMULA_V1, LADDER_FORMULA_V2, LADDER_FORMULA_VERSION,
  MIN_FINISH_TRANSFER, MAX_FINISH_TRANSFER,
  delta, applyDelta, GROUPS, GROUPS_V1, GROUPS_V2, groupsForCurve, groupOf,
  groupFill, groupRingFill, groupRingPeakState, toNext, peakState,
  inApex, botShapeAt, botPairBand, matchBand, APEX,
  boardGroup, settle, requestedFinishTransfer, remapLadderPointsV1ToV2,
  type LadderRow,
} from '../src/core/ladder.ts';

const problems: string[] = [];
const errs: string[] = [];
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(`${what} :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};
const throws = (run: () => unknown, what: string) => {
  try {
    run();
    problems.push(`${what} :: did not throw`);
  } catch {
    // expected
  }
};

/* ---- §1 constants ------------------------------------------------------ */
eq([SCALE, K, DENOM, START, LOSS_MULT, MIN_GAIN, MAX_LOSS],
   [5, 160, 2000, 0, 0.75, 30, 120], 'the §1 constants drifted');
eq([LADDER_CURVE_VERSION, LADDER_FORMULA_VERSION, MIN_FINISH_TRANSFER, MAX_FINISH_TRANSFER],
  [2, 2, 2, 7], 'the versioned curve/finish contracts drifted');
eq([LADDER_CURVE_V1, LADDER_CURVE_V2], [1, 2], 'ladder curve version ids drifted');
eq([LADDER_FORMULA_V1, LADDER_FORMULA_V2], [1, 2], 'ladder formula version ids drifted');
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
eq(GROUPS.map((g) => [g.id, g.floor, g.width]), [
  ['stone', 0, 360], ['bone', 360, 480], ['ivory', 840, 650],
  ['silver', 1490, 1000], ['gold', 2490, 1400], ['obsidian', 3890, 2200],
  ['neon', 6090, 0],
], 'the band table drifted from LADDER.md §2');
eq(GROUPS, GROUPS_V2, 'the authority default is not curve v2');
eq(groupsForCurve(LADDER_CURVE_V1), GROUPS_V1, 'curve v1 registry lookup drifted');
eq(GROUPS_V1.map((g) => [g.id, g.floor, g.width]), [
  ['stone', 0, 300], ['bone', 300, 420], ['ivory', 720, 540],
  ['silver', 1260, 750], ['gold', 2010, 990], ['obsidian', 3000, 1350],
  ['neon', 4350, 0],
], 'the complete curve-v1 registry was not retained for rollout');
eq(GROUPS_V1.map(({ bot }) => bot), GROUPS_V2.map(({ bot }) => bot),
  'curve selection changed calibrated bot shapes');
throws(() => groupsForCurve(99 as typeof LADDER_CURVE_V1),
  'an unknown curve version fell back');

/* The cutover preserves the old group and its ring position. Old OBSIDIAN is
   intentionally extrapolated beyond both positional fallback floors. */
eq([
  0, 150, 299, 300, 510, 719, 720, 990, 1259, 1260, 2010, 2494, 3000, 4350, 5000,
].map(remapLadderPointsV1ToV2), [
  0, 180, 359, 360, 600, 839, 840, 1165, 1489, 1490, 2490, 3174, 3890, 6090, 7149,
], 'the v1 → v2 group-local point mapping drifted');
let lastMapped = -1;
for (let oldPoints = 0; oldPoints <= 8000; oldPoints++) {
  const mapped = remapLadderPointsV1ToV2(oldPoints);
  if (mapped < lastMapped) {
    problems.push(`the curve mapping stopped being monotonic at ${oldPoints}`);
    break;
  }
  lastMapped = mapped;
}
throws(() => remapLadderPointsV1ToV2(-1), 'negative legacy points were mapped');
throws(() => remapLadderPointsV1ToV2(1.5), 'fractional legacy points were mapped');

/* floors are exactly cumulative widths — the invariant that keeps a group from
   overlapping its neighbour or leaving a gap nobody can occupy */
let cursor = 0;
for (const g of GROUPS) {
  eq(g.floor, cursor, `${g.id}'s floor is not the sum of the widths below it`);
  cursor += g.width;
}
/* the ring is one continuous fill now, so nothing has to divide evenly into a
   group — but a width of zero would make groupFill divide by it */
for (const g of GROUPS) {
  if (g !== APEX) eq(g.width > 0, true, `${g.id} has no width`);
}

/* ---- stable group identity: player-visible names live in i18n catalogs -- */
eq([0, 359, 360, 1489, 2490, 3889, 3890, 6090, 9999].map((points) => groupOf(points).id),
   ['stone', 'stone', 'bone', 'ivory', 'gold', 'gold', 'obsidian', 'neon', 'neon'],
   'group identity drifted');
eq([0, 299, 300, 719, 720, 1259, 2010, 2999, 3000, 4350].map((points) =>
  groupOf(points, LADDER_CURVE_V1).id),
  ['stone', 'stone', 'bone', 'bone', 'ivory', 'ivory', 'gold', 'gold', 'obsidian', 'neon'],
  'explicit curve-v1 group identity drifted during rollout');
eq([
  groupFill(2494, LADDER_CURVE_V1),
  toNext(2494, LADDER_CURVE_V1),
  boardGroup(4600, false, LADDER_CURVE_V1).id,
  botPairBand(2500, LADDER_CURVE_V1),
  inApex(4400, 90, 40, LADDER_CURVE_V1),
], [
  (2494 - 2010) / 990,
  506,
  'obsidian',
  990,
  true,
], 'curve-v1 display/match helpers mixed in v2 floors');
eq(peakState(2494, 3200, LADDER_CURVE_V1).kind, 'above',
  'curve-v1 peak state used v2 group boundaries');

/* a target-curve worked example: 3,000 is GOLD, 890 short of OBSIDIAN */
eq(groupOf(3000).id, 'gold', 'the target worked example is not GOLD');
eq(toNext(3000), 890, 'the gap to the next GROUP is wrong');
eq(toNext(2490), 1400, 'a group floor owes the whole width');
eq(toNext(7000), 0, 'the apex has no distance to anything');

/* ---- the ring: ONE continuous fill, a percentage of the group ---------- */
/* GOLD: floor 2,490, width 1,400 */
eq(groupFill(2490), 0, 'a group floor should leave the ring empty');
eq(Math.round(groupFill(3000) * 1000), 364, 'the worked example does not match the ring');
eq(Math.round(groupFill(3889) * 1000), 999, 'the top of a group should very nearly fill the ring');
eq(groupFill(3890), 0, 'crossing into the next group must empty the ring');
eq(groupFill(9999), 1, 'the apex reads as full — it is a position, not a distance');
eq(groupRingFill(3000, false), groupFill(3000),
   'a bounded league ring must keep its points-based progress');
eq(groupRingFill(3000, true), 1,
   'a positional NEON ring must be full even below the fallback points floor');
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
      problems.push(`fill and toNext disagree at ${p} (${g.id}): ${implied} vs ${toNext(p)}`);
    }
  }
}

/* ---- §2 what a board row displays ---------------------------------------
   NEON is a position, so only the RPC's apex flag can grant it: a player whose
   points cross the fallback floor without the rank shows in OBSIDIAN. */
eq(boardGroup(6500, true).id, 'neon', 'the apex flag must grant NEON');
eq(boardGroup(500, true).id, 'neon', 'apex is a rank — the points do not veto it');
eq(boardGroup(6500, false).id, 'obsidian', 'points beyond the floor without the rank stay OBSIDIAN');
eq(boardGroup(4200, false).id, 'obsidian', 'below the floor the flag changes nothing');
eq(boardGroup(0, false).id, 'stone', 'the floor of the board is STONE');

/* ---- §5 the peak notch ------------------------------------------------- */
eq(peakState(3000, 3000), { kind: 'at' }, 'peak == points should draw no notch');
eq(peakState(3000, 2400), { kind: 'at' }, 'a peak behind the fill is impossible and must read as at');
eq(peakState(3000, 3200).kind, 'ahead', 'a peak further up the same group should sit on the ring');
eq(Math.round((peakState(3000, 3200) as { fill: number }).fill * 1000), 507,
   'the notch is not where the card draws it');
const demoted = peakState(3000, 4200);
eq(demoted.kind, 'above', 'a peak in a higher group should pin right');
eq((demoted as { group: { id: string } }).group.id, 'obsidian',
   'the pinned notch must still name the group it really sits in');
eq(groupRingPeakState(3000, 3200, true), { kind: 'at' },
   'an unbounded NEON ring must not place a peak notch on a made-up scale');
/* the invariant: never behind the fill, anywhere */
for (let p = 0; p < 6090; p += 53) {
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
eq(inApex(6200, 90, 40), true, 'a population too small for a 1% falls back to the point floor');
eq(inApex(6000, 1, 40), false, 'the small-population fallback still needs the floor');
eq(APEX.id, 'neon', 'the apex is not neon');

/* ---- settling a match --------------------------------------------------- */
const row = (points: number, peak = points): LadderRow => ({ points, peak, wins: 0, losses: 0, draws: 0 });

/* an even match: the winner gains more than the loser drops — the whole point */
const even = settle(row(1000), row(1000), 1);
eq([even.da, even.db], [80, -60], 'an even match settled wrong');
eq(even.formulaVersion, LADDER_FORMULA_V1,
  'a backwards-compatible settle mislabeled itself as formula v2');
eq([even.aDelta, even.bDelta], [
  { base: 80, finish: 0, total: 80 },
  { base: -60, finish: 0, total: -60 },
], 'a legacy/default settle did not expose zero finish components');
eq([even.a.points, even.b.points], [1080, 940], 'the settled points are wrong');
eq([even.a.wins, even.a.losses, even.b.wins, even.b.losses], [1, 0, 0, 1], 'the record did not follow the result');

/* a draw moves nothing and is recorded as neither */
const drawn = settle(row(1000), row(1000), 0.5);
eq([drawn.da, drawn.db, drawn.a.draws, drawn.b.draws], [0, 0, 1, 1], 'a draw was settled as something else');

/* ...and it moves nothing between MISMATCHED players either, which is the part
   Elo would argue with. Holding someone 2000 above once paid +65 and failing to
   convert against someone 2000 below cost 49; both are now 0. The tally still
   records it. Reachable only by dice in this game (no drawn match in the first
   30 played out in production), so the signal being discarded is noise. */
const lopsided = settle(row(0), row(4000), 0.5);
eq([lopsided.da, lopsided.db], [0, 0], 'a draw between mismatched players still paid');
eq([lopsided.a.draws, lopsided.b.draws], [1, 1], 'a mismatched draw was not recorded');
eq([lopsided.a.points, lopsided.b.points], [0, 4000], 'a draw moved the points');
for (const [mine, theirs] of [[0, 4000], [4000, 0], [300, 720], [2000, 2000]] as const) {
  eq(delta(mine, theirs, 0.5), 0, `a draw at ${mine} vs ${theirs} paid something`);
}

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

/* ---- decided formula-v2 finish transfer ------------------------------- */
eq([
  [41, 39], [50, 45], [50, 40], [50, 35], [60, 30], [60, 0],
].map(([winner, loser]) => requestedFinishTransfer(winner, loser)),
  [2, 3, 3, 4, 5, 7], 'winner-relative finish bands drifted');
throws(() => requestedFinishTransfer(0, 0), 'a drawn zero board requested a transfer');
throws(() => requestedFinishTransfer(40, 40), 'a draw requested a transfer');
throws(() => requestedFinishTransfer(39, 40), 'a losing score requested a winner transfer');
throws(() => requestedFinishTransfer(4.5, 2), 'fractional board scores were accepted');

const marginWin = settle(row(1000), row(1000), 1, {
  finish: { kind: 'normal', aScore: 50, bScore: 45 },
});
eq(marginWin.formulaVersion, LADDER_FORMULA_V2,
  'a finish-margin settle did not carry its formula version');
eq([marginWin.aDelta, marginWin.bDelta], [
  { base: 80, finish: 3, total: 83 },
  { base: -60, finish: -3, total: -63 },
], 'a normal decisive finish did not transfer its requested three points');
eq([marginWin.da, marginWin.db, marginWin.a.points, marginWin.b.points],
  [83, -63, 1083, 937], 'finish components and settled totals disagree');

const marginLoss = settle(row(1000), row(1000), 0, {
  finish: { kind: 'normal', aScore: 30, bScore: 60 },
});
eq([marginLoss.aDelta.finish, marginLoss.bDelta.finish, marginLoss.da, marginLoss.db],
  [-5, 5, -65, 85], 'seat-B winner finish signs are not antisymmetric');

const forced = settle(row(1000), row(1000), 1, { finish: { kind: 'forced' } });
eq([forced.aDelta, forced.bDelta], [
  { base: 80, finish: 7, total: 87 },
  { base: -60, finish: -7, total: -67 },
], 'a forfeit did not request the maximum transfer');

const capped = settle(row(0), row(3400), 1, { finish: { kind: 'forced' } });
eq([capped.bDelta.base, capped.aDelta.finish, capped.bDelta.finish, capped.bDelta.total],
  [-118, 2, -2, -120], 'the loss cap did not reduce a maximum finish transfer');

const floorReduced = settle(row(60), row(60), 1, { finish: { kind: 'forced' } });
eq([floorReduced.aDelta.finish, floorReduced.bDelta.finish, floorReduced.b.points],
  [0, 0, 0], 'the zero floor manufactured a finish transfer');
const floorPartial = settle(row(62), row(62), 1, { finish: { kind: 'forced' } });
eq([floorPartial.aDelta.finish, floorPartial.bDelta.finish, floorPartial.b.points],
  [2, -2, 0], 'the zero floor did not apply only the funded finish transfer');

const marginDraw = settle(row(1000), row(1000), 0.5, {
  finish: { kind: 'normal', aScore: 40, bScore: 40 },
});
eq([marginDraw.aDelta.finish, marginDraw.bDelta.finish, marginDraw.da, marginDraw.db],
  [0, 0, 0, 0], 'a draw transferred finish points');

/* ---- §4 difficulty and matchmaking ------------------------------------- */
/* A bot plays the shape of its OWN group — the label IS the strength. The
   numbers were tuned by simulation (2026-08-20; full curve corrected
   2026-08-26 after the 0–0 seat-perspective report); botbench keeps the
   human-favoured outcome curve honest, this table just pins the shapes. */
eq(GROUPS.map((g) => [g.bot.depth, g.bot.risk, g.bot.oppW, g.bot.slip, g.bot.openerSlip]), [
  [1, 0, -0.5, 0.70, 0.70], [1, 0, 0, 0.70, 0.70], [1, 0.25, 0.05, 0.60, 0.60],
  [1, 0.6, 1, 0.72, 0.675], [2, 1.2, 1, 0.68, 0.67],
  [3, 1.2, 1, 0.68, 0.66], [4, 1.2, 1, 0.66, 0.65],
], 'the per-group bot shapes drifted from LADDER.md §4');
eq(botShapeAt(148), GROUPS[0].bot, 'a bot with STONE points must play the STONE shape');
eq(botShapeAt(9999), APEX.bot, 'a bot above the apex floor must play the NEON shape');
/* the floor's floor: slip alone bottoms out at random-parity (a half-greedy
   still wins 60% vs random, measured), so STONE is KILL-AVERSE — negative
   oppW prefers placements that spare the player's dice, the one below-random
   weakness that reads as a beginner rather than a drunk */
eq(botShapeAt(0).oppW < 0, true, 'the STONE bot must actively spare the player');
eq(botShapeAt(0).slip >= 0.3, true, 'a brand-new player must meet a bot that blunders');
eq(botShapeAt(6090).slip, 0.66, 'NEON must approach parity from the human-favoured side');
/* Search understanding still tightens on the way up. Slip is the measured
   counterweight that keeps deeper search from making any bot the favourite. */
{
  let pv = GROUPS[0].bot;
  for (const g of GROUPS) {
    if (g.bot.depth < pv.depth) problems.push(`${g.id}: search depth fell`);
    if (g.bot.risk < pv.risk - 1e-9) problems.push(`${g.id}: risk sense fell`);
    if (g.bot.oppW < pv.oppW) problems.push(`${g.id}: board sight fell`);
    pv = g.bot;
  }
}
/* backfill pairing: a bot arrives from the player's own neighbourhood — the
   cap is what keeps "STONE bots are easy" true IN STONE */
eq(botPairBand(0), 360, 'a STONE player must meet bots within the STONE width');
eq(botPairBand(2500), 1400, "the cap follows the player's own group");
eq(botPairBand(9999), 2200, "the apex borrows OBSIDIAN's width");
eq(matchBand(20), 750, 'a crowded band should stay tight');
eq(matchBand(0), 4500, 'an empty band should open all the way');
eq(matchBand(6) > matchBand(12), true, 'a sparser band must be wider');

console.log(JSON.stringify({ groups: GROUPS.length, problems, errs }, null, 2));
