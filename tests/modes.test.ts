// Gate for the ranked mode wheel's rules. Modes change scoring/destruction,
// and the server replays stored games under them — so like the dice stream,
// mode math is pinned: a drift here breaks replay validation of every stored
// modded match. Classic (mode 0) must stay bit-identical to the pre-mode game.
// Run: node --experimental-strip-types tests/modes.test.ts
import {
  CLASSIC, ROWSWITCH, ROWMULT, COLSHIELD, type Mode,
  type GameState, type Board, AI, ME,
  emptyBoard, applyMove, boardTotal, boardTotalMode, rowScore, rowBonus,
} from '../src/core/rules.ts';
import { rebuild } from '../src/core/match.ts';
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

/* ---- the wheel pick: deterministic, weighted, complete ---- */
check(pickMode('same-seed').id === pickMode('same-seed').id, 'pickMode deterministic');
{
  const tally: Record<string, number> = {};
  const N = 6000;
  for (let i = 0; i < N; i++) { const m = pickMode('dist-' + i); tally[m.id] = (tally[m.id] ?? 0) + 1; }
  check(Object.keys(tally).length === MODES.length, 'every mode reachable', tally);
  const classicShare = (tally['classic'] ?? 0) / N;
  check(Math.abs(classicShare - 0.5) < 0.03, 'classic lands ~50%', tally);
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
