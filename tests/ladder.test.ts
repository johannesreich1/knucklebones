// The ladder's numbers, pinned. Every table here is copied from
// docs/LADDER.md — if the two ever disagree, one of them is a bug, and this
// file is the one that fails the gate.
import {
  SCALE, K, DENOM, START, LOSS_MULT, MIN_GAIN, MAX_LOSS,
  delta, applyDelta, GROUPS, groupOf,
  groupFill, toNext, peakState, inApex, botShapeAt, botPairBand, matchBand, APEX,
  boardGroup, settle, type LadderRow,
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
eq(GROUPS.map((g) => [g.id, g.floor, g.width]), [
  ['stone', 0, 300], ['bone', 300, 420], ['ivory', 720, 540],
  ['silver', 1260, 750], ['gold', 2010, 990], ['obsidian', 3000, 1350],
  ['neon', 4350, 0],
], 'the band table drifted from LADDER.md §2');

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
eq([0, 299, 300, 1259, 2010, 2999, 3000, 4350, 9999].map((points) => groupOf(points).id),
   ['stone', 'stone', 'bone', 'ivory', 'gold', 'gold', 'obsidian', 'neon', 'neon'],
   'group identity drifted');

/* the worked example: 2,494 is gold, 506 short of obsidian (floor 3,000) */
eq(groupOf(2494).id, 'gold', 'design card 92d and the ladder disagree');
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
      problems.push(`fill and toNext disagree at ${p} (${g.id}): ${implied} vs ${toNext(p)}`);
    }
  }
}

/* ---- §2 what a board row displays ---------------------------------------
   NEON is a position, so only the RPC's apex flag can grant it: a player whose
   points cross the fallback floor without the rank shows in OBSIDIAN. */
eq(boardGroup(4600, true).id, 'neon', 'the apex flag must grant NEON');
eq(boardGroup(500, true).id, 'neon', 'apex is a rank — the points do not veto it');
eq(boardGroup(4600, false).id, 'obsidian', 'points beyond the floor without the rank stay OBSIDIAN');
eq(boardGroup(3200, false).id, 'obsidian', 'below the floor the flag changes nothing');
eq(boardGroup(0, false).id, 'stone', 'the floor of the board is STONE');

/* ---- §5 the peak notch ------------------------------------------------- */
eq(peakState(2494, 2494), { kind: 'at' }, 'peak == points should draw no notch');
eq(peakState(2494, 2000), { kind: 'at' }, 'a peak behind the fill is impossible and must read as at');
eq(peakState(2494, 2610).kind, 'ahead', 'a peak further up the same group should sit on the ring');
eq(Math.round((peakState(2494, 2610) as { fill: number }).fill * 1000), 606,
   'the notch is not where the card draws it');
const demoted = peakState(2494, 3200);
eq(demoted.kind, 'above', 'a peak in a higher group should pin right');
eq((demoted as { group: { id: string } }).group.id, 'obsidian',
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
eq(APEX.id, 'neon', 'the apex is not neon');

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
/* A bot plays the shape of its OWN group — the label IS the strength. The
   numbers were tuned by simulation (2026-08-20; floor retuned 2026-08-21 for
   the onboarding promise); tests/botbench.test.ts keeps their ORDERING and
   the newcomer win rates honest, this table just pins them. */
eq(GROUPS.map((g) => [g.bot.depth, g.bot.risk, g.bot.oppW, g.bot.slip]), [
  [1, 0, -0.5, 0.55], [1, 0, 1, 0.45], [1, 0.25, 1, 0.15], [1, 0.6, 1, 0.05],
  [2, 1.2, 1, 0], [3, 1.2, 1, 0], [4, 1.2, 1, 0],
], 'the per-group bot shapes drifted from LADDER.md §4');
eq(botShapeAt(148), GROUPS[0].bot, 'a bot with STONE points must play the STONE shape');
eq(botShapeAt(9999), APEX.bot, 'a bot above the apex floor must play the NEON shape');
/* the floor's floor: slip alone bottoms out at random-parity (a half-greedy
   still wins 60% vs random, measured), so STONE is KILL-AVERSE — negative
   oppW prefers placements that spare the player's dice, the one below-random
   weakness that reads as a beginner rather than a drunk */
eq(botShapeAt(0).oppW < 0, true, 'the STONE bot must actively spare the player');
eq(botShapeAt(0).slip >= 0.3, true, 'a brand-new player must meet a bot that blunders');
eq(botShapeAt(4350).slip, 0, 'the top of the ladder must meet a bot that does not blunder');
/* every knob only ever tightens on the way up */
{
  let pv = GROUPS[0].bot;
  for (const g of GROUPS) {
    if (g.bot.depth < pv.depth) problems.push(`${g.id}: search depth fell`);
    if (g.bot.risk < pv.risk - 1e-9) problems.push(`${g.id}: risk sense fell`);
    if (g.bot.oppW < pv.oppW) problems.push(`${g.id}: board sight fell`);
    if (g.bot.slip > pv.slip + 1e-9) problems.push(`${g.id}: slip rose`);
    pv = g.bot;
  }
}
/* backfill pairing: a bot arrives from the player's own neighbourhood — the
   cap is what keeps "STONE bots are easy" true IN STONE */
eq(botPairBand(0), 300, 'a STONE player must meet bots within the STONE width');
eq(botPairBand(2500), 990, "the cap follows the player's own group");
eq(botPairBand(9999), 1350, "the apex borrows OBSIDIAN's width");
eq(matchBand(20), 750, 'a crowded band should stay tight');
eq(matchBand(0), 4500, 'an empty band should open all the way');
eq(matchBand(6) > matchBand(12), true, 'a sparser band must be wider');

console.log(JSON.stringify({ groups: GROUPS.length, problems, errs }, null, 2));
