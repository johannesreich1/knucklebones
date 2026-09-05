// Direct behavioral tests for the four big pvp Edge operations (move/action/
// join/claim), imported from their materialized deploy closures and driven
// against the recording service double in tests/support/edge-operations.ts.
// They pin what used to be regex assertions over source text: shared stall
// thresholds gate every recovery, every write goes through the atomic
// command/settlement RPCs with the observed last_move_at and log version, a
// bot's reply joins the same command, and each failure maps to its exact
// HTTP contract.
//
// This entry owns the single temp root every case shares — materialize once,
// run both contracts against it, dispose in finally — and the one failure all
// of the operations answer identically. The contracts themselves sit beside
// the harness: a turn commits as one atomic command in either protocol
// (edge-turn-command.ts), and settlement reached outside a turn stays locked
// to the replayed log version (edge-checked-settlement.ts).
import { runCheckedSettlementTests } from './support/edge-checked-settlement.ts';
import {
  EdgeOperationsService, edgeContext, jsonBody, materializeEdgeOperations,
  type RpcRoute, standardJoinInput,
} from './support/edge-operations.ts';
import { runTurnCommandTests } from './support/edge-turn-command.ts';
import { emitReport } from './support/emit-report.mjs';
import { sweepAbandonedSeats } from '../supabase/functions/pvp-join/queue-liveness.ts';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, message: string, detail?: unknown): void => {
  if (!ok) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const operations = await materializeEdgeOperations();
try {
  // Import the queue sweep directly so the ordinary TypeScript gate checks
  // its types too: materialized dynamic imports erase them without checking.
  for (const fails of [false, true]) {
    const service = new EdgeOperationsService({
      matchmaking_queue: () => ({ error: fails ? { message: 'db down' } : null }),
    });
    const swept = await sweepAbandonedSeats(edgeContext('player-1', service).service());
    const [read] = service.reads;
    const cutoff = read?.filters.find(([filter]) => filter === 'lt:last_seen_at')?.[1];
    check(swept === !fails && service.reads.length === 1 && read?.kind === 'delete'
      && typeof cutoff === 'string' && Date.parse(cutoff) < Date.now(),
      'the queue sweep must delete stale heartbeats and report database failure', { fails, swept, read });
  }

  // A failed match read is an infrastructure error, never a game answer.
  for (const [label, run] of [
    ['moveMatch', (s: EdgeOperationsService) => operations.moveMatch(edgeContext('player-1', s),
      { matchId: 'match-1', col: 0, auto: false, commandId: 'cmd-1', expectedMoveCount: null })],
    ['claimMatch', (s: EdgeOperationsService) => operations.claimMatch(edgeContext('player-1', s),
      { matchId: 'match-1', resign: false })],
    ['joinMatch', (s: EdgeOperationsService) => operations.joinMatch(
      edgeContext('player-1', s), standardJoinInput)],
  ] as const) {
    const unreadable = new EdgeOperationsService({ matches: () => ({ error: { message: 'db down' } }) });
    const unread = await run(unreadable);
    check(unread.status === 500 && (await jsonBody(unread)).error === 'match-read-failed',
      `${label} did not map a failed match read to match-read-failed`);
  }

  /* A CLIENT TOO OLD FOR THE ACTIVE CURVE IS TOLD SO. Both of these answered
     with something else until 2026-09-04, and the cost was not theoretical: a
     capability refusal reached players as CAN'T CONNECT, so the sheet that
     says "update Knucklebones" — which the client has always routed
     `incompatible-client` to — never appeared, and people were sent to inspect
     their wifi instead. */
  {
    const onCurveTwo = () => ({
      data: { curve_version: 2, scoring_version: 2, admission_paused: false },
    });
    /* Routed all the way to the queue on purpose: a client that should have
       been refused at the guard must not simply throw on the first table it
       was never meant to reach — it must be seen QUEUEING, which is the defect
       stated as the player would meet it. */
    const joinService = (enqueue: RpcRoute) =>
      new EdgeOperationsService({
        matches: () => ({ data: null }),
        matchmaking_queue: () => ({ data: null }),
        profiles: () => ({ data: { rating: 0, ranked_pool_tier: 'stone' } }),
      }, {
        ranked_runtime_contract: onCurveTwo,
        current_season: () => ({ data: 1 }),
        players_near: () => ({ data: 0 }),
        enqueue_ranked_player_v3: enqueue,
      });

    /* The guard used to read the capability alone while the RPC also requires
       protocol 2, so a client claiming curve_v2 on protocol 1 walked past it
       and was refused a statement later, as an exception. */
    const stale = joinService(() => ({ data: { status: 'queued' } }));
    const staleReply = await operations.joinMatch(edgeContext('player-1', stale),
      { ...standardJoinInput, protocolVersion: 1, capabilities: ['curve_v2'] });
    const staleBody = await jsonBody(staleReply);
    check(staleReply.status === 409 && staleBody.error === 'incompatible-client',
      'joinMatch let a protocol-1 client past the curve-v2 guard by claiming the capability',
      { status: staleReply.status, body: staleBody });

    /* And a refusal the RPC itself raises keeps its reason instead of becoming
       a generic 500 that the client cannot tell from an unreachable server. */
    const refused = joinService(() => ({
      error: { code: 'P0001', message: 'ranked client does not support active curve v2' },
    }));
    const refusedReply = await operations.joinMatch(edgeContext('player-1', refused),
      { ...standardJoinInput, protocolVersion: 2, capabilities: ['curve_v2'] });
    /* read ONCE: a Response body does not survive a second reader, and asking
       twice reports a TypeError where the assertion should have been */
    const refusedBody = await jsonBody(refusedReply);
    check(refusedReply.status === 409 && refusedBody.error === 'incompatible-client',
      'joinMatch collapsed a curve-v2 refusal into a generic queue failure',
      { status: refusedReply.status, body: refusedBody });
  }

  await runTurnCommandTests(check, operations);
  await runCheckedSettlementTests(check, operations);
} catch (error) {
  errs.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  operations.dispose();
}

emitReport({ problems, errs }, problems.length || errs.length);
