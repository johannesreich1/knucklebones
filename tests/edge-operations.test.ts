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
  EdgeOperationsService, edgeContext, jsonBody, materializeEdgeOperations, standardJoinInput,
} from './support/edge-operations.ts';
import { runTurnCommandTests } from './support/edge-turn-command.ts';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, message: string, detail?: unknown): void => {
  if (!ok) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const operations = await materializeEdgeOperations();
try {
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

  await runTurnCommandTests(check, operations);
  await runCheckedSettlementTests(check, operations);
} catch (error) {
  errs.push(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  operations.dispose();
}

console.log(JSON.stringify({ problems, errs }, null, 2));
process.exit(problems.length || errs.length ? 1 : 0);
