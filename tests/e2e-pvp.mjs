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
check(match.p1 === alice.id && match.p2 === bob.id, 'alice waited, alice should be p1', match);

// ---- adversarial: seed secrecy + out-of-turn + illegal col ----
const seedPeek = await api(`/rest/v1/match_seeds?match_id=eq.${match.id}&select=*`, {}, alice.jwt);
check(!Array.isArray(seedPeek.body) || seedPeek.body.length === 0, 'seed readable by participant!', seedPeek);
const oot = await api('/functions/v1/pvp-move', {
  method: 'POST', body: JSON.stringify({ match_id: match.id, col: 0 }) }, bob.jwt);
check(oot.status === 409, 'out-of-turn move not rejected', oot);
const badCol = await api('/functions/v1/pvp-move', {
  method: 'POST', body: JSON.stringify({ match_id: match.id, col: 7 }) }, alice.jwt);
check(badCol.status === 422, 'illegal column not rejected', badCol);

// ---- play the full match: movers try columns until the server accepts one
// (the server is the authority on legality; 422 just means "not that one") ----
let state = match, moves = 0;
while (state.status === 'active' && moves < 100) {
  const mover = state.turn === 1 ? alice : bob;
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

// ---- Elo moved zero-sum, ratings persisted ----
const aliceAfter = await myRating(alice), bobAfter = await myRating(bob);
const dA = aliceAfter.rating - aliceBefore.rating, dB = bobAfter.rating - bobBefore.rating;
check(dA + dB === 0, 'Elo not zero-sum', { dA, dB });
check(dA !== 0 || state.winner === null, 'winner rating did not move', { dA, dB, winner: state.winner });

// ---- bot backfill: alice queues alone, allows a bot, plays it out ----
const jb = await api('/functions/v1/pvp-join', {
  method: 'POST', body: JSON.stringify({ allow_bot: true }) }, alice.jwt);
check(jb.status === 200 && jb.body.status === 'matched' && jb.body.you === 1, 'bot match not created', jb);
let bm = jb.body.match, bmoves = 0, sawBotMove = false;
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

// ---- leaderboard: humans listed, bots invisible ----
const lb = await api('/rest/v1/rpc/leaderboard', { method: 'POST', body: JSON.stringify({ limit_n: 50 }) });
const names = (lb.body ?? []).map(r => r.nickname);
check(names.includes(aliceBefore.nickname) || names.includes(aliceAfter.nickname), 'alice missing from leaderboard', names);
const aliceRow = (lb.body ?? []).find(r => r.nickname === aliceAfter.nickname);
const totalHumanGames = (lb.body ?? []).reduce((s, r) => s + Number(r.games), 0);
check((lb.body ?? []).length <= 2, 'more leaderboard rows than humans — a bot leaked?', lb.body);

console.log(JSON.stringify({
  h2h: { moves, winner: state.winner === alice.id ? 'alice' : state.winner === bob.id ? 'bob' : 'draw',
         p1_score: state.p1_score, p2_score: state.p2_score, eloDelta: { alice: dA, bob: dB } },
  bot: { moves: bmoves, p1_score: bm.p1_score, p2_score: bm.p2_score, sawBotMove },
  leaderboard: lb.body, problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
