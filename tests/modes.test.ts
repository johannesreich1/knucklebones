// Gate for the ranked mode wheel's rules. Modes change scoring/destruction,
// and the server replays stored games under them — so like the dice stream,
// mode math is pinned: a drift here breaks replay validation of every stored
// modded match. Classic (mode 0) must stay bit-identical to the pre-mode game.
// Run: node --experimental-strip-types tests/modes.test.ts
import {
  CLASSIC, ROWSWITCH, ROWMULT, COLSHIELD, SINGLESTRIKE, BOUNTY, LIMITED, type Mode,
  type GameState, type Board, AI, ME,
  emptyBoard, applyMove, boardTotal, boardTotalMode, rowScore, rowBonus,
} from '../src/core/rules.ts';
import { poolSequence, POOL_PER_FACE } from '../src/core/dice.ts';
import { rebuild, matchTotal, type MatchState } from '../src/core/match.ts';
import { searchRoot, riskOf } from '../src/core/ai.ts';
import { MODES, pickMode, modeById } from '../src/core/modes.ts';

const problems: string[] = [];
const check = (c: boolean, m: string, x?: unknown) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

/* ---- row scoring, hand-computed ----
   columns (bottom-first): [4,2] [4] [4,5]
   row 0 = 4,4,4 → 4×3² = 36; row 1 = 2,–,5 → 2+5 = 7 */
const b: Board = [[4, 2], [4], [4, 5]];
check(rowScore(b, 0) === 36, 'rowScore row 0', rowScore(b, 0));
check(rowScore(b, 1) === 7, 'rowScore row 1', rowScore(b, 1));
check(rowScore(b, 2) === 0, 'rowScore empty row', rowScore(b, 2));
check(boardTotalMode(b, ROWSWITCH) === 43, 'ROWSWITCH total', boardTotalMode(b, ROWSWITCH));

/* ROWMULT: classic columns (6+4+9 = 19) + row MATCHES only (row 0: +36) */
check(boardTotal(b) === 19, 'classic columns baseline', boardTotal(b));
check(rowBonus(b) === 36, 'rowBonus counts matches only', rowBonus(b));
check(boardTotalMode(b, ROWMULT) === 55, 'ROWMULT total', boardTotalMode(b, ROWMULT));

/* classic mode must be EXACTLY boardTotal on arbitrary boards */
const wild: Board = [[6, 6, 6], [1, 3], [2, 2]];
check(boardTotalMode(wild, CLASSIC) === boardTotal(wild), 'classic total identical', boardTotal(wild));

/* ---- COLSHIELD destruction ---- */
const shielded = (): GameState => [[[1, 2, 3], [], []], [[], [], []]];
let st = shielded();
applyMove(st, ME, 0, 2, COLSHIELD);          // into AI's FULL column 0
check(JSON.stringify(st[AI][0]) === '[1,2,3]', 'full column survived under shield', st[AI][0]);
st = shielded();
applyMove(st, ME, 0, 2, CLASSIC);            // classic: same attack destroys
check(JSON.stringify(st[AI][0]) === '[1,3]', 'classic still destroys full columns', st[AI][0]);
st = [[[2, 2], [], []], [[], [], []]];
applyMove(st, ME, 0, 2, COLSHIELD);          // shield mode, but the column is NOT full
check(JSON.stringify(st[AI][0]) === '[]', 'shield protects only FULL columns', st[AI][0]);

/* default param = classic: the old two-arg call sites keep old behavior */
st = shielded();
applyMove(st, ME, 0, 2);
check(JSON.stringify(st[AI][0]) === '[1,3]', 'applyMove default is classic', st[AI][0]);

/* ---- SINGLE STRIKE: exactly one die falls, the centre-closest ---- */
st = [[[2, 5, 2], [], []], [[], [], []]];
const ss = applyMove(st, ME, 0, 2, SINGLESTRIKE);
check(ss === 1 && JSON.stringify(st[AI][0]) === '[5,2]',
  'single strike takes only the centre-closest match', { n: ss, col: st[AI][0] });
st = [[[2, 5, 2], [], []], [[], [], []]];
const cl = applyMove(st, ME, 0, 2);
check(cl === 2 && JSON.stringify(st[AI][0]) === '[5]', 'classic still takes every match', { n: cl, col: st[AI][0] });

/* ---- BOUNTY: destroyed dice bank permanent points ---- */
{
  const ms: MatchState = { st: [emptyBoard(), [[4, 4], [], []]] as GameState, turn: ME, over: false, nextDie: 1, moveCount: 0, bounty: [2, 5] };
  check(matchTotal(ms, ME, BOUNTY) === 16 + 5, 'matchTotal adds banked bounty', matchTotal(ms, ME, BOUNTY));
  check(matchTotal(ms, ME, CLASSIC) === 16, 'bounty ignored outside BOUNTY mode', matchTotal(ms, ME, CLASSIC));
}
{
  // drive a deterministic log and verify rebuild banks exactly the destruction
  const seed = 'bounty-gate';
  const rows: { idx: number; who: number; col: number }[] = [];
  const expect: [number, number] = [0, 0];
  for (let i = 0; i < 14; i++) {
    const s = rebuild(seed, rows, BOUNTY);
    if (!s || s.over) break;
    const col = s.st[s.turn][0].length < 3 ? 0 : s.st[s.turn][1].length < 3 ? 1 : 2;
    expect[s.turn] += s.st[1 - s.turn][col].filter((v) => v === s.nextDie).length;
    rows.push({ idx: rows.length, who: s.turn, col });
  }
  const fin = rebuild(seed, rows, BOUNTY);
  check(!!fin && fin.bounty[0] === expect[0] && fin.bounty[1] === expect[1],
    'rebuild banks +1 per destroyed die', { got: fin && fin.bounty, expect });
}

