import assert from 'node:assert/strict';
import { replayMatch } from './match-replay.mjs';

// Sanitized reproduction of the 2026-08-23 ROW SWITCH finish that motivated
// this tool. It contains only dice and columns: no IDs, names, seed, or token.
const rawMoves = [
  [1, 2, 1], [0, 0, 4], [1, 0, 2], [0, 0, 5], [1, 1, 2], [0, 0, 5],
  [1, 0, 5], [0, 0, 6], [1, 0, 5], [0, 1, 4], [1, 2, 1], [0, 2, 1],
  [1, 2, 3], [0, 2, 3], [1, 1, 4], [0, 2, 5], [1, 1, 2], [0, 1, 2],
  [1, 2, 5], [0, 1, 4], [1, 2, 1], [0, 1, 2], [1, 1, 1], [0, 2, 4],
  [1, 2, 3], [0, 2, 5], [1, 1, 4], [0, 1, 5], [1, 1, 1], [0, 2, 4],
  [1, 2, 5],
];
const moves = rawMoves.map(([who, col, die], idx) => ({ idx, who, col, die }));
const replay = replayMatch({
  matchKey: 'sanitized',
  createdAt: null,
  finishedAt: null,
  status: 'done',
  modifier: 'rowswitch',
  seats: { p1: 'bot', p2: 'human' },
  winner: 'p1',
  p1Score: 39,
  p2Score: 35,
}, moves);

assert.deepEqual(replay.verification.computedScores, { p1: 39, p2: 35 });
assert.equal(replay.verification.projectionMatches, true);
assert.deepEqual(replay.finalBoards, {
  p1: [[2, 5, 5], [1, 4, 1], [1, 3, 5]],
  p2: [[4, 6], [2, 2, 5], [4, 4]],
});
const penultimate = replay.events.at(-2);
assert.deepEqual(penultimate.placed, { die: 4, column: 'right' });
assert.equal(penultimate.destroyed, 0);
assert.equal(penultimate.scores.p2, 40);
const final = replay.events.at(-1);
assert.equal(final.destroyed, 1);
assert.deepEqual(final.opponentChanges, [
  { column: 'right', before: [4, 5, 4], after: [4, 4] },
]);
assert.deepEqual(final.boards.p2[0], [4, 6]);

console.log('ok  sanitized production match replay');
