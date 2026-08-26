// Harness for driving the four big pvp Edge operations (move/action/join/
// claim) as real functions under Node. Their `./core/*` imports exist only in
// the computed deploy closure, so — like the bot-opening edge test — the
// closure is materialized into a temp directory and imported from there: what
// runs is exactly what deploys. The service double is one generic PostgREST
// builder: every chained filter is recorded, every read is answered by a
// per-table route the test provides, and any unrouted table or RPC fails
// loudly instead of pretending the database answered.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AuthenticatedContext, EdgeClient } from '../../supabase/functions/_shared/http.ts';
import type {
  ActionInput, ClaimInput, JoinInput, LadderRow, MatchRow, MoveInput,
} from '../../supabase/functions/_shared/types.ts';
import { rebuild, type MoveRow } from '../../src/core/match.ts';
import { legalCols, type Mode } from '../../src/core/rules.ts';
import { uploadPayload } from '../../tools/fnfiles.mjs';

export type EdgeOperation<Input> =
  (context: AuthenticatedContext, input: Input) => Promise<Response>;

export interface EdgeOperations {
  moveMatch: EdgeOperation<MoveInput>;
  actionMatch: EdgeOperation<ActionInput>;
  joinMatch: EdgeOperation<JoinInput>;
  claimMatch: EdgeOperation<ClaimInput>;
  dispose(): void;
}

/** Materialize each function's deploy closure and import the operation the
    deploy would run. One temp root, disposed by the caller. */
