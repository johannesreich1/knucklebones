// Read-only seasonal ladder boundaries. Opponent-facing data comes through
// narrow RPCs because raw profile and season rows remain own-row only.
import { groupsForCurve, type LadderCurveVersion } from '../../core/ladder.ts';
import {
  cacheConfirmedLadderCurveVersion,
  cachedLadderCurveVersion,
} from '../../progression-status-cache.ts';
import { isMissingPostgrestRpc } from './postgrest-compat.ts';
import { supa } from './client.ts';
import { currentUser } from '../identity/session.ts';

export function rankedCurveVersionFromRpc(
  data: unknown,
  error: unknown,
  cached: LadderCurveVersion | null,
): LadderCurveVersion | null {
  const value = Array.isArray(data) ? data[0] : data;
  if (!error) return value === 1 || value === 2 ? value : null;
  /* Once v2 is known, never downgrade it. Before that, only the exact absence
     of this additive RPC proves an old v1 deployment. A transient error or a
     malformed scalar cannot safely classify potentially remapped rows. */
  if (cached === 2) return 2;
  return isMissingPostgrestRpc(error, 'active_ranked_curve_version') ? 1 : null;
}

/** Public rollout scalar. Null means the server's curve is currently unknown,
 * so callers keep points behind their loading/error surface. */
export async function activeRankedCurveVersion(): Promise<LadderCurveVersion | null> {
  const { data, error } = await supa().rpc('active_ranked_curve_version');
  const value = rankedCurveVersionFromRpc(data, error, cachedLadderCurveVersion());
  if (value !== null) cacheConfirmedLadderCurveVersion(value);
  return value;
}

export interface Standing {
  points: number;
  rank: number;
  population: number;
  percentile: number;
}

export async function myStanding(): Promise<Standing | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await supa().rpc('player_standing', { p: user.id });
  const row = Array.isArray(data) ? data[0] : data;
  return row ? {
    points: row.points,
    rank: Number(row.rank),
    population: Number(row.population),
    percentile: Number(row.percentile),
  } : null;
}

export interface Ladder {
  points: number;
  peak: number;
  wins: number;
  losses: number;
  draws: number;
  /** Permanent equipment access is an all-season achievement, not a reading
      of the current season's carried peak. */
  runeSeatUnlocked: boolean;
}

export async function myLadder(
  knownCurveVersion?: LadderCurveVersion,
): Promise<Ladder | null> {
  const user = await currentUser();
  if (!user) return null;
  const [{ data: season }, curveVersion] = await Promise.all([
    supa().rpc('current_season'),
    knownCurveVersion ?? activeRankedCurveVersion(),
  ]);
  if (curveVersion === null) return null;
  const silverFloor = groupsForCurve(curveVersion)
    .find(({ id }) => id === 'silver')!.floor;
  const equipmentUnlock = curveVersion === 2
    ? supa().from('player_ranked_features')
      .select('feature_id').eq('player_id', user.id)
      .eq('feature_id', 'equipped_runes').limit(1)
    : supa().from('season_ratings')
      .select('peak').eq('player', user.id).gte('peak', silverFloor).limit(1);
  const [currentResult, equipmentResult] = await Promise.all([
    supa().from('season_ratings')
      .select('points, peak, wins, losses, draws')
      .eq('season_id', season).eq('player', user.id).maybeSingle(),
    equipmentUnlock,
  ]);
  const data = currentResult.data;
  /* V1 proves the milestone from any historical peak. V2 owns it as an
     explicit durable feature, including a low-points positional-NEON catch-up
     where raw points cannot prove every lower entitlement granted. */
  const runeSeatUnlocked = (equipmentResult.data?.length ?? 0) > 0;
  // A season row is created at the first pairing; no row is an honest zero.
  return {
    ...(data ?? { points: 0, peak: 0, wins: 0, losses: 0, draws: 0 }),
    runeSeatUnlocked,
  };
}

export async function bestStreak(): Promise<number> {
  const { data } = await supa().rpc('best_streak');
  return Number(data ?? 0);
}

export interface HistoryRow {
  id: string;
  when: string;
  opponent: string;
  mode: string;
  mine: number;
  theirs: number;
  delta: number;
  baseDelta: number | null;
  finishDelta: number | null;
  scoringVersion: number;
  result: 'win' | 'loss' | 'draw';
}

export interface HistoryCursor { when: string; id: string }

