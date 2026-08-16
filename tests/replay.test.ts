// Gate for the ranked replay validator: an honestly-played game is accepted
// with the right score, and every class of tampering is rejected.
// Run: node --experimental-strip-types tests/replay.test.ts
import { ME, AI, type GameState, type Player, emptyBoard, legalCols, boardTotal, isFull, applyMove } from '../src/core/rules.ts';
import { diceStream } from '../src/core/dice.ts';
import { replayGame, type Move } from '../src/core/replay.ts';

const problems: string[] = [];
const check = (c: boolean, m: string, x?: unknown) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

/* play an honest game against the stream: each mover takes the first legal
   column — dumb strategy, perfectly valid game */
function honestGame(seed: string): { moves: Move[]; score: number; opponent_score: number } {
  const st: GameState = [emptyBoard(), emptyBoard()];
  const roll = diceStream(seed);
  const moves: Move[] = [];
  let turn: Player = ME;
  for (;;) {
    const die = roll();
    const col = legalCols(st[turn])[0];
    moves.push([turn, col]);
    applyMove(st, turn, col, die);
    if (isFull(st[turn])) break;
    turn = (1 - turn) as Player;
  }
  return { moves, score: boardTotal(st[ME]), opponent_score: boardTotal(st[AI]) };
}

const seed = 'replay-gate-seed-1';
const g = honestGame(seed);

// honest game is accepted, and the replay recomputes the same score
const ok = replayGame(seed, g.moves);
check(!!ok, 'honest game rejected');
if (ok) {
  check(ok.score === g.score && ok.opponent_score === g.opponent_score,
    'replay disagrees with the played game', { ok, g: { score: g.score, o: g.opponent_score } });
}

// tampering: every variant must be rejected
check(replayGame('some-other-seed', g.moves) === null, 'wrong seed accepted');
check(replayGame(seed, g.moves.slice(0, -1)) === null, 'unfinished game accepted');
check(replayGame(seed, [...g.moves, g.moves.at(-1)]) === null, 'play past the end accepted');
const swapped = g.moves.map((m, i) => (i === 0 ? [AI, m[1]] : m));
check(replayGame(seed, swapped) === null, 'turn-order tampering accepted');
const badCol = g.moves.map((m, i) => (i === 0 ? [m[0], 99] : m));
check(replayGame(seed, badCol) === null, 'illegal column accepted');
check(replayGame(seed, []) === null, 'empty game accepted');
check(replayGame(seed, 'garbage') === null, 'non-array accepted');
check(replayGame(seed, Array(500).fill([1, 0])) === null, 'oversized payload accepted');

console.log(JSON.stringify({ movesInHonestGame: g.moves.length, score: g.score, problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
