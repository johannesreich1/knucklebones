import type { EdgeClient } from "./http.ts";
import type { LadderRow, MatchRow } from "./types.ts";

export type SettlementScore = 0 | 0.5 | 1;

export interface SettledRows {
  da: number;
  db: number;
  aDelta?: { base: number; finish: number; total: number };
  bDelta?: { base: number; finish: number; total: number };
  a: LadderRow;
  b: LadderRow;
}

export type LadderSettlement = (
  p1: LadderRow,
  p2: LadderRow,
  p1Result: SettlementScore,
  options?: { finish?: { kind: "normal"; aScore: number; bScore: number } | { kind: "forced" } },
) => SettledRows;

export interface TerminalMatch {
  status: "done" | "forfeit";
  winner: string | null;
  p1Score: number;
  p2Score: number;
  p1Result: SettlementScore;
}

export interface SettlementResult {
  applied: boolean;
  match: MatchRow;
  reward?: { rune_id: string; newly_collected: boolean };
}

export interface SettlementPrecondition {
  turn: 0 | 1;
  lastMoveAt: string;
  moveCount: number;
}

const LADDER_COLUMNS = "points, peak, wins, losses, draws";
export const SERIALIZATION_FAILURE = "40001";
const MAX_ATTEMPTS = 3;

function errorMessage(error: { message?: string } | null | undefined): string {
  return error?.message ?? "unknown database error";
}

/** Sentinel an attempt returns when a fresh snapshot may still win. */
export const RETRY_SETTLEMENT: unique symbol = Symbol("retry-settlement");

/**
 * Run one optimistic settlement attempt up to three times. The attempt
 * returns RETRY_SETTLEMENT when PostgreSQL reported a serialization failure
 * (40001) and it is not the final try; each call recomputes its snapshot from
 * fresh reads. The final attempt maps the database error itself, so genuine
 * exhaustion surfaces the database message rather than this generic one.
 */
export async function retryOnSerialization<T>(
  attempt: (isFinal: boolean) => Promise<T | typeof RETRY_SETTLEMENT>,
  exhausted: string,
): Promise<T> {
  for (let index = 1; index <= MAX_ATTEMPTS; index++) {
    const result = await attempt(index === MAX_ATTEMPTS);
    if (result !== RETRY_SETTLEMENT) return result;
  }
  throw new Error(exhausted);
}

/** The exact terminal fields every settlement RPC compare-and-sets. */
export interface SettlementSnapshot {
  status: "done" | "forfeit";
  winner: string | null;
  p1_score: number;
  p2_score: number;
  p1_delta: number;
  p2_delta: number;
  expected_p1: LadderRow;
  expected_p2: LadderRow;
  next_p1: LadderRow & SettlementMetadata;
  next_p2: LadderRow & SettlementMetadata;
}

interface SettlementMetadata {
  _scoring_version: 1 | 2;
  _base_rating_delta: number;
  _finish_rating_delta: number;
}

/**
 * Load both ladder snapshots for the match's season and compute the terminal
 * payload in shared TypeScript. Every terminal writer — move command, action
 * command, and direct settlement — builds this identical shape once per
 * serialization attempt.
 */
export async function buildSettlementSnapshot(
  service: EdgeClient,
  match: MatchRow,
  terminal: TerminalMatch,
  calculate: LadderSettlement,
): Promise<SettlementSnapshot> {
  const season = match.season_id ?? 1;
  const [p1, p2] = await Promise.all([
    loadLadderRow(service, season, match.p1),
    loadLadderRow(service, season, match.p2),
  ]);
  const scoringVersion = match.scoring_version ?? 1;
  const finish = scoringVersion === 2
    ? (terminal.status === "done"
      ? { kind: "normal" as const, aScore: terminal.p1Score, bScore: terminal.p2Score }
      : { kind: "forced" as const })
    : undefined;
  const next = calculate(p1, p2, terminal.p1Result, finish ? { finish } : undefined);
  const p1Components = next.aDelta ?? { base: next.da, finish: 0, total: next.da };
  const p2Components = next.bDelta ?? { base: next.db, finish: 0, total: next.db };
  if (p1Components.total !== next.da || p2Components.total !== next.db) {
    throw new Error("ladder settlement component totals do not match signed deltas");
  }
  return {
    status: terminal.status,
    winner: terminal.winner,
    p1_score: terminal.p1Score,
    p2_score: terminal.p2Score,
    p1_delta: next.da,
    p2_delta: next.db,
    expected_p1: p1,
    expected_p2: p2,
    next_p1: {
      ...next.a,
      _scoring_version: scoringVersion,
      _base_rating_delta: p1Components.base,
      _finish_rating_delta: p1Components.finish,
    },
    next_p2: {
      ...next.b,
      _scoring_version: scoringVersion,
      _base_rating_delta: p2Components.base,
      _finish_rating_delta: p2Components.finish,
    },
  };
}

