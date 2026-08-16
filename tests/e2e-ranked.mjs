// LIVE end-to-end test of the ranked pipeline against the real Supabase
// project. NOT part of the automated gate (mutates live data, needs a
// confirmed test user). Run in two phases:
//   node tests/e2e-ranked.mjs signup        -> prints the new user id
//   (confirm the user's email, e.g. via SQL: update auth.users set email_confirmed_at=now() ...)
//   node tests/e2e-ranked.mjs run           -> full round-trip + assertions
// Cleanup afterwards: delete the auth.users row (cascades all test data).
import { diceStream } from '../src/core/dice.ts';
import { ME, emptyBoard, legalCols, isFull, applyMove, boardTotal, AI } from '../src/core/rules.ts';

const URL = 'https://euzjcejbkxvqfrttgaxu.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1empjZWpia3h2cWZydHRnYXh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTgxNTgsImV4cCI6MjEwMjQ3NDE1OH0.WIhtcBLc_0mnINapuBqoJVeqqLfx6jHvexRwO5e1KyY';
const EMAIL = 'e2e.ranked.tester@example.com';
const PASS = 'e2e-test-password-1!';

const problems = [];
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
const api = async (path, opts = {}, token = ANON) => {
  const res = await fetch(URL + path, {
    ...opts,
    headers: { 'apikey': ANON, 'Authorization': `Bearer ${token}`,
               'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  let body = null; try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
};

const phase = process.argv[2];

if (phase === 'signup') {
  const r = await api('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS }) });
  console.log(JSON.stringify({ status: r.status, user_id: r.body?.user?.id ?? r.body?.id, msg: r.body?.msg }, null, 2));
  process.exit(0);
}

if (phase !== 'run') { console.error('usage: e2e-ranked.mjs signup|run'); process.exit(2); }

// ---- sign in ----
const login = await api('/auth/v1/token?grant_type=password', {
  method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS }) });
check(login.status === 200 && login.body?.access_token, 'login failed', login);
const jwt = login.body.access_token, uid = login.body.user.id;

// ---- profile (idempotent: ignore duplicate on re-runs) ----
const prof = await api('/rest/v1/profiles', {
  method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates' },
  body: JSON.stringify({ id: uid, nickname: 'e2e_tester' }) }, jwt);
check([201, 200].includes(prof.status), 'profile creation failed', prof);

// ---- ranked-start: get a server seed ----
const start = await api('/functions/v1/ranked-start', { method: 'POST' }, jwt);
check(start.status === 200 && start.body?.seed, 'ranked-start failed', start);
const { session_id, seed } = start.body;

// ---- play an honest game locally against the seed ----
const st = [emptyBoard(), emptyBoard()];
const roll = diceStream(seed);
const moves = [];
let turn = ME;
for (;;) {
  const die = roll();
  const col = legalCols(st[turn])[0];
  moves.push([turn, col]);
  applyMove(st, turn, col, die);
  if (isFull(st[turn])) break;
  turn = 1 - turn;
}
const expectScore = boardTotal(st[ME]), expectOpp = boardTotal(st[AI]);

// ---- submit: server must accept and recompute the same score ----
const submit = await api('/functions/v1/ranked-submit', {
  method: 'POST', body: JSON.stringify({ session_id, moves, difficulty: 'hard' }) }, jwt);
check(submit.status === 200, 'ranked-submit failed', submit);
check(submit.body?.score === expectScore && submit.body?.opponent_score === expectOpp,
  'server replay disagrees with local play', { server: submit.body, local: { expectScore, expectOpp } });

// ---- double submit must be rejected ----
const dup = await api('/functions/v1/ranked-submit', {
  method: 'POST', body: JSON.stringify({ session_id, moves, difficulty: 'hard' }) }, jwt);
check(dup.status === 409, 'double submit not rejected', dup);

// ---- tampered submit on a fresh session must be rejected ----
const start2 = await api('/functions/v1/ranked-start', { method: 'POST' }, jwt);
check(start2.status === 200, 'second ranked-start failed', start2);
const cheat = await api('/functions/v1/ranked-submit', {
  method: 'POST',
  body: JSON.stringify({ session_id: start2.body.session_id, moves: moves.slice(0, 4), difficulty: 'hard' }) }, jwt);
check(cheat.status === 422, 'invalid game not rejected', cheat);

// ---- leaderboard (as anon) shows the nickname with the replayed score ----
const lb = await api('/rest/v1/rpc/leaderboard_alltime', { method: 'POST', body: JSON.stringify({ limit_n: 10 }) });
const row = Array.isArray(lb.body) && lb.body.find(r => r.nickname === 'e2e_tester');
check(!!row && row.best === expectScore, 'leaderboard missing the validated score', { lb: lb.body });

console.log(JSON.stringify({ score: expectScore, opponent: expectOpp, moves: moves.length, problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
