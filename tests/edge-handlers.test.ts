// Fast Node-side tests for the runtime-free Edge HTTP boundary. Operations are
// injected, so these exercise methods, CORS, auth, JSON parsing and typed input
// without a Deno global, network, or database.
import { readFileSync } from 'node:fs';
import {
  CORS_HEADERS, createAuthenticator, json, postOnly, record,
  type AuthenticatedContext,
} from '../supabase/functions/_shared/http.ts';
import { createAccountDeleteHandler } from '../supabase/functions/account-delete/handler.ts';
import { createPvpJoinHandler } from '../supabase/functions/pvp-join/handler.ts';
import { createPvpMoveHandler } from '../supabase/functions/pvp-move/handler.ts';
import { createPvpClaimHandler } from '../supabase/functions/pvp-claim/handler.ts';
import { createPvpRuneSelectHandler } from '../supabase/functions/pvp-rune-select/handler.ts';
import { selectRuneTrial } from '../supabase/functions/pvp-rune-select/operation.ts';
import { createPvpActionHandler } from '../supabase/functions/pvp-action/handler.ts';
import { verifyRuneTrialBotOpening } from './support/rune-trial-bot-opening-edge.ts';
import {
  negotiatedProtocolVersion,
  oldestEligibleCandidate,
  rankedSeatOrder,
  trialClientCompatibilityError,
} from '../supabase/functions/pvp-join/matchmaking.ts';
import type {
  ActionInput,
  JoinInput,
  MatchRow,
  MoveInput,
  RuneTrialSelectInput,
} from '../supabase/functions/_shared/types.ts';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) problems.push(message); };
const responseBody = async (response: Response) => JSON.parse(await response.text());

const context = {
  user: { id: 'player-1' }, authed: {}, service: () => ({}),
} as unknown as AuthenticatedContext;
const allowed = async () => context;
const denied = async () => null;

check(negotiatedProtocolVersion([
  { tier: 'ivory', capabilities: ['rune_trial_v1'] },
  { tier: 'stone', capabilities: ['rune_trial_v1'] },
]) === 2, 'two Trial-capable peers did not preserve protocol v2 on standard outcomes');
check(negotiatedProtocolVersion([
  { tier: 'ivory', capabilities: ['rune_trial_v1'] },
  { tier: 'ivory', capabilities: [] },
]) === 1, 'an old peer did not negotiate the standard protocol-v1 contract');
check(JSON.stringify(rankedSeatOrder('lower-rated-bot', 'higher-rated-human'))
    === JSON.stringify({ p1: 'lower-rated-bot', p2: 'higher-rated-human' }),
  'ranked bot seating displaced the lower-rated participant from the opening seat');
const compatibleTrial = {
  format: 'rune_trial', rune_rules_version: 1,
} as MatchRow;
check(trialClientCompatibilityError(compatibleTrial, {
  allowBot: false, protocolVersion: 1, capabilities: [],
}) === 'incompatible-client', 'a legacy client can rejoin an active Trial');
check(trialClientCompatibilityError(compatibleTrial, {
  allowBot: false, protocolVersion: 2, capabilities: ['rune_trial_v1'],
}) === null, 'a Trial-capable client is rejected from its active Trial');
check(trialClientCompatibilityError({
  ...compatibleTrial, rune_rules_version: 2,
} as unknown as MatchRow, {
  allowBot: false, protocolVersion: 2, capabilities: ['rune_trial_v1'],
}) === 'unsupported-rune-rules', 'an unknown Trial rules version did not fail closed');

const made = json({ ok: true }, 201);
check(made.status === 201, 'json() lost its explicit status');
check(made.headers.get('content-type') === 'application/json', 'json() lost JSON content type');
check(made.headers.get('access-control-allow-origin') === '*', 'json() lost CORS origin');
check((await responseBody(made)).ok === true, 'json() changed its body');

const preflight = postOnly(new Request('https://edge.test', { method: 'OPTIONS' }));
check(preflight?.status === 200, 'OPTIONS is not answered directly');
check(preflight?.headers.get('access-control-allow-headers') === CORS_HEADERS['Access-Control-Allow-Headers'],
  'OPTIONS lost the established allow-headers value');
check(preflight?.headers.get('access-control-allow-headers')?.includes('idempotency-key') === true,
  'pvp-move idempotency headers are not allowed through CORS');
