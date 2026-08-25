// Gate for the PvP match core: log rebuilding mirrors real play exactly, log
// corruption is refused, and the ladder math behaves.
// Run: mise exec -- node --experimental-strip-types tests/match.test.ts
import { ME, AI, type GameState, type Player, emptyBoard, legalCols, isFull, applyMove, boardTotal } from '../src/core/rules.ts';
import { diceStream } from '../src/core/dice.ts';
import { rebuild, type MoveRow } from '../src/core/match.ts';
import { delta } from '../src/core/ladder.ts';

const problems: string[] = [];
const check = (c: boolean, m: string, x?: unknown) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

/* simulate a full match, keeping a parallel move log like the server writes */
const seed = 'match-gate-seed';
const st: GameState = [emptyBoard(), emptyBoard()];
const roll = diceStream(seed);
const log: MoveRow[] = [];
let turn: Player = ME;
for (;;) {
  const die = roll();
  const cols = legalCols(st[turn]);
  const col = cols[die % cols.length];   // arbitrary but deterministic strategy
  log.push({ idx: log.length, who: turn, col });
  applyMove(st, turn, col, die);
  if (isFull(st[turn])) break;
  turn = (1 - turn) as Player;
}

// full log rebuilds to the same boards, over, with correct move count
const full = rebuild(seed, log);
check(!!full && full.over && full.moveCount === log.length, 'full log did not rebuild as finished', full && { over: full.over, n: full.moveCount });
if (full) {
  check(boardTotal(full.st[ME]) === boardTotal(st[ME]) && boardTotal(full.st[AI]) === boardTotal(st[AI]),
    'rebuilt boards disagree with played game');
}

// partial log rebuilds mid-game with the right turn and a valid next die
const part = rebuild(seed, log.slice(0, 5));
check(!!part && !part.over && part.turn === log[5].who && part.nextDie >= 1 && part.nextDie <= 6,
  'partial rebuild wrong', part && { turn: part.turn, expect: log[5].who });

// shuffled input is fine (server sorts by idx)...
check(!!rebuild(seed, [...log].reverse()), 'idx-sorted rebuild failed on reversed input');
// ...but corruption is not
check(rebuild(seed, log.map((m, i) => i === 3 ? { ...m, who: (1 - m.who) } : m)) === null, 'wrong-who accepted');
check(rebuild(seed, log.filter(m => m.idx !== 2)) === null, 'gapped log accepted');
check(rebuild(seed, log.map((m, i) => i === 1 ? { ...m, col: 99 } : m)) === null, 'illegal col accepted');

/* The ladder behaves: a win pays MORE than a loss takes (that asymmetry is the
   climb), a favourite gains little, an underdog gains much. The exact payout
   table is pinned in tests/ladder.test.ts against docs/LADDER.md §1; these are
   the shape checks that belong beside the match replay they settle. */
check(delta(1000, 1000, 1) === 80 && delta(1000, 1000, 0) === -60, 'even-match deltas wrong');
check(delta(1000, 1000, 0.5) === 0, 'even draw not zero');
check(delta(1000, 1000, 1) + delta(1000, 1000, 0) > 0, 'the ladder no longer climbs');
check(delta(4000, 0, 1) < delta(1000, 1000, 1), 'favourite win gains too much', delta(4000, 0, 1));
check(delta(0, 4000, 1) > delta(1000, 1000, 1), 'underdog win gains too little', delta(0, 4000, 1));

console.log(JSON.stringify({ movesInMatch: log.length, problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