/** Read the exact ladder snapshot that the database RPC will compare-and-set. */
export async function loadLadderRow(
  service: EdgeClient,
  season: number,
  player: string,
): Promise<LadderRow> {
  const { error: upsertError } = await service.from("season_ratings").upsert(
    { season_id: season, player },
    { onConflict: "season_id,player", ignoreDuplicates: true },
  );
  if (upsertError) {
    throw new Error(`ladder row creation failed for ${player}: ${errorMessage(upsertError)}`);
  }

  const { data, error } = await service.from("season_ratings")
    .select(LADDER_COLUMNS)
    .eq("season_id", season)
    .eq("player", player)
    .maybeSingle();
  if (error) throw new Error(`ladder read failed for ${player}: ${errorMessage(error)}`);
  if (!data) throw new Error(`no ladder row for ${player} in season ${season} after upsert`);
  return data as LadderRow;
}

function payload(value: unknown): SettlementResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { applied?: unknown; match?: unknown };
  if (typeof candidate.applied !== "boolean"
    || !candidate.match || typeof candidate.match !== "object" || Array.isArray(candidate.match)) {
    return null;
  }
  const match = candidate.match as Partial<MatchRow>;
  if (typeof match.id !== "string") return null;
  if (match.scoring_version === 2
    && (!Number.isInteger(match.p1_rating_delta)
      || !Number.isInteger(match.p2_rating_delta)
      || !Number.isInteger(match.p1_base_rating_delta)
      || !Number.isInteger(match.p2_base_rating_delta)
      || !Number.isInteger(match.p1_finish_rating_delta)
      || !Number.isInteger(match.p2_finish_rating_delta)
      || match.p1_rating_delta !== match.p1_base_rating_delta! + match.p1_finish_rating_delta!
      || match.p2_rating_delta !== match.p2_base_rating_delta! + match.p2_finish_rating_delta!
      || match.p1_finish_rating_delta !== -match.p2_finish_rating_delta!
      || Math.abs(match.p1_finish_rating_delta!) > 7)) return null;
  const reward = (value as { reward?: unknown }).reward;
  if (reward !== undefined) {
    if (!reward || typeof reward !== "object" || Array.isArray(reward)
        || typeof (reward as { rune_id?: unknown }).rune_id !== "string"
        || typeof (reward as { newly_collected?: unknown }).newly_collected !== "boolean") return null;
  }
  return {
    applied: candidate.applied,
    match: match as MatchRow,
    ...(reward === undefined ? {} : {
      reward: reward as { rune_id: string; newly_collected: boolean },
    }),
  };
}

/**
 * Compute ladder arithmetic in shared TypeScript, then atomically persist the
 * terminal match and both ladder/profile mirrors through settle_match(). A
 * concurrent match involving either player may change a ladder snapshot; in
 * that case PostgreSQL reports 40001 and the short operation reloads and
 * recomputes. A racing finisher of this same match returns applied=false and
 * the already-terminal row without paying it twice.
 */
export async function settleMatch(
  service: EdgeClient,
  match: MatchRow,
  terminal: TerminalMatch,
  calculate: LadderSettlement,
  precondition?: SettlementPrecondition,
): Promise<SettlementResult> {
  return retryOnSerialization(async (isFinal) => {
    const snapshot = await buildSettlementSnapshot(service, match, terminal, calculate);
    // The RPC parameter names are exactly the snapshot fields, p_-prefixed.
    const settlement = {
      p_match_id: match.id,
      ...Object.fromEntries(
        Object.entries(snapshot).map(([field, value]) => [`p_${field}`, value]),
      ),
    };
    const { data, error } = precondition
      ? await service.rpc("settle_match_checked", {
        p_expected_turn: precondition.turn,
        p_expected_last_move_at: precondition.lastMoveAt,
        p_expected_move_count: precondition.moveCount,
        ...settlement,
      })
      : await service.rpc("settle_match", settlement);
    if (error?.code === SERIALIZATION_FAILURE && !isFinal) return RETRY_SETTLEMENT;
    if (error) throw new Error(`atomic settlement failed: ${errorMessage(error)}`);
    const result = payload(data);
    if (!result) throw new Error("atomic settlement returned an invalid payload");
    return result;
  }, "atomic settlement retry budget exhausted");
}
