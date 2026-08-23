import type { EdgeClient } from "./http.ts";
import type { LadderRow, MatchRow } from "./types.ts";

export type SettlementScore = 0 | 0.5 | 1;

export interface SettledRows {
  da: number;
  db: number;
  a: LadderRow;
  b: LadderRow;
}

export type LadderSettlement = (
  p1: LadderRow,
  p2: LadderRow,
  p1Result: SettlementScore,
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
}

const LADDER_COLUMNS = "points, peak, wins, losses, draws";
const SERIALIZATION_FAILURE = "40001";
const MAX_ATTEMPTS = 3;

function errorMessage(error: { message?: string } | null | undefined): string {
  return error?.message ?? "unknown database error";
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
  return typeof match.id === "string"
    ? { applied: candidate.applied, match: match as MatchRow }
    : null;
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
): Promise<SettlementResult> {
  const season = match.season_id ?? 1;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const [p1, p2] = await Promise.all([
      loadLadderRow(service, season, match.p1),
      loadLadderRow(service, season, match.p2),
    ]);
    const next = calculate(p1, p2, terminal.p1Result);
    const { data, error } = await service.rpc("settle_match", {
      p_match_id: match.id,
      p_status: terminal.status,
      p_winner: terminal.winner,
      p_p1_score: terminal.p1Score,
      p_p2_score: terminal.p2Score,
      p_p1_delta: next.da,
      p_p2_delta: next.db,
      p_expected_p1: p1,
      p_expected_p2: p2,
      p_next_p1: next.a,
      p_next_p2: next.b,
    });
    if (error?.code === SERIALIZATION_FAILURE && attempt < MAX_ATTEMPTS) continue;
    if (error) throw new Error(`atomic settlement failed: ${errorMessage(error)}`);
    const result = payload(data);
    if (!result) throw new Error("atomic settlement returned an invalid payload");
    return result;
  }
  throw new Error("atomic settlement retry budget exhausted");
}
