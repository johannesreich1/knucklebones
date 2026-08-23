// Fast Node-side tests for the runtime-free Edge HTTP boundary. Operations are
// injected, so these exercise methods, CORS, auth, JSON parsing and typed input
// without a Deno global, network, or database.
import {
  CORS_HEADERS, createAuthenticator, json, postOnly, record,
  type AuthenticatedContext,
} from '../supabase/functions/_shared/http.ts';
import { createAccountDeleteHandler } from '../supabase/functions/account-delete/handler.ts';
import { createPvpJoinHandler } from '../supabase/functions/pvp-join/handler.ts';
import { createPvpMoveHandler } from '../supabase/functions/pvp-move/handler.ts';
import { createPvpClaimHandler } from '../supabase/functions/pvp-claim/handler.ts';
import { oldestEligibleCandidate } from '../supabase/functions/pvp-join/matchmaking.ts';
import type { MoveInput } from '../supabase/functions/_shared/types.ts';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, message: string) => { if (!ok) problems.push(message); };
const responseBody = async (response: Response) => JSON.parse(await response.text());

const context = {
  user: { id: 'player-1' }, authed: {}, service: () => ({}),
} as unknown as AuthenticatedContext;
const allowed = async () => context;
const denied = async () => null;

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

const joinInputs: boolean[] = [];
const joinHandler = createPvpJoinHandler({
  authenticate: allowed,
  operation: async (_received, input) => { joinInputs.push(input.allowBot); return json({ status: 'queued' }); },
});
await joinHandler(new Request('https://edge.test', { method: 'POST' }));
await joinHandler(new Request('https://edge.test', {
  method: 'POST', body: JSON.stringify({ allow_bot: true }),
}));
check(joinInputs.length === 2 && joinInputs[0] === false && joinInputs[1] === true,
  'join handler changed empty-body or allow_bot parsing');

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
