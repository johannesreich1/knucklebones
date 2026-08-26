import assert from 'node:assert/strict';
import type { RankedActionRow } from '../src/core/ranked-actions.ts';
import type { MatchRow } from '../src/online/match-api.ts';
import {
  isEmptyTerminalTrialSnapshot,
  retryCoherentTrialSnapshot,
  trialSnapshotCoherent,
  type TrialSnapshot,
} from '../src/online/trial-snapshot.ts';

const row = (idx: number): RankedActionRow => ({
  idx, move_idx: idx, who: (1 - (idx % 2)) as 0 | 1, kind: 'place',
  rune_id: null, target_col: null, placed_col: 0,
  die_before: 3, die_after: 4,
});
const match = (actionVersion: number): MatchRow => ({
  id: 'match', p1: 'p1', p2: 'p2', status: 'active', turn: 1,
  winner: null, p1_score: null, p2_score: null, next_die: 4,
  last_move_at: new Date(0).toISOString(), modifier: 'classic',
  format: 'rune_trial', action_version: actionVersion,
});

const behindRows: TrialSnapshot = { rows: [row(0)], match: match(2) };
const behindMatch: TrialSnapshot = { rows: [row(0), row(1)], match: match(1) };
const coherent: TrialSnapshot = { rows: [row(0), row(1)], match: match(2) };
assert.equal(trialSnapshotCoherent(behindRows), false);
assert.equal(trialSnapshotCoherent(behindMatch), false);
assert.equal(trialSnapshotCoherent(coherent), true);
const emptyTerminal = { rows: [], match: { ...match(0), status: 'forfeit' as const } };
assert.equal(isEmptyTerminalTrialSnapshot(emptyTerminal), true);
assert.equal(isEmptyTerminalTrialSnapshot({ rows: [], match: match(0) }), false);
assert.equal(isEmptyTerminalTrialSnapshot({ rows: [row(0)], match: {
  ...match(1), status: 'done',
} }), false);
assert.equal(isEmptyTerminalTrialSnapshot({ rows: [], match: {
  ...match(1), status: 'done',
} }), false);

let reads = 0;
const waits: number[] = [];
const healed = await retryCoherentTrialSnapshot(async () => {
  reads++;
  return reads === 1 ? behindRows : coherent;
}, async (attempt) => { waits.push(attempt); });
assert.equal(healed, coherent);
assert.equal(reads, 2);
assert.deepEqual(waits, [1]);

reads = 0;
const rejected = await retryCoherentTrialSnapshot(async () => {
  reads++;
  return behindMatch;
}, async () => undefined, 3);
assert.equal(rejected, null);
assert.equal(reads, 3);

console.log(JSON.stringify({ problems: [] }));