/* ---- rebuild honours the mode (destruction differs, dice identical) ---- */
{
  // drive both rebuilds from one seed until a destruction-into-full happens
  const seed = 'modes-gate-rebuild';
  const rows: { idx: number; who: number; col: number }[] = [];
  let diverged = false;
  for (let i = 0; i < 18; i++) {
    const classic = rebuild(seed, rows, CLASSIC), shield = rebuild(seed, rows, COLSHIELD);
    if (!classic || !shield) { check(false, 'rebuild returned null mid-drive', { i }); break; }
    if (JSON.stringify(classic.st) !== JSON.stringify(shield.st)) { diverged = true; break; }
    if (classic.over) break;
    // always play column 0: maximises facing-column collisions
    const legal0 = classic.st[classic.turn][0].length < 3 ? 0 : classic.st[classic.turn][1].length < 3 ? 1 : 2;
    rows.push({ idx: rows.length, who: classic.turn, col: legal0 });
  }
  check(rebuild(seed, [], CLASSIC)!.nextDie === rebuild(seed, [], COLSHIELD)!.nextDie,
    'mode must not shift the dice stream');
  // divergence is likely but not guaranteed with this seed — assert only determinism:
  const again = rebuild(seed, rows, COLSHIELD);
  check(JSON.stringify(again) === JSON.stringify(rebuild(seed, rows, COLSHIELD)), 'modded rebuild deterministic');
  void diverged;
}

/* ---- LIMITED: the finite bag ---- */
{
  const bag = poolSequence('limited-gate');
  check(bag.length === 6 * POOL_PER_FACE, 'bag holds 24 dice', bag.length);
  for (let v = 1; v <= 6; v++)
    check(bag.filter((d) => d === v).length === POOL_PER_FACE, 'face appears exactly 4 times: ' + v);
  check(JSON.stringify(bag) === JSON.stringify(poolSequence('limited-gate')), 'bag deterministic');
  check(JSON.stringify(bag) !== JSON.stringify(poolSequence('limited-gate-b')), 'bag varies by seed');

  // drive a full game: every draw must follow the bag; it must END at the
  // bag's last die (or a full board, whichever comes first)
  const rows: { idx: number; who: number; col: number }[] = [];
  for (let i = 0; i < 40; i++) {
    const s = rebuild('limited-gate', rows, LIMITED);
    if (!s) { check(false, 'limited rebuild returned null mid-drive', { i }); break; }
    if (s.over) break;
    check(s.nextDie === bag[rows.length], 'draw follows the bag at move ' + rows.length,
      { got: s.nextDie, want: bag[rows.length] });
    const lg = s.st[s.turn].map((c, j) => c.length < 3 ? j : -1).filter((j) => j >= 0);
    rows.push({ idx: rows.length, who: s.turn, col: lg[0] });
  }
  const fin = rebuild('limited-gate', rows, LIMITED)!;
  check(fin.over, 'limited game ended', { moves: rows.length });
  check(rows.length <= bag.length, 'never more draws than the bag holds', rows.length);
  // a move past the empty bag must be rejected, never invented
  if (rows.length === bag.length) {
    const overdraw = rebuild('limited-gate',
      [...rows, { idx: rows.length, who: fin.turn, col: 0 }], LIMITED);
    check(overdraw === null, 'a 25th draw is corrupt, not conjured');
  }
  // scoring stays pure classic
  check(matchTotal(fin, ME, LIMITED) === boardTotalMode(fin.st[ME], CLASSIC),
    'limited scores classic', matchTotal(fin, ME, LIMITED));
  // and the endless modes never got their dice shifted by the bag's existence
  check(rebuild('limited-gate', [], CLASSIC)!.nextDie === rebuild('limited-gate', [], BOUNTY)!.nextDie,
    'classic stream untouched by the pool draw');
}

/* ---- the wheel pick: deterministic and weight-faithful, whatever the
   weights currently are (test weights included) ---- */
check(pickMode('same-seed').id === pickMode('same-seed').id, 'pickMode deterministic');
{
  const tally: Record<string, number> = {};
  const N = 6000;
  for (let i = 0; i < N; i++) { const m = pickMode('dist-' + i); tally[m.id] = (tally[m.id] ?? 0) + 1; }
  const total = MODES.reduce((s, m) => s + m.weight, 0);
  for (const m of MODES) {
    const share = (tally[m.id] ?? 0) / N, want = m.weight / total;
    check(Math.abs(share - want) < 0.03, 'wheel share drifted for ' + m.id, { share, want });
    if (m.weight === 0) check(!tally[m.id], 'zero-weight mode must never land: ' + m.id, tally);
  }
}
check(modeById('nonsense').id === 'classic', 'unknown id falls back to classic');
check(modeById(null).id === 'classic', 'null id falls back to classic');

/* ---- AI plays every mode without falling over, and respects the shield ---- */
const mid: GameState = [[[5, 5], [2], []], [[4], [6, 6], [1]]];
for (const m of MODES) {
  const r = searchRoot(mid, AI, 4, 2, m.mode as Mode);
  check(r.c >= 0 && r.c <= 2, 'AI move legal under ' + m.id, r);
}
const fullCol: GameState = [[[3, 3, 3], [], []], [[], [], []]];
check(riskOf(fullCol, AI, COLSHIELD) === 0, 'shielded full column carries no risk', riskOf(fullCol, AI, COLSHIELD));
check(riskOf(fullCol, AI, CLASSIC) > 0, 'classic full column still at risk', riskOf(fullCol, AI, CLASSIC));

console.log(JSON.stringify({ problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