const wrongMethod = postOnly(new Request('https://edge.test', { method: 'GET' }));
check(wrongMethod?.status === 405 && (await responseBody(wrongMethod!)).error === 'method-not-allowed',
  'non-POST method contract changed');
check(record({ value: 1 })?.value === 1 && record([]) === null && record(null) === null,
  'record() accepts a non-object JSON body');

const clientCalls: Array<{ url: string; key: string; authorization?: string }> = [];
const authedClient = { auth: { getUser: async () => ({ data: { user: { id: 'player-1' } } }) } };
const serviceClient = { marker: 'service' };
const factory = ((url: string, key: string, options?: { global?: { headers?: { Authorization?: string } } }) => {
  clientCalls.push({ url, key, authorization: options?.global?.headers?.Authorization });
  return key === 'anon-key' ? authedClient : serviceClient;
}) as never;
const authenticate = createAuthenticator({
  createClient: factory,
  env: { get: (name) => ({
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  } as Record<string, string>)[name] },
});
const authenticated = await authenticate(new Request('https://edge.test', {
  headers: { Authorization: 'Bearer token' },
}));
check(authenticated?.user.id === 'player-1', 'authenticator lost the verified user');
check(clientCalls.length === 1 && clientCalls[0].authorization === 'Bearer token',
  'authenticator did not forward Authorization or constructed service credentials before validation');
check(authenticated?.service() === serviceClient && authenticated.service() === serviceClient,
  'authenticator did not lazily construct and memoize the service client');
check(clientCalls.length === 2, 'service client construction count changed');

let deleteCalls = 0;
const deleteHandler = createAccountDeleteHandler({
  authenticate: allowed,
  operation: async (received) => { deleteCalls++; check(received === context, 'delete handler changed context'); return json({ deleted: true }); },
});
check((await deleteHandler(new Request('https://edge.test', { method: 'POST' }))).status === 200,
  'delete POST did not reach its operation');
check(deleteCalls === 1, 'delete operation call count changed');
const deniedDelete = createAccountDeleteHandler({ authenticate: denied, operation: async () => json({ impossible: true }) });
check((await deniedDelete(new Request('https://edge.test', { method: 'POST' }))).status === 401,
  'delete handler no longer rejects an unauthenticated request');

const joinInputs: JoinInput[] = [];
const joinHandler = createPvpJoinHandler({
  authenticate: allowed,
  operation: async (_received, input) => { joinInputs.push(input); return json({ status: 'queued' }); },
});
await joinHandler(new Request('https://edge.test', { method: 'POST' }));
await joinHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({
    allow_bot: true,
    protocol_version: 2,
    capabilities: ['rune_trial_v1'],
  }),
}));
check(joinInputs.length === 2
  && joinInputs[0].allowBot === false && joinInputs[0].protocolVersion === 1
  && joinInputs[0].capabilities.length === 0
  && joinInputs[1].allowBot === true && joinInputs[1].protocolVersion === 2
  && joinInputs[1].capabilities[0] === 'rune_trial_v1',
  'join handler changed legacy defaults or v2 capability parsing');
check((await joinHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({
    protocol_version: 1,
    capabilities: ['rune_trial_v1'],
  }),
}))).status === 400, 'protocol v1 can advertise Rune Trial capability');

const moveInputs: MoveInput[] = [];
const moveHandler = createPvpMoveHandler({
  authenticate: allowed,
  operation: async (_received, input) => { moveInputs.push(input); return json({ match: {} }); },
});
check((await moveHandler(new Request('https://edge.test', { method: 'POST', body: '{' }))).status === 400,
  'move malformed JSON no longer returns 400');
check((await moveHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({ match_id: 'm1', col: 1.5 }),
}))).status === 400, 'move accepts a non-integer manual column');
await moveHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({ match_id: 'm2', auto: 'truthy' }),
}));
check(moveInputs.length === 1 && moveInputs[0].matchId === 'm2' && moveInputs[0].auto === true,
  'move handler changed the existing truthy auto contract');
check(moveInputs[0].expectedMoveCount === null,
  'a cached legacy move body no longer reaches the compatibility path');

const commandId = '93000000-0000-4000-8000-000000000001';
await moveHandler(new Request('https://edge.test', {
  method: 'POST',
  headers: { 'Idempotency-Key': commandId },
  body: JSON.stringify({ match_id: 'm3', col: 2, expected_move_count: 7 }),
}));
await moveHandler(new Request('https://edge.test', {
  method: 'POST',
  headers: { 'Idempotency-Key': commandId },
  body: JSON.stringify({ match_id: 'm3', col: 2, expected_move_count: 7 }),
}));
check(moveInputs.length === 3
  && moveInputs[1].commandId === commandId && moveInputs[2].commandId === commandId
  && moveInputs[1].expectedMoveCount === 7 && moveInputs[2].expectedMoveCount === 7,
  'same-key handler retries did not preserve the command id and expected state version');
