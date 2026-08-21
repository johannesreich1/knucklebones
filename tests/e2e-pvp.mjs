// LIVE end-to-end test of the PvP pipeline: two real users matchmake, play a
// full match through pvp-move, Elo moves zero-sum; then a bot-backfill match;
// plus the adversarial paths (out-of-turn, illegal column, rating tampering,
// seed secrecy). NOT part of the automated gate (mutates live data; needs two
// SQL-created confirmed users — see e2e instructions in the repo README).
//   node --experimental-strip-types tests/e2e-pvp.mjs
const URL = 'https://euzjcejbkxvqfrttgaxu.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1empjZWpia3h2cWZydHRnYXh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTgxNTgsImV4cCI6MjEwMjQ3NDE1OH0.WIhtcBLc_0mnINapuBqoJVeqqLfx6jHvexRwO5e1KyY';
const USERS = [
  { email: 'e2e.pvp.alice@example.com', pass: 'e2e-pvp-password-1!' },
  { email: 'e2e.pvp.bob@example.com', pass: 'e2e-pvp-password-2!' },
];

const problems = [];
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
const api = async (path, opts = {}, token = ANON) => {
  const res = await fetch(URL + path, {
    ...opts,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`,
               'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  let body = null; try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
};
const login = async (u) => {
  const r = await api('/auth/v1/token?grant_type=password', {
    method: 'POST', body: JSON.stringify({ email: u.email, password: u.pass }) });
  check(r.status === 200, 'login failed ' + u.email, r);
  return { jwt: r.body.access_token, id: r.body.user.id };
};
const myRating = async (u) => {
  const r = await api(`/rest/v1/profiles?id=eq.${u.id}&select=rating,nickname`, {}, u.jwt);
  return r.body?.[0];
};

const alice = await login(USERS[0]);
const bob = await login(USERS[1]);
const aliceBefore = await myRating(alice), bobBefore = await myRating(bob);

// ---- adversarial: self-boost rating via REST must fail ----
const boost = await api(`/rest/v1/profiles?id=eq.${alice.id}`, {
  method: 'PATCH', headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ rating: 9999 }) }, alice.jwt);
check(boost.status === 401 || boost.status === 403 || boost.status === 404,
  'rating self-boost was not denied', boost);

// ---- matchmaking: alice queues, bob pairs ----
const j1 = await api('/functions/v1/pvp-join', { method: 'POST', body: '{}' }, alice.jwt);
check(j1.status === 200 && j1.body.status === 'queued', 'alice should queue first', j1);
const j2 = await api('/functions/v1/pvp-join', { method: 'POST', body: '{}' }, bob.jwt);
check(j2.status === 200 && j2.body.status === 'matched', 'bob should pair with alice', j2);
const match = j2.body.match;
/* seats follow the first-move handicap: the LOWER-rated player is p1 and
   starts; only a dead tie falls back to the longer wait (alice). The e2e
   accounts' ratings drift run to run, so the test derives the expected seat
   instead of hardcoding alice — that assumption broke the first time their
   ratings diverged. */
const expectedP1 = aliceBefore.rating < bobBefore.rating ? alice.id
                 : bobBefore.rating < aliceBefore.rating ? bob.id : alice.id;
check(match.p1 === expectedP1, 'seats ignore the first-move handicap', { match, a: aliceBefore.rating, b: bobBefore.rating });
check([alice.id, bob.id].includes(match.p1) && [alice.id, bob.id].includes(match.p2) && match.p1 !== match.p2,
  'match seats are not the two e2e players', match);
/* everything below speaks SEATS, not names: core index 1 = p1 and moves first */
const seatP1 = match.p1 === alice.id ? alice : bob;
const seatP2 = match.p2 === alice.id ? alice : bob;

// ---- adversarial: seed secrecy + out-of-turn + illegal col ----
const seedPeek = await api(`/rest/v1/match_seeds?match_id=eq.${match.id}&select=*`, {}, alice.jwt);
check(!Array.isArray(seedPeek.body) || seedPeek.body.length === 0, 'seed readable by participant!', seedPeek);
const oot = await api('/functions/v1/pvp-move', {
  method: 'POST', body: JSON.stringify({ match_id: match.id, col: 0 }) }, seatP2.jwt);
check(oot.status === 409, 'out-of-turn move not rejected', oot);
const badCol = await api('/functions/v1/pvp-move', {
  method: 'POST', body: JSON.stringify({ match_id: match.id, col: 7 }) }, seatP1.jwt);
check(badCol.status === 422, 'illegal column not rejected', badCol);

// ---- play the full match: movers try columns until the server accepts one
// (the server is the authority on legality; 422 just means "not that one") ----
let state = match, moves = 0;
while (state.status === 'active' && moves < 100) {
  const mover = state.turn === 1 ? seatP1 : seatP2;
  let accepted = null;
  for (const c of [0, 1, 2]) {
    const r = await api('/functions/v1/pvp-move', {
      method: 'POST', body: JSON.stringify({ match_id: match.id, col: c }) }, mover.jwt);
    if (r.status === 200) { accepted = r; break; }
    if (r.status !== 422) { check(false, 'unexpected move error', r); break; }
  }
  if (!accepted) { check(false, 'no column accepted', state); break; }
  state = accepted.body.match;
  moves++;
}
check(state.status === 'done', 'match did not finish', { status: state.status, moves });
check(state.winner === alice.id || state.winner === bob.id || state.winner === null, 'weird winner', state);

// ---- the ladder moved. The match row names what it PAID (the only honest
// delta — the profile mirror floors at 0, core/ladder applyDelta). The climb
// is asymmetric BY DESIGN (LOSS_MULT): a win pays more than the loss takes,
// so the deltas sum positive, never to zero — that zero-sum era ended with
// Elo. ----
const paid = (m, u) => m.p1 === u.id ? m.p1_rating_delta : m.p2_rating_delta;
const aliceAfter = await myRating(alice), bobAfter = await myRating(bob);
const dA = paid(state, alice), dB = paid(state, bob);
if (state.winner !== null) {
  const [wD, lD] = state.winner === alice.id ? [dA, dB] : [dB, dA];
  check(wD > 0 && lD < 0 && wD + lD > 0, 'h2h payout shape wrong (win > 0 > loss, sum positive)',
    { dA, dB, winner: state.winner });
}

// ---- resign: quitting flips the match to the OPPONENT instantly — no stall
// to prove, no turn to wait for — and the leaver's next join gets fresh
// matchmaking, never the dead match back. Two rounds, so the leg also proves
// resign on an empty board and leaves the live queue exactly as it found it:
// bob's probe-join queues him, alice's join consumes that entry. ----
const rq1 = await api('/functions/v1/pvp-join', { method: 'POST', body: '{}' }, alice.jwt);
check(rq1.status === 200 && rq1.body.status === 'queued', 'alice should queue for the resign leg', rq1);
const rq2 = await api('/functions/v1/pvp-join', { method: 'POST', body: '{}' }, bob.jwt);
check(rq2.status === 200 && rq2.body.status === 'matched' && !rq2.body.rejoined, 'bob should pair for the resign leg', rq2);
const rmatch = rq2.body.match;
const rg = await api('/functions/v1/pvp-claim', {
  method: 'POST', body: JSON.stringify({ match_id: rmatch.id, resign: true }) }, bob.jwt);
check(rg.status === 200 && rg.body.match?.status === 'forfeit' && rg.body.match?.winner === alice.id,
  'resign did not flip the match to the opponent', rg);
// resigning again answers match-over — the status guard never re-settles
const rg2 = await api('/functions/v1/pvp-claim', {
  method: 'POST', body: JSON.stringify({ match_id: rmatch.id, resign: true }) }, bob.jwt);
check(rg2.status === 409 && rg2.body?.error === 'match-over', 'second resign was not refused as over', rg2);
// the points went with it — same payout shape as any decisive match
const rdA = rg.body.match?.p1 === alice.id ? rg.body.match.p1_rating_delta : rg.body.match?.p2_rating_delta;
const rdB = rg.body.match?.p1 === bob.id ? rg.body.match.p1_rating_delta : rg.body.match?.p2_rating_delta;
check(rdA > 0 && rdB < 0 && rdA + rdB > 0, 'resign payout shape wrong (opponent gains, leaver pays)', { rdA, rdB });
// the leaver is FREE: joining again queues fresh instead of rejoining the corpse
const rj = await api('/functions/v1/pvp-join', { method: 'POST', body: '{}' }, bob.jwt);
check(rj.status === 200 && rj.body.status === 'queued', 'resigned match was offered back on rejoin', rj);
// pair them once more (consumes bob's queue entry) and resign the EMPTY board
const rq3 = await api('/functions/v1/pvp-join', { method: 'POST', body: '{}' }, alice.jwt);
check(rq3.status === 200 && rq3.body.status === 'matched' && !rq3.body.rejoined
  && rq3.body.match.id !== rmatch.id, 'alice should pair fresh with queued bob', rq3);
const rg3 = await api('/functions/v1/pvp-claim', {
  method: 'POST', body: JSON.stringify({ match_id: rq3.body.match.id, resign: true }) }, bob.jwt);
check(rg3.status === 200 && rg3.body.match?.status === 'forfeit' && rg3.body.match?.winner === alice.id
  && rg3.body.match?.p1_score === 0 && rg3.body.match?.p2_score === 0,
  'empty-board resign did not settle 0-0 to the opponent', rg3);

// ---- bot backfill: alice queues alone, allows a bot, plays it out ----
const jb = await api('/functions/v1/pvp-join', {
  method: 'POST', body: JSON.stringify({ allow_bot: true }) }, alice.jwt);
check(jb.status === 200 && jb.body.status === 'matched' && jb.body.you === 1, 'bot match not created', jb);
let bm = jb.body.match, bmoves = 0, sawBotMove = false;

// ---- away handling vs a bot: no second client exists, so the absent human's
// own (backgrounded) client asks with auto:true — and the server still proves
// the stall on its OWN clock before handing the turn to a die + the bot its
// reply. Immediately: refused. After AUTO_MS: one full round, turn back to us.
const early = await api('/functions/v1/pvp-move', {
  method: 'POST', body: JSON.stringify({ match_id: bm.id, auto: true }) }, alice.jwt);
check(early.status === 425, 'self-nudge before the stall was not refused', early);
await new Promise(r => setTimeout(r, 13_000));
const away = await api('/functions/v1/pvp-move', {
  method: 'POST', body: JSON.stringify({ match_id: bm.id, auto: true }) }, alice.jwt);
check(away.status === 200 && !!away.body.bot_move && away.body.match.turn === 1,
  'stalled bot-match turn was not auto-played (die placed + bot reply)', away);
if (away.status === 200) { bm = away.body.match; sawBotMove = sawBotMove || !!away.body.bot_move; bmoves++; }

while (bm.status === 'active' && bmoves < 100) {
  let accepted = null;
  for (const c of [0, 1, 2]) {
    const r = await api('/functions/v1/pvp-move', {
      method: 'POST', body: JSON.stringify({ match_id: bm.id, col: c }) }, alice.jwt);
    if (r.status === 200) { accepted = r; break; }
    if (r.status !== 422) { check(false, 'unexpected bot-match error', r); break; }
  }
  if (!accepted) { check(false, 'no column accepted vs bot', bm); break; }
  if (accepted.body.bot_move) sawBotMove = true;
  bm = accepted.body.match;
  bmoves++;
}
check(bm.status === 'done', 'bot match did not finish', { status: bm.status, bmoves });
check(sawBotMove, 'bot never answered');

// ---- leaderboard: the players who rated this run are listed. No bot check
// is possible from here: below 100 rated humans the RPC seats bots on the
// board BY DESIGN (migration 0013 — an empty ladder is a worse lie), and
// they wear the same generated nicknames humans get, indistinguishable to a
// client on purpose.
const lb = await api('/rest/v1/rpc/leaderboard', { method: 'POST', body: JSON.stringify({ limit_n: 50 }) });
const names = (lb.body ?? []).map(r => r.nickname);
check(names.includes(aliceBefore.nickname) || names.includes(aliceAfter.nickname), 'alice missing from leaderboard', names);

console.log(JSON.stringify({
  h2h: { moves, winner: state.winner === alice.id ? 'alice' : state.winner === bob.id ? 'bob' : 'draw',
         p1_score: state.p1_score, p2_score: state.p2_score, eloDelta: { alice: dA, bob: dB } },
  resign: { eloDelta: { alice: rdA, bob: rdB } },
  bot: { moves: bmoves, p1_score: bm.p1_score, p2_score: bm.p2_score, sawBotMove },
  leaderboard: lb.body, problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
