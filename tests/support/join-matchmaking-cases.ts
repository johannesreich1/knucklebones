// pvp-join matchmaking policy as pure functions: which protocol version two
// peers negotiate, who takes the opening seat (the underdog handicap, bots
// included), whether a client may join or rejoin an active Rune Trial, and
// which queued player is eligible inside the computed rating band. No Request,
// no handler, no CORS — none of this is the Edge HTTP boundary.
import { readFileSync } from 'node:fs';
import {
  negotiatedEquippedRuneProtocol,
  negotiatedProtocolVersion,
  oldestEligibleCandidate,
  rankedBotSides,
  rankedClientCompatibilityError,
  rankedSeatOrder,
} from '../../supabase/functions/pvp-join/matchmaking.ts';
import type { MatchRow } from '../../supabase/functions/_shared/types.ts';

type Check = (ok: boolean, message: string) => void;

export function verifyJoinMatchmakingPolicy(check: Check): void {
  // Realistic queue rows carry a tier the negotiation must ignore; the helper
  // widens the fresh literals so that field survives excess-property checks.
  const peers = (...rows: Array<{ tier: string; capabilities: string[] }>) => rows;
  check(negotiatedProtocolVersion(peers(
    { tier: 'ivory', capabilities: ['rune_trial_v1'] }, { tier: 'stone', capabilities: ['rune_trial_v1'] },
  )) === 2, 'two Trial-capable peers did not preserve protocol v2 on standard outcomes');
  check(negotiatedProtocolVersion(peers(
    { tier: 'ivory', capabilities: ['rune_trial_v1'] }, { tier: 'ivory', capabilities: [] },
  )) === 1, 'an old peer did not negotiate the standard protocol-v1 contract');
  const equippedPeers = peers(
    { tier: 'bone', capabilities: ['rune_trial_v1', 'equipped_rune_v1'] },
    { tier: 'stone', capabilities: ['rune_trial_v1', 'equipped_rune_v1'] },
  );
  check(negotiatedEquippedRuneProtocol('standard', equippedPeers),
    'two equipped-rune clients did not negotiate action-protocol standard play');
  check(!negotiatedEquippedRuneProtocol('rune_trial', equippedPeers),
    'new-capability peers incorrectly applied equipped snapshots to Rune Trial');
  check(!negotiatedEquippedRuneProtocol('standard', peers(
    { tier: 'bone', capabilities: ['rune_trial_v1', 'equipped_rune_v1'] },
    { tier: 'stone', capabilities: ['rune_trial_v1'] },
  )), 'a cached Trial-only client was treated as equipped-rune capable');
  check(JSON.stringify(rankedSeatOrder('lower-rated-bot', 'higher-rated-human'))
      === JSON.stringify({ p1: 'lower-rated-bot', p2: 'higher-rated-human' }),
    'ranked bot seating displaced the lower-rated participant from the opening seat');
  check(JSON.stringify(rankedBotSides('human', 0, 'bot', 0))
      === JSON.stringify({ underdog: 'bot', favourite: 'human' }),
    'the existing bot-opening tiebreak was replaced by human-always-opens');
  check(JSON.stringify(rankedBotSides('human', 50, 'bot', 0))
      === JSON.stringify({ underdog: 'bot', favourite: 'human' }),
    'a genuinely lower-rated bot lost the ranked opening handicap');
  check(JSON.stringify(rankedBotSides('human', 0, 'bot', 50))
      === JSON.stringify({ underdog: 'human', favourite: 'bot' }),
    'a genuinely lower-rated human lost the ranked opening handicap');
  const startSource = readFileSync('supabase/functions/pvp-join/start.ts', 'utf8');
  check(startSource.includes('rankedSeatOrder(input.underdog, input.favourite)')
      && !startSource.includes('p1 = input.requester'),
    'ranked start still forces a human opener instead of preserving underdog p1');
  check(startSource.includes('svc.rpc("start_ranked_match_v3"')
      && startSource.includes('p_equipped_rune_protocol: equippedRuneProtocol'),
    'ranked start does not pass the negotiated equipped-rune protocol into v3 atomically');
  const compatibleTrial = {
    format: 'rune_trial', protocol_version: 2, rune_rules_version: 1,
  } as MatchRow;
  check(rankedClientCompatibilityError(compatibleTrial, {
    allowBot: false, protocolVersion: 1, capabilities: [],
  }) === 'incompatible-client', 'a legacy client can rejoin an active Trial');
  check(rankedClientCompatibilityError(compatibleTrial, {
    allowBot: false, protocolVersion: 2, capabilities: ['rune_trial_v1'],
  }) === null, 'a Trial-capable client is rejected from its active Trial');
  check(rankedClientCompatibilityError({
    ...compatibleTrial, rune_rules_version: 2,
  } as unknown as MatchRow, {
    allowBot: false, protocolVersion: 2, capabilities: ['rune_trial_v1'],
  }) === 'unsupported-rune-rules', 'an unknown Trial rules version did not fail closed');
  const equippedStandard = {
    format: 'standard', protocol_version: 2, rune_rules_version: 1,
  } as MatchRow;
  check(rankedClientCompatibilityError(equippedStandard, {
    allowBot: false, protocolVersion: 2, capabilities: ['rune_trial_v1'],
  }) === 'incompatible-client',
  'a cached Trial-only client can rejoin an equipped standard match');
  check(rankedClientCompatibilityError(equippedStandard, {
    allowBot: false, protocolVersion: 2,
    capabilities: ['rune_trial_v1', 'equipped_rune_v1'],
  }) === null, 'an equipped-rune client is rejected from its standard action match');
  check(rankedClientCompatibilityError({
    ...equippedStandard, rune_rules_version: 2,
  } as MatchRow, {
    allowBot: false, protocolVersion: 2,
    capabilities: ['rune_trial_v1', 'equipped_rune_v1'],
  }) === 'unsupported-rune-rules',
  'an unknown standard action-rules version did not fail closed');
  const queue = [
    { player_id: 'old-outside', created_at: '2026-08-23T10:00:00.000Z' },
    { player_id: 'new-inside', created_at: '2026-08-23T10:01:00.000Z' },
    { player_id: 'newest-inside', created_at: '2026-08-23T10:02:00.000Z' },
  ];
  const ratings = new Map([['old-outside', 1301], ['new-inside', 1150], ['newest-inside', 1050]]);
  check(oldestEligibleCandidate(queue, ratings, 1000, 150)?.player_id === 'new-inside',
    'matchmaking does not choose the oldest player inside the computed rating band');
  check(oldestEligibleCandidate(queue, ratings, 1000, 49) === null,
    'matchmaking accepts a player outside the computed rating band');
  check(oldestEligibleCandidate([...queue].reverse(), ratings, 1000, 150)?.player_id === 'new-inside',
    'matchmaking eligibility depends on incidental query order instead of queue age');
}
