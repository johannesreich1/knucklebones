import assert from 'node:assert/strict';
import type { RankedActionRow } from '../src/core/ranked-actions.ts';
import {
  RUNE_TRIAL_CLAIM_REWARD_V2,
  RUNE_TRIAL_SELECTED_REWARD_V1,
  makeRuneTrialClaim,
  readRuneTrialClaimSnapshot,
  seededRuneTrialClaim,
  seededRuneTrialOffer,
} from '../src/core/rune-trial-offer.ts';
import type { MatchRow } from '../src/online/api/match-api.ts';
import {
  isEmptyTerminalTrialSnapshot,
  retryCoherentTrialSnapshot,
  trialSnapshotCoherent,
  type TrialSnapshot,
} from '../src/online/runes/trial-snapshot.ts';

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

/* CLAIM is sampled from the dealt slots, not from the rune registry. Exact
   half-open boundaries prove all three cards are reachable and uniform. */
const offer = ['fate', 'ward', 'sunder'] as const;
assert.deepEqual([
  makeRuneTrialClaim(() => 0, offer),
  makeRuneTrialClaim(() => 1 / 3, offer),
  makeRuneTrialClaim(() => 2 / 3, offer),
  makeRuneTrialClaim(() => 0.999999999, offer),
], [
  { rewardVersion: RUNE_TRIAL_CLAIM_REWARD_V2, slot: 0, rune: 'fate' },
  { rewardVersion: RUNE_TRIAL_CLAIM_REWARD_V2, slot: 1, rune: 'ward' },
  { rewardVersion: RUNE_TRIAL_CLAIM_REWARD_V2, slot: 2, rune: 'sunder' },
  { rewardVersion: RUNE_TRIAL_CLAIM_REWARD_V2, slot: 2, rune: 'sunder' },
]);

const claimSeed = 'claim-domain-gate';
const seededOfferBefore = seededRuneTrialOffer(claimSeed);
const seededClaim = seededRuneTrialClaim(claimSeed, seededOfferBefore);
assert.deepEqual(seededClaim,
  { rewardVersion: RUNE_TRIAL_CLAIM_REWARD_V2, slot: 1, rune: 'nudge' },
  'the domain-separated CLAIM protocol stream drifted');
assert.deepEqual(seededRuneTrialOffer(claimSeed), seededOfferBefore,
  'dealing CLAIM perturbed the v1 offer stream');
assert.deepEqual(seededRuneTrialClaim(claimSeed, seededOfferBefore), seededClaim,
  'CLAIM is not deterministic');
assert.equal(seededOfferBefore[seededClaim.slot], seededClaim.rune);
assert.equal(Object.isFrozen(seededClaim), true);

assert.equal(readRuneTrialClaimSnapshot(offer, undefined, undefined, undefined), null);
assert.equal(readRuneTrialClaimSnapshot(
  offer, RUNE_TRIAL_SELECTED_REWARD_V1, null, null,
), null, 'legacy selected-rune reward no longer remains unmarked');
assert.deepEqual(readRuneTrialClaimSnapshot(
  offer, RUNE_TRIAL_CLAIM_REWARD_V2, 1, 'ward',
), { rewardVersion: RUNE_TRIAL_CLAIM_REWARD_V2, slot: 1, rune: 'ward' });
assert.throws(() => readRuneTrialClaimSnapshot(
  offer, RUNE_TRIAL_CLAIM_REWARD_V2, null, null,
), /does not match/);
assert.throws(() => readRuneTrialClaimSnapshot(
  offer, RUNE_TRIAL_CLAIM_REWARD_V2, 1, 'fate',
), /does not match/);
assert.throws(() => readRuneTrialClaimSnapshot(offer, 3, 1, 'ward'), /Unsupported/);
assert.throws(() => seededRuneTrialClaim('', offer), /non-empty/);

console.log(JSON.stringify({ problems: [] }));
