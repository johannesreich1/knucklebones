// Staged progression-v2 client contracts: advertise only what the server has
// confirmed, and reveal only the immutable roster negotiated for the match.
// Run: mise exec -- node --experimental-strip-types tests/ranked-client-contract.test.ts
import { readFileSync } from 'node:fs';
import { rankedCurveVersionFromRpc } from '../src/online/api/ladder-api.ts';
import { rankedJoinAdvertisement } from '../src/online/api/match-api.ts';
import { rankedRevealCandidates } from '../src/online/screens/queue-reveal.ts';
import { emitReport } from './support/emit-report.mjs';

const problems: string[] = [];
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(`${what} :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};
const check = (condition: boolean, what: string) => {
  if (!condition) problems.push(what);
};

eq(rankedJoinAdvertisement(1), {
  curveVersion: 1,
  capabilities: ['rune_trial_v1', 'equipped_rune_v1'],
}, 'v1 join advertised successor-only capabilities');
eq(rankedJoinAdvertisement(2), {
  curveVersion: 2,
  capabilities: [
    'rune_trial_v1', 'equipped_rune_v1', 'curve_v2', 'rune_trial_claim_v2',
  ],
}, 'v2 join omitted the curve or CLAIM capability');

const revealBase = {
  status: 'matched', you: 1,
  names: { p1: 'SilverPlayer', p2: 'NoRuneOpponent' },
  match: {
    id: 'v2-roster', p1: 'silver-player', p2: 'no-rune-opponent',
    status: 'active', turn: 1, winner: null, p1_score: null, p2_score: null,
    next_die: 4, last_move_at: '2026-09-01T12:00:00.000Z',
    modifier: 'rowmult', format: 'standard', protocol_version: 2,
    rune_rules_version: 1, phase: 'playing', p1_rune: null, p2_rune: null,
    action_version: 0, curve_version: 2,
    outcome_roster: ['limited', 'rowmult', 'classic', 'bounty'],
  },
} as const;

eq(rankedRevealCandidates(revealBase as never)?.map(({ id }) => id),
  ['classic', 'bounty', 'rowmult', 'limited'],
  'v2 reveal did not canonically order its exact negotiated roster');
check(rankedRevealCandidates({
  ...revealBase,
  match: { ...revealBase.match, outcome_roster: ['classic', 'limited'] },
} as never) === null, 'v2 reveal accepted a roster omitting the selected outcome');
check(rankedRevealCandidates({
  ...revealBase,
  match: { ...revealBase.match, outcome_roster: ['rowmult', 'limited'] },
} as never) === null, 'v2 reveal accepted a roster without Classic');
check(rankedRevealCandidates({
  ...revealBase,
  match: { ...revealBase.match, outcome_roster: ['classic', 'future-mode'] },
} as never) === null, 'v2 reveal shortened an unknown negotiated outcome');
check(rankedRevealCandidates({
  ...revealBase,
  match: { ...revealBase.match, outcome_roster: ['classic', 'rowmult', 'rowmult'] },
} as never) === null, 'v2 reveal accepted duplicate negotiated outcomes');
check(rankedRevealCandidates({
  ...revealBase,
  match: { ...revealBase.match, outcome_roster: undefined },
} as never) === null, 'v2 reveal inferred a roster after its snapshot went missing');
eq(rankedRevealCandidates({
  ...revealBase,
  match: {
    ...revealBase.match, modifier: 'limited', entry_kind: 'weekly',
    weekly_rotation_id: '2026-W36', outcome_roster: ['limited'],
  },
} as never)?.map(({ id }) => id), ['limited'],
  'v2 weekly reveal rejected its exact one-outcome rotation roster');
check(rankedRevealCandidates({
  ...revealBase,
  match: { ...revealBase.match, entry_kind: 'weekly' },
} as never) === null, 'v2 weekly reveal accepted a multi-outcome roster');
eq(rankedRevealCandidates({
  ...revealBase,
  match: {
    ...revealBase.match, modifier: 'limited', curve_version: 1,
    pool_tier: 'stone', outcome_roster: null,
  },
} as never)?.map(({ id }) => id), [
  'classic', 'singlestrike', 'colshield', 'limited',
], 'v1 reveal fallback lost the shipped STONE promise for a legacy NULL roster');

eq(rankedCurveVersionFromRpc(2, null, null), 2,
  'a valid public v2 scalar was not accepted');
eq(rankedCurveVersionFromRpc(null, {
  code: 'PGRST202',
  message: 'Could not find the function public.active_ranked_curve_version in the schema cache',
}, null), 1, 'an exact old-server missing RPC did not retain v1 compatibility');
eq(rankedCurveVersionFromRpc(null, { code: '503', message: 'gateway unavailable' }, null), null,
  'a fresh-device transient curve failure speculated v1');
eq(rankedCurveVersionFromRpc(null, { code: '503', message: 'gateway unavailable' }, 1), null,
  'a stale confirmed-v1 cache classified potentially mapped rows after a transient failure');
eq(rankedCurveVersionFromRpc(null, { code: '503', message: 'gateway unavailable' }, 2), 2,
  'a transient scalar read downgraded an already-confirmed v2 curve');
eq(rankedCurveVersionFromRpc(3, null, 2), null,
  'an unknown future curve was silently rendered as cached v2');
eq(rankedCurveVersionFromRpc(null, { code: '42501', message: 'permission denied' }, null), null,
  'an authorization failure impersonated an old-schema v1 server');

const ladderApiSource = readFileSync('src/online/api/ladder-api.ts', 'utf8');
const equipmentBranch = ladderApiSource.slice(
  ladderApiSource.indexOf('const equipmentUnlock'),
  ladderApiSource.indexOf('const [currentResult'),
);
check(equipmentBranch.includes('curveVersion === 2')
  && equipmentBranch.includes("from('player_ranked_features')")
  && equipmentBranch.includes(".eq('feature_id', 'equipped_runes')")
  && equipmentBranch.includes("from('season_ratings')")
  && equipmentBranch.includes(".gte('peak', silverFloor)"),
'myLadder did not branch between explicit v2 equipment ownership and the v1 peak proof');

const bootSource = readFileSync('src/boot.ts', 'utf8');
const curveVerification = bootSource.indexOf('await refreshVerifiedRankedCurveVersion()');
const bootProfileRead = bootSource.indexOf('await myProfile()', curveVerification);
check(curveVerification >= 0 && bootProfileRead > curveVerification,
  'boot could cache a freshly mapped profile rating before verifying its curve');
const homeChipSource = readFileSync('src/ui/homechip.ts', 'utf8');
check(homeChipSource.includes('cachedLadderCurveVersion() === null ? null'),
  'Home did not withhold cached points while their league curve is unknown');

emitReport({ problems, errs: [] }, problems.length);