check((await moveHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({ match_id: 'm4', col: 0, expected_move_count: 0 }),
}))).status === 400, 'new move version is accepted without a caller command id');
check((await moveHandler(new Request('https://edge.test', {
  method: 'POST', headers: { 'Idempotency-Key': commandId },
  body: JSON.stringify({ match_id: 'm4', col: 0 }),
}))).status === 400, 'caller command id is accepted without an expected move version');

const claimInputs: Array<{ matchId: string; resign: boolean }> = [];
const claimHandler = createPvpClaimHandler({
  authenticate: allowed,
  operation: async (_received, input) => { claimInputs.push(input); return json({ match: {} }); },
});
check((await claimHandler(new Request('https://edge.test', { method: 'POST', body: '{' }))).status === 400,
  'claim malformed JSON no longer returns 400');
await claimHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({ match_id: 'm3', resign: 'true' }),
}));
await claimHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({ match_id: 'm4', resign: true }),
}));
check(claimInputs.length === 2 && claimInputs[0].resign === false && claimInputs[1].resign === true,
  'claim handler changed strict resign parsing');

const selectInputs: RuneTrialSelectInput[] = [];
const selectHandler = createPvpRuneSelectHandler({
  authenticate: allowed,
  operation: async (_received, input) => {
    selectInputs.push(input);
    return json({ match: {}, trial: {} });
  },
});
await selectHandler(new Request('https://edge.test', {
  method: 'POST',
  headers: { 'Idempotency-Key': commandId },
  body: JSON.stringify({ match_id: 'trial-1', rune_id: 'ward' }),
}));
const autoSelectId = '93000000-0000-4000-8000-000000000002';
await selectHandler(new Request('https://edge.test', {
  method: 'POST',
  body: JSON.stringify({ match_id: 'trial-1', command_id: autoSelectId, auto: true }),
}));
await selectHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({ match_id: 'trial-1', read: true }),
}));
check(selectInputs.length === 3
  && selectInputs[0].kind === 'commit' && selectInputs[0].runeId === 'ward'
  && !selectInputs[0].auto
  && selectInputs[1].kind === 'commit' && selectInputs[1].runeId === null
  && selectInputs[1].auto
  && selectInputs[2].kind === 'read' && selectInputs[2].matchId === 'trial-1',
  'Rune Trial selection handler lost manual choice or deadline auto-fill input');
check((await selectHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({
    match_id: 'trial-1', command_id: autoSelectId, auto: true, rune_id: 'ward',
  }),
}))).status === 400, 'deadline auto-selection accepts a caller-selected rune');
check((await selectHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({
    match_id: 'trial-1', command_id: autoSelectId, rune_id: 'unknown',
  }),
}))).status === 400, 'Rune Trial selection accepts an unknown rune');
check((await selectHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({
    match_id: 'trial-1', read: true, command_id: autoSelectId,
  }),
}))).status === 400, 'read-only Trial resume accepts mutating command fields');

const resumeCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
const terminalTrial = {
  match: { id: 'trial-1', status: 'forfeit', format: 'rune_trial', rune_rules_version: 1 },
  trial: { your_choice: 'ward' },
};
const resumeContext = {
  user: { id: 'player-1' }, authed: {},
  service: () => ({
    rpc: async (name: string, input: Record<string, unknown>) => {
      resumeCalls.push({ name, input });
      return { data: terminalTrial, error: null };
    },
  }),
} as unknown as AuthenticatedContext;
const terminalResume = await selectRuneTrial(resumeContext, {
  kind: 'read', matchId: 'trial-1',
});
check(terminalResume.status === 200
  && (await responseBody(terminalResume)).match.status === 'forfeit'
  && resumeCalls.length === 1 && resumeCalls[0].name === 'rune_trial_state'
  && resumeCalls[0].input.p_match_id === 'trial-1'
  && resumeCalls[0].input.p_actor === 'player-1',
  'terminal Trial resume mutated matchmaking or failed to return the settled row');
