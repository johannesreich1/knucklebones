// Focused Node contract for the additive progression-v2 Edge rollout. The
// join operation is injected so request parsing is exercised without Deno,
// network, or database state; settlement runs against the recording service
// double and therefore observes the exact JSON sent to the atomic RPC.
import { LADDER_FORMULA_VERSION, settle } from '../src/core/ladder.ts';
import { json, type AuthenticatedContext, type EdgeClient } from '../supabase/functions/_shared/http.ts';
import { settleMatch } from '../supabase/functions/_shared/settlement.ts';
import type { JoinInput, LadderRow, MatchRow } from '../supabase/functions/_shared/types.ts';
import { createPvpJoinHandler } from '../supabase/functions/pvp-join/handler.ts';
import { SettlementService } from './support/edge-settlement-doubles.ts';
import { standardMatch } from './support/edge-operations.ts';
import {
  materializeProgressiveStart,
  type ProgressiveStart,
} from './support/progression-v2-start.ts';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) problems.push(message); };

type ProgressionJoinInput = JoinInput & { entryKind: 'ordinary' | 'weekly' };
type SettlementMetadata = {
  _scoring_version: number;
  _base_rating_delta: number;
  _finish_rating_delta: number;
};
type MatchWithSettlementComponents = MatchRow & {
  scoring_version: number;
  p1_base_rating_delta: number;
  p2_base_rating_delta: number;
  p1_finish_rating_delta: number;
  p2_finish_rating_delta: number;
};

const context = {
  user: { id: 'player-1' }, authed: {}, service: () => ({}),
} as unknown as AuthenticatedContext;
const observed: ProgressionJoinInput[] = [];
const join = createPvpJoinHandler({
  authenticate: async () => context,
  operation: async (_context, input) => {
    observed.push(input as ProgressionJoinInput);
    return json({ status: 'queued' });
  },
});