export function historyPageArgs(limit = 40, before?: HistoryCursor): Record<string, unknown> {
  const args: Record<string, unknown> = { limit_n: limit };
  if (before) {
    args.before_t = before.when;
    args.before_id = before.id;
  }
  return args;
}

export async function matchHistory(limit = 40, before?: HistoryCursor): Promise<HistoryRow[]> {
  /* Stable keyset ordering is `(finished_at, id)`. Passing only the timestamp
     can skip rows when several matches settle in the same database instant. */
  const { data } = await supa().rpc('match_history', historyPageArgs(limit, before));
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    when: String(row.finished_at ?? ''),
    opponent: String(row.opponent ?? '???'),
    mode: String(row.mode ?? 'classic'),
    mine: Number(row.mine ?? 0),
    theirs: Number(row.theirs ?? 0),
    delta: Number(row.delta ?? 0),
    baseDelta: row.base_delta == null ? null : Number(row.base_delta),
    finishDelta: row.finish_delta == null ? null : Number(row.finish_delta),
    scoringVersion: Number(row.scoring_version ?? 1),
    result: row.result as HistoryRow['result'],
  }));
}

/* One screen, one word: the client says LADDER everywhere. The SQL functions
   below are still named `leaderboard`/`leaderboard_before` — those are the
   deployed RPC contract and renaming them is a migration, not a refactor — so
   the string literals are the only place the old word survives. */
export interface LadderRow {
  nickname: string;
  points: number;
  wins: number;
  losses: number;
  games: number;
  rank: number;
  /* A DENSE ordinal, 1-based, added by 20260827203007. rank() gaps after ties
     and leaderboard_before's cursor enters a tie group part-way, so rank can
     never be turned into a position — see the migration's header. Older
     deployments answer without it, so it is optional and the caller falls back
     to counting from a cursor. */
  pos?: number;
  /** Rows on the whole board. The ladder is public, so player_standing — which
      needs a uuid — cannot be the source of this for a signed-out reader. */
  population?: number;
  apex: boolean;
  avatar: string | null;
  peak: number;
}

export function ladderPageArgs(
  limit = 50,
  fromRank = 1,
  afterNickname?: string,
  fromPos?: number,
): Record<string, number | string> {
  /* from_pos is the RANDOM entry point — what a dragged thumb produces — and it
     replaces the rank cursor rather than joining it: the RPC branches on which
     one is present, so sending both would be sending two different questions. */
  if (fromPos !== undefined) return { limit_n: limit, from_pos: fromPos };
  const args: Record<string, number | string> = { limit_n: limit, from_rank: fromRank };
  if (afterNickname) args.after_nickname = afterNickname;
  return args;
}

export function ladderPageBeforeArgs(
  limit = 50,
  beforeRank = 1,
  beforeNickname = '',
): Record<string, number | string> {
  return {
    limit_n: limit,
    before_rank: beforeRank,
    before_nickname: beforeNickname,
  };
}

export async function ladderPage(
  limit = 50,
  fromRank = 1,
  afterNickname?: string,
  fromPos?: number,
): Promise<LadderRow[]> {
  const { data } = await supa().rpc(
    'leaderboard',
    ladderPageArgs(limit, fromRank, afterNickname, fromPos),
  );
  return (data as LadderRow[]) ?? [];
}

export async function ladderPageBefore(
  limit = 50,
  beforeRank = 1,
  beforeNickname = '',
): Promise<LadderRow[]> {
  const { data } = await supa().rpc(
    'leaderboard_before',
    ladderPageBeforeArgs(limit, beforeRank, beforeNickname),
  );
  return (data as LadderRow[]) ?? [];
}

export interface PlayerCard {
  streak: number;
  since: string | null;
  points: number | null;
  wins: number | null;
  losses: number | null;
  games: number | null;
  rank: number | null;
  apex: boolean;
  peak: number | null;
}

export async function playerCard(nickname: string): Promise<PlayerCard | null> {
  const { data } = await supa().rpc('player_card', { nick: nickname });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const numberOrNull = (value: unknown): number | null => value == null ? null : Number(value);
  return {
    streak: Number(row.streak ?? 0),
    since: row.since ?? null,
    points: numberOrNull(row.points),
    wins: numberOrNull(row.wins),
    losses: numberOrNull(row.losses),
    games: numberOrNull(row.games),
    rank: numberOrNull(row.rank),
    apex: !!row.apex,
    peak: numberOrNull(row.peak),
  };
}
