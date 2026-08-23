// Pure production-log replay. The live adapter supplies sanitized metadata and
// moves; this module imports the same rules used by browser, Node, and Deno.
import {
  BOUNTY,
  SPEC,
  applyMove,
  emptyBoard,
  totalOf,
} from '../../src/core/rules.ts';
import { MODES } from '../../src/core/modes.ts';
import { DICE_FACES } from '../../src/config.ts';

const COLUMN_NAMES = ['left', 'middle', 'right'];
const cloneBoard = (board) => board.map((column) => column.slice());
const seatOf = (who) => who === 1 ? 'p1' : 'p2';

function boardsOf(state) {
  return { p1: cloneBoard(state[1]), p2: cloneBoard(state[0]) };
}

function scoresOf(state, bounty, mode) {
  return {
    p1: totalOf(state[1], bounty[1], mode),
    p2: totalOf(state[0], bounty[0], mode),
  };
}

function changedColumns(before, after) {
  const changes = [];
  for (let column = 0; column < SPEC.cols; column++) {
    if (JSON.stringify(before[column]) === JSON.stringify(after[column])) continue;
    changes.push({
      column: COLUMN_NAMES[column] ?? String(column),
      before: before[column],
      after: after[column].slice(),
    });
  }
  return changes;
}

function validateMove(move, expectedIndex, state) {
  if (move.idx !== expectedIndex) throw new Error(`Move log is not contiguous at index ${expectedIndex}.`);
  if (move.who !== 0 && move.who !== 1) throw new Error(`Move ${move.idx} has an invalid player.`);
  if (!Number.isInteger(move.col) || move.col < 0 || move.col >= SPEC.cols) {
    throw new Error(`Move ${move.idx} has an invalid column.`);
  }
  if (!Number.isInteger(move.die) || move.die < 1 || move.die > DICE_FACES) {
    throw new Error(`Move ${move.idx} has an invalid die.`);
  }
  if (state[move.who][move.col].length >= SPEC.rows) {
    throw new Error(`Move ${move.idx} places into a full column.`);
  }
}

export function replayMatch(metadata, moves) {
  const spec = MODES.find((candidate) => candidate.id === metadata.modifier);
  if (!spec) throw new Error(`Unknown match modifier: ${metadata.modifier}`);
  const mode = spec.mode;
  const state = [emptyBoard(), emptyBoard()];
  const bounty = [0, 0];
  const events = [];

  for (let index = 0; index < moves.length; index++) {
    const move = moves[index];
    validateMove(move, index, state);
    const opponent = 1 - move.who;
    const opponentBefore = cloneBoard(state[opponent]);
    const destroyed = applyMove(state, move.who, move.col, move.die, mode);
    if (mode === BOUNTY) bounty[move.who] += destroyed;
    events.push({
      idx: move.idx,
      actor: seatOf(move.who),
      placed: { die: move.die, column: COLUMN_NAMES[move.col] ?? String(move.col) },
      destroyed,
      opponentChanges: changedColumns(opponentBefore, state[opponent]),
      scores: scoresOf(state, bounty, mode),
      boards: boardsOf(state),
    });
  }

  const scores = scoresOf(state, bounty, mode);
  const storedScores = { p1: metadata.p1Score, p2: metadata.p2Score };
  const projectionMatches = storedScores.p1 === null || storedScores.p2 === null
    ? null
    : storedScores.p1 === scores.p1 && storedScores.p2 === scores.p2;
  return {
    match: { ...metadata, moveCount: moves.length },
    verification: { computedScores: scores, storedScores, projectionMatches },
    finalBoards: boardsOf(state),
    events,
  };
}