const request = (body?: Record<string, unknown>) => new Request('https://edge.test', {
  method: 'POST',
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/* Omission is the legacy wire shape and must enter the ordinary lane. The two
   explicit literals are the complete accepted entry-kind vocabulary. */
check((await join(request())).status === 200,
  'legacy pvp-join omission was rejected');
check(observed.length === 1
  && observed[0].entryKind === 'ordinary'
  && observed[0].protocolVersion === 1
  && observed[0].capabilities.length === 0,
  'legacy pvp-join omission did not normalize to an ordinary v1 entry');

check((await join(request({ entry_kind: 'ordinary' }))).status === 200,
  'explicit ordinary pvp-join entry was rejected');
check(observed.at(-1)?.entryKind === 'ordinary',
  'explicit ordinary pvp-join entry changed lanes');

check((await join(request({
  entry_kind: 'weekly',
  protocol_version: 2,
  capabilities: ['curve_v2'],
}))).status === 200,
  'weekly pvp-join entry with curve-v2 support was rejected');
check(observed.at(-1)?.entryKind === 'weekly',
  'weekly pvp-join entry did not reach the weekly lane');

const callsBeforeBadEntryKinds = observed.length;
for (const entryKind of [null, '', 'tournament', 2]) {
  check((await join(request({ entry_kind: entryKind }))).status === 400,
    `invalid pvp-join entry_kind ${JSON.stringify(entryKind)} was accepted`);
}
check(observed.length === callsBeforeBadEntryKinds,
  'an invalid pvp-join entry kind reached matchmaking');

/* New capabilities are additive, but never weaken the existing dependency
   graph. CLAIM is meaningful only to a v2 client that understands both the
   v2 curve and the base Rune Trial flow. */
check((await join(request({
  protocol_version: 2,
  capabilities: ['curve_v2'],
}))).status === 200,
  'ordinary curve-v2 capability was rejected');
check(observed.at(-1)?.capabilities.join(',') === 'curve_v2',
  'curve-v2 capability was not forwarded exactly');

check((await join(request({
  protocol_version: 2,
  capabilities: ['rune_trial_v1', 'curve_v2', 'rune_trial_claim_v2'],
}))).status === 200,
  'complete Rune Trial CLAIM capability set was rejected');
check(observed.at(-1)?.capabilities.join(',')
  === 'rune_trial_v1,curve_v2,rune_trial_claim_v2',
  'Rune Trial CLAIM capabilities were not forwarded exactly');

const rejectedCapabilitySets: Array<{
  label: string;
  protocol_version: number;
  entry_kind?: string;
  capabilities: string[];
}> = [
  {
    label: 'protocol v1 advertising curve-v2',
    protocol_version: 1,
    capabilities: ['curve_v2'],
  },
  {
    label: 'weekly entry without curve-v2',
    protocol_version: 2,
    entry_kind: 'weekly',
    capabilities: [],
  },
  {
    label: 'CLAIM without base Rune Trial',
    protocol_version: 2,
    capabilities: ['curve_v2', 'rune_trial_claim_v2'],
  },
  {
    label: 'CLAIM without curve-v2',
    protocol_version: 2,
    capabilities: ['rune_trial_v1', 'rune_trial_claim_v2'],
  },
  {
    label: 'unknown progression capability',
    protocol_version: 2,
    capabilities: ['curve_v3'],
  },
];
const callsBeforeBadCapabilities = observed.length;
for (const candidate of rejectedCapabilitySets) {
  const { label, ...body } = candidate;
  check((await join(request(body))).status === 400,
    `${label} was accepted`);
}
check(observed.length === callsBeforeBadCapabilities,
  'an invalid progression capability set reached matchmaking');

/* A pending bot debut belongs only to the ordinary lane. Weekly entry must
   start the persisted rotation outcome as a one-item roster and explicitly
   send null to the atomic RPC, otherwise the unrelated debut is consumed (or
   the database rejects a weekly start carrying two competing authorities). */
const weeklyModifier = 'limited';
const pendingBotDebut = 'bounty';
const weeklyRotationId = '2026-W36';
const weeklyReads: Array<{ column: string; value: unknown }> = [];
const weeklyRpcCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
type WeeklyQuery = {
  select(columns: string): WeeklyQuery;
  eq(column: string, value: unknown): WeeklyQuery;
  single(): Promise<{ data: { modifier: string }; error: null }>;
};
const weeklyService = {
  from(table: string): WeeklyQuery {
    if (table !== 'ranked_weekly_rotations') {
      throw new Error(`unexpected weekly start table: ${table}`);
    }
    const query: WeeklyQuery = {
      select: (columns) => {
        check(columns === 'modifier', 'weekly start read more than the persisted modifier');
        return query;
      },
      eq: (column, value) => {
        weeklyReads.push({ column, value });
        return query;
      },
      single: async () => ({ data: { modifier: weeklyModifier }, error: null }),
    };
    return query;
  },
  async rpc(name: string, input: Record<string, unknown>) {
    weeklyRpcCalls.push({ name, input });
    return { data: { match: { id: 'weekly-match' } }, error: null };
  },
} as unknown as EdgeClient;

let weeklyStart: Awaited<ReturnType<ProgressiveStart>> | null = null;
const materialized = await materializeProgressiveStart();
try {
  /* Curve v2 itself requires protocol 2; this weekly Limited match deliberately
     advertises neither Rune Trial nor equipped-rune support. */
  const capabilities = ['curve_v2'];
  const access = {
    tier: 'stone' as const,
    entitlementIds: ['classic', pendingBotDebut],
    capabilities,
  };
  weeklyStart = await materialized.start(weeklyService, {
    requester: 'player-1',
    season: 4,
    underdog: 'player-1',
    favourite: 'bot-1',
    queuedOpponent: null,
    underdogAccess: access,
    favouriteAccess: access,
    bot: { id: 'bot-1', rating: 700 },
    curveVersion: 2,
    scoringVersion: 2,
    entryKind: 'weekly',
    weeklyRotationId,
    botDebutOutcome: pendingBotDebut,
  });
} catch (error) {
  errs.push(`weekly start with pending bot debut threw: ${String(error)}`);
} finally {
  materialized.dispose();
}

const weeklyRpc = weeklyRpcCalls[0];
const weeklyRoster = weeklyRpc?.input.p_outcome_roster;
check(weeklyStart?.match.id === 'weekly-match'
  && weeklyReads.length === 1
  && weeklyReads[0].column === 'id'
  && weeklyReads[0].value === weeklyRotationId,
  'weekly v2 start did not resolve the persisted rotation');
check(weeklyRpcCalls.length === 1
  && weeklyRpc?.name === 'start_ranked_match_v4'
  && weeklyRpc.input.p_protocol_version === 2
  && weeklyRpc.input.p_modifier === weeklyModifier
  && Array.isArray(weeklyRoster)
  && weeklyRoster.length === 1
  && weeklyRoster[0] === weeklyModifier,
  'weekly v2 start did not persist its modifier as the one-item outcome roster');
check(Object.hasOwn(weeklyRpc?.input ?? {}, 'p_bot_debut_outcome')
  && weeklyRpc?.input.p_bot_debut_outcome === null,
  'weekly v2 start forwarded or omitted the unrelated pending bot debut');

/* An unsupported pending Rune Trial debut remains durable for a later capable
   bot game. It must neither force an outcome outside this client's negotiated
   roster nor reach v4 as a debut that settlement would consume. */
const unsupportedDebutCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
const unsupportedDebutService = {
  async rpc(name: string, input: Record<string, unknown>) {
    unsupportedDebutCalls.push({ name, input });
    return { data: { match: { id: 'ordinary-with-pending-trial' } }, error: null };
  },
} as unknown as EdgeClient;
let unsupportedDebutStart: Awaited<ReturnType<ProgressiveStart>> | null = null;
const unsupportedMaterialized = await materializeProgressiveStart();
try {
  const access = {
    tier: 'ivory' as const,
    entitlementIds: ['classic', 'rune_trial'],
    capabilities: ['curve_v2'],
  };
  unsupportedDebutStart = await unsupportedMaterialized.start(unsupportedDebutService, {
    requester: 'player-1',
    season: 4,
    underdog: 'player-1',
    favourite: 'player-2',
    queuedOpponent: 'player-2',
    underdogAccess: access,
    favouriteAccess: access,
    curveVersion: 2,
    scoringVersion: 2,
    entryKind: 'ordinary',
    weeklyRotationId: null,
    botDebutOutcome: 'rune_trial',
  });
} catch (error) {
  errs.push(`ordinary v2 start with an unsupported pending Rune Trial threw: ${String(error)}`);
} finally {
  unsupportedMaterialized.dispose();
}
const unsupportedDebutRpc = unsupportedDebutCalls[0];
check(unsupportedDebutStart?.match.id === 'ordinary-with-pending-trial'
  && unsupportedDebutCalls.length === 1
  && unsupportedDebutRpc?.name === 'start_ranked_match_v4'
  && unsupportedDebutRpc.input.p_protocol_version === 2
  && unsupportedDebutRpc.input.p_modifier === 'classic'
  && JSON.stringify(unsupportedDebutRpc.input.p_outcome_roster) === '["classic"]'
  && unsupportedDebutRpc.input.p_bot_debut_outcome === null,
  'unsupported pending Rune Trial was forced, consumed, or downgraded from protocol v2');

/* Formula-v2 settlement keeps the RPC signature stable: its component/version
   metadata rides inside the existing next-row JSON objects. The returned match
   is the durable parser boundary used by every terminal Edge path. */
const match = standardMatch({
  turn: 0,
  p1_score: 0,
  p2_score: 0,
  scoring_version: LADDER_FORMULA_VERSION,
  curve_version: 2,
  last_move_at: '2026-09-01T12:00:00.000Z',
});
const service = new SettlementService();
const p1 = service.rows.get(match.p1)!;
const p2 = service.rows.get(match.p2)!;
const expected = settle(p1, p2, 1, {
  finish: { kind: 'normal', aScore: 24, bScore: 12 },
});
const returnedMatch: MatchWithSettlementComponents = {
  ...match,
  status: 'done',
  winner: match.p1,
  p1_score: 24,
  p2_score: 12,
  p1_rating_delta: expected.aDelta.total,
  p2_rating_delta: expected.bDelta.total,
  scoring_version: LADDER_FORMULA_VERSION,
  p1_base_rating_delta: expected.aDelta.base,
  p2_base_rating_delta: expected.bDelta.base,
  p1_finish_rating_delta: expected.aDelta.finish,
  p2_finish_rating_delta: expected.bDelta.finish,
};
service.replies = [{ data: { applied: true, match: returnedMatch } }];
const settled = await settleMatch(
  service as unknown as EdgeClient,
  match,
  { status: 'done', winner: match.p1, p1Score: 24, p2Score: 12, p1Result: 1 },
  settle,
);
const rpc = service.rpcCalls[0];
const nextP1 = rpc?.p_next_p1 as (LadderRow & SettlementMetadata) | undefined;
const nextP2 = rpc?.p_next_p2 as (LadderRow & SettlementMetadata) | undefined;
check(service.rpcCalls.length === 1
  && nextP1?._scoring_version === LADDER_FORMULA_VERSION
  && nextP1?._base_rating_delta === expected.aDelta.base
  && nextP1?._finish_rating_delta === expected.aDelta.finish
  && nextP2?._scoring_version === LADDER_FORMULA_VERSION
  && nextP2?._base_rating_delta === expected.bDelta.base
  && nextP2?._finish_rating_delta === expected.bDelta.finish,
  'settlement did not carry the exact v2 component metadata in next-row JSON');

const parsedMatch = settled.match as MatchWithSettlementComponents;
check(parsedMatch.scoring_version === LADDER_FORMULA_VERSION
  && parsedMatch.p1_base_rating_delta === expected.aDelta.base
  && parsedMatch.p1_finish_rating_delta === expected.aDelta.finish
  && parsedMatch.p2_base_rating_delta === expected.bDelta.base
  && parsedMatch.p2_finish_rating_delta === expected.bDelta.finish,
  'settlement parser dropped or changed returned v2 component fields');

const malformedService = new SettlementService();
malformedService.replies = [{
  data: {
    applied: true,
    match: { ...returnedMatch, p2_finish_rating_delta: 'not-an-integer' },
  },
}];
let malformedRejected = false;
try {
  await settleMatch(
    malformedService as unknown as EdgeClient,
    match,
    { status: 'done', winner: match.p1, p1Score: 24, p2Score: 12, p1Result: 1 },
    settle,
  );
} catch (error) {
  malformedRejected = String(error).includes('invalid payload');
}
check(malformedRejected,
  'settlement parser accepted malformed formula-v2 component metadata');

console.log(JSON.stringify({ problems, errs }, null, 2));