export async function materializeEdgeOperations(): Promise<EdgeOperations> {
  const root = mkdtempSync(path.join(tmpdir(), 'knucklebones-edge-operations-'));
  const operationModule = async (slug: string) => {
    const functionDir = path.join(root, slug);
    mkdirSync(functionDir, { recursive: true });
    for (const file of uploadPayload(slug)) {
      const target = path.resolve(functionDir, file.name);
      if (!target.startsWith(root + path.sep)) throw new Error('edge fixture escaped its temp root');
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.content);
    }
    return await import(pathToFileURL(path.join(functionDir, 'operation.ts')).href);
  };
  const [move, action, join, claim] = await Promise.all([
    operationModule('pvp-move'), operationModule('pvp-action'),
    operationModule('pvp-join'), operationModule('pvp-claim'),
  ]);
  return {
    moveMatch: move.moveMatch as EdgeOperation<MoveInput>,
    actionMatch: action.actionMatch as EdgeOperation<ActionInput>,
    joinMatch: join.joinMatch as EdgeOperation<JoinInput>,
    claimMatch: claim.claimMatch as EdgeOperation<ClaimInput>,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

export interface TableRead {
  table: string;
  kind: 'select' | 'delete' | 'upsert';
  filters: Array<[string, unknown]>;
  single: 'single' | 'maybeSingle' | null;
  head: boolean;
  payload?: unknown;
}

export interface TableReply {
  data?: unknown;
  error?: { code?: string; message: string } | null;
  count?: number | null;
}

export type TableRoute = (read: TableRead) => TableReply;
export type RpcRoute = (input: Record<string, unknown>) => TableReply;

/* One thenable builder covers every chain the operations use; awaiting at any
   stage resolves through the table route. */
class QueryBuilder implements PromiseLike<Required<TableReply>> {
  private readonly read: TableRead;
  private readonly route: TableRoute;
  constructor(read: TableRead, route: TableRoute) {
    this.read = read;
    this.route = route;
  }
  private chain(filter: string, value: unknown): this {
    this.read.filters.push([filter, value]);
    return this;
  }
  select(columns: string, options?: { count?: string; head?: boolean }): this {
    this.read.head = options?.head === true;
    return this.chain('select', columns);
  }
  eq(column: string, value: unknown): this { return this.chain(`eq:${column}`, value); }
  neq(column: string, value: unknown): this { return this.chain(`neq:${column}`, value); }
  or(filter: string): this { return this.chain('or', filter); }
  in(column: string, values: unknown[]): this { return this.chain(`in:${column}`, values); }
  lt(column: string, value: unknown): this { return this.chain(`lt:${column}`, value); }
  order(column: string, options?: { ascending?: boolean }): this {
    return this.chain('order', { column, ...options });
  }
  limit(count: number): this { return this.chain('limit', count); }
  delete(): this { this.read.kind = 'delete'; return this; }
  upsert(payload: unknown, options?: unknown): this {
    this.read.kind = 'upsert';
    this.read.payload = payload;
    return this.chain('upsert', options ?? null);
  }
  single(): this { this.read.single = 'single'; return this; }
  maybeSingle(): this { this.read.single = 'maybeSingle'; return this; }
  then<A, B>(
    onFulfilled?: ((value: Required<TableReply>) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve().then(() => {
      const reply = this.route(this.read);
      return { data: reply.data ?? null, error: reply.error ?? null, count: reply.count ?? null };
    }).then(onFulfilled, onRejected);
  }
}

export class EdgeOperationsService {
  readonly reads: TableRead[] = [];
  readonly rpcCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  private readonly tables: Record<string, TableRoute>;
  private readonly rpcs: Record<string, RpcRoute>;
  constructor(tables: Record<string, TableRoute>, rpcs: Record<string, RpcRoute> = {}) {
    this.tables = tables;
    this.rpcs = rpcs;
  }

  from(table: string): QueryBuilder {
    const read: TableRead = { table, kind: 'select', filters: [], single: null, head: false };
    this.reads.push(read);
    return new QueryBuilder(read, (request) => {
      const route = this.tables[table];
      if (!route) throw new Error(`unrouted table ${table}`);
      return route(request);
    });
  }

  async rpc(name: string, input: Record<string, unknown>): Promise<Required<TableReply>> {
    this.rpcCalls.push({ name, input });
    const route = this.rpcs[name];
    if (!route) throw new Error(`unrouted RPC ${name}`);
    const reply = route(input);
    return { data: reply.data ?? null, error: reply.error ?? null, count: reply.count ?? null };
  }

  tableReads(table: string): TableRead[] {
    return this.reads.filter((read) => read.table === table);
  }
}

export function edgeContext(userId: string, service: EdgeOperationsService): AuthenticatedContext {
  return {
    user: { id: userId }, authed: {},
    service: () => service as unknown as EdgeClient,
  } as unknown as AuthenticatedContext;
}

export const ladderRow = (points: number): LadderRow =>
  ({ points, peak: points, wins: 1, losses: 1, draws: 0 });

export const EDGE_SEED = 'edge-operations-seed';
/** Timestamps a fixed 4s on either side of a stall threshold, wide enough
    that wall-clock drift inside one test run cannot flip the comparison. */
export const beforeThreshold = (ms: number) => new Date(Date.now() - ms + 4_000).toISOString();
export const afterThreshold = (ms: number) => new Date(Date.now() - ms - 4_000).toISOString();

/** season_ratings as buildSettlementSnapshot reads them: create-if-missing
    upserts acknowledged, then per-player ladder snapshots. */
export const seasonRoute: TableRoute = (read) => read.kind === 'upsert'
  ? {}
  : { data: ladderRow(read.filters.some(([f, v]) => f === 'eq:player' && v === 'player-1') ? 80 : 40) };

/* The commit RPCs validate their own response shape; echoing p_response_meta
   back keeps the double honest about what the operation actually committed. */
export const commitEcho = (row: MatchRow): RpcRoute => (input) => ({
  data: { match: row, ...(input.p_response_meta as Record<string, unknown>) },
});
export const actionEcho = (row: MatchRow): RpcRoute => (input) => ({
  data: {
    match: row, actions: input.p_actions,
    action_version: (input.p_actions as unknown[]).length,
    ...(input.p_response_meta as Record<string, unknown>),
  },
});

export const moveTables = (
  match: MatchRow, moves: unknown[], opponent: { is_bot: boolean; rating?: number },
): Record<string, TableRoute> => ({
  matches: () => ({ data: match }),
  match_moves: () => ({ data: moves }),
  match_seeds: () => ({ data: { seed: EDGE_SEED } }),
  profiles: () => ({ data: { is_bot: opponent.is_bot, rating: opponent.rating ?? 500 } }),
  season_ratings: seasonRoute,
});

export const actionTables = (match: MatchRow, botOpponent = false): Record<string, TableRoute> => ({
  matches: () => ({ data: match }),
  match_actions: () => ({ data: [] }),
  match_seeds: () => ({ data: { seed: EDGE_SEED } }),
  profiles: () => ({ data: { id: match.p2, is_bot: botOpponent, rating: 700 } }),
  season_ratings: seasonRoute,
});

export const claimTables = (
  match: MatchRow, moves: unknown[], botOpponent = false,
): Record<string, TableRoute> => ({
  matches: () => ({ data: match }),
  profiles: () => ({ data: { is_bot: botOpponent } }),
  match_moves: () => ({ data: moves }),
  match_actions: () => ({ data: [] }),
  match_seeds: () => ({ data: { seed: EDGE_SEED } }),
  season_ratings: seasonRoute,
});

export const standardMatch = (overrides: Partial<MatchRow> = {}): MatchRow => ({
  id: 'match-1', p1: 'player-1', p2: 'player-2', status: 'active', turn: 1,
  winner: null, p1_score: null, p2_score: null,
  p1_rating_delta: null, p2_rating_delta: null,
  next_die: 4, last_move_at: new Date().toISOString(), modifier: 'classic',
  season_id: 1, format: 'standard', protocol_version: 1, rune_rules_version: null,
  pool_tier: 'stone', phase: 'playing', trial_offer: null,
  p1_rune: null, p2_rune: null, selection_deadline: null, selection_version: 0,
  action_version: 0, pending_aim: null,
  ...overrides,
});

export const trialMatch = (overrides: Partial<MatchRow> = {}): MatchRow => standardMatch({
  format: 'rune_trial', protocol_version: 2, rune_rules_version: 1,
  p1_rune: 'ward', p2_rune: 'nudge', pool_tier: 'ivory',
  ...overrides,
});

/** Play deterministic first-legal-column moves until one more move would end
    the game; that final move is the caller's terminal probe. */
export function buildTerminalLog(seed: string, mode: Mode): {
  rows: MoveRow[]; finalCol: number; finalWho: 0 | 1;
} {
  const rows: MoveRow[] = [];
  for (let guard = 0; guard < 200; guard++) {
    const state = rebuild(seed, rows, mode);
    if (!state || state.over) throw new Error('terminal log fixture went incoherent');
    const col = legalCols(state.st[state.turn])[0];
    const next = rebuild(seed, [...rows, { idx: rows.length, who: state.turn, col }], mode);
    if (!next) throw new Error('terminal log fixture placed an illegal move');
    if (next.over) return { rows, finalCol: col, finalWho: state.turn };
    rows.push({ idx: rows.length, who: state.turn, col });
  }
  throw new Error('terminal log fixture never terminated');
}