let finalizerCalls = 0;
const finalizedResume = await selectRuneTrial(resumeContext, {
  kind: 'read', matchId: 'trial-1',
}, async (received, payload) => {
  finalizerCalls++;
  check(received === resumeContext, 'Rune Trial finalizer received the wrong auth context');
  return payload;
});
check(finalizedResume.status === 200 && finalizerCalls === 1,
  'Rune Trial selection response bypassed its authoritative post-reveal finalizer');

const startSource = readFileSync('supabase/functions/pvp-join/start.ts', 'utf8');
check(startSource.includes('rankedSeatOrder(input.underdog, input.favourite)')
    && !startSource.includes('p1 = input.requester'),
  'ranked start still forces a human opener instead of preserving underdog p1');
const selectIndex = readFileSync('supabase/functions/pvp-rune-select/index.ts', 'utf8');
const joinOperation = readFileSync('supabase/functions/pvp-join/operation.ts', 'utf8');
const botOpeningSource = readFileSync(
  'supabase/functions/_shared/rune-trial-bot-opening.ts', 'utf8',
);
check(selectIndex.includes('ensureRuneTrialBotOpening')
    && joinOperation.includes('ensureRuneTrialBotOpening'),
  'selection finalization or reconnect no longer heals a missing ranked bot opener');
check(botOpeningSource.includes('appendRankedBotTurn(')
    && botOpeningSource.includes('commitMatchAction(')
    && botOpeningSource.includes('actor: match.p1')
    && botOpeningSource.includes('expectedActionVersion: before.actionCount'),
  'ranked Trial bot opener bypasses shared replay or the atomic action command');
await verifyRuneTrialBotOpening(check);

const actionInputs: ActionInput[] = [];
const actionHandler = createPvpActionHandler({
  authenticate: allowed,
  operation: async (_received, input) => {
    actionInputs.push(input);
    return json({ match: {}, actions: [], action_version: input.expectedActionVersion + 1 });
  },
});
await actionHandler(new Request('https://edge.test', {
  method: 'POST',
  body: JSON.stringify({
    match_id: 'trial-1',
    command_id: commandId,
    expected_action_version: 0,
    action: { kind: 'cast', rune_id: 'nudge', target_col: -1 },
  }),
}));
const aimActionId = '93000000-0000-4000-8000-000000000004';
await actionHandler(new Request('https://edge.test', {
  method: 'POST',
  body: JSON.stringify({
    match_id: 'trial-2', command_id: aimActionId,
    expected_action_version: 0,
    action: { kind: 'aim', rune_id: 'anvil' },
  }),
}));
const autoActionId = '93000000-0000-4000-8000-000000000003';
await actionHandler(new Request('https://edge.test', {
  method: 'POST',
  body: JSON.stringify({
    match_id: 'trial-1', command_id: autoActionId,
    expected_action_version: 1, auto: true,
  }),
}));
check(actionInputs.length === 3
  && actionInputs[0].action?.kind === 'cast' && actionInputs[0].expectedActionVersion === 0
  && actionInputs[1].action?.kind === 'aim' && actionInputs[1].action.rune_id === 'anvil'
  && actionInputs[2].action === null && actionInputs[2].auto,
  'v2 action handler lost cast, authoritative aim, or stalled auto-recovery input');
check((await actionHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({
    match_id: 'trial-1', command_id: autoActionId,
    expected_action_version: 1, auto: true,
    action: { kind: 'place', placed_col: 0 },
  }),
}))).status === 400, 'automatic action accepts caller-controlled placement');
check((await actionHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({
    match_id: 'trial-1', command_id: autoActionId,
    expected_action_version: 1,
    action: { kind: 'cast', rune_id: 'ward', target_col: 4 },
  }),
}))).status === 400, 'v2 action accepts an out-of-range target');
check((await actionHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({
    match_id: 'trial-1', command_id: autoActionId,
    expected_action_version: 1,
    action: { kind: 'aim', rune_id: 'anvil', target_col: 0 },
  }),
}))).status === 400, 'authoritative aim accepts a premature target');

let optionsAuthenticated = false;
const optionsHandler = createPvpMoveHandler({
  authenticate: async () => { optionsAuthenticated = true; return context; },
  operation: async () => json({ impossible: true }),
});
const optionsResponse = await optionsHandler(new Request('https://edge.test', { method: 'OPTIONS' }));
check(optionsResponse.status === 200 && !optionsAuthenticated,
  'handler authenticates OPTIONS instead of ending at the CORS boundary');

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

console.log(JSON.stringify({ problems, errs }, null, 2));
