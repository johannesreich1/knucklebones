// Last server-confirmed ranked-progression contract. Kept eager and transport-
// free so offline setup can show the same durable outcome locks without
// importing Supabase. Unknown/tampered state fails closed to the v1 STONE set.
import { rankedOutcomeById } from './core/ranked-outcomes.ts';

export const PROGRESSION_STATUS_CACHE_KEY = 'knucklebones.progression.v1';
export const PROGRESSION_STATUS_CACHE_VERSION = 1 as const;
export const RANKED_CURVE_CACHE_KEY = 'knucklebones.ranked-curve.v1';
export const RANKED_CURVE_CACHE_VERSION = 1 as const;
export type LadderCurveVersion = 1 | 2;
export type LadderScoringVersion = 1 | 2;
export type RankedEntryKind = 'ordinary' | 'weekly';

export interface WeeklyChallengeSnapshot {
  readonly rotationId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly modifier: string;
  readonly completed: boolean;
}

export interface ProgressionStatusSnapshot {
  readonly version: typeof PROGRESSION_STATUS_CACHE_VERSION;
  readonly accountId: string;
  readonly confirmedAt: number;
  readonly curveVersion: LadderCurveVersion;
  readonly scoringVersion: LadderScoringVersion;
  readonly admissionPaused: boolean;
  readonly outcomes: readonly string[];
  readonly weeklyUnlocked: boolean;
  readonly pendingBotDebuts: readonly string[];
  readonly neonMedalSeasons: readonly number[];
  readonly weekly: WeeklyChallengeSnapshot | null;
}

export interface RankedCurveSnapshot {
  readonly version: typeof RANKED_CURVE_CACHE_VERSION;
  readonly confirmedAt: number;
  readonly curveVersion: LadderCurveVersion;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Listener = (snapshot: ProgressionStatusSnapshot | null) => void;
const listeners = new Set<Listener>();

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

function outcomeIds(value: unknown, requireClassic = true): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const valueId of value) {
    if (typeof valueId !== 'string') return null;
    try { rankedOutcomeById(valueId); } catch { return null; }
    if (seen.has(valueId)) return null;
    seen.add(valueId);
    ids.push(valueId);
  }
  return !requireClassic || ids.includes('classic') ? ids : null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Parse the server/cache weekly shape once. A rotation is a half-open,
 * exactly-seven-day contract; accepting an inverted or shortened window would
 * let a stale/malformed snapshot become an entry mode the authority never
 * offered. */
export function weeklyChallengeSnapshot(
  value: unknown,
): WeeklyChallengeSnapshot | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const rotationId = row.rotationId ?? row.rotation_id;
  const startsAt = row.startsAt ?? row.starts_at;
  const endsAt = row.endsAt ?? row.ends_at;
  const starts = typeof startsAt === 'string' ? Date.parse(startsAt) : NaN;
  const ends = typeof endsAt === 'string' ? Date.parse(endsAt) : NaN;
  if (typeof rotationId !== 'string' || !rotationId.length
      || typeof startsAt !== 'string' || !Number.isFinite(starts)
      || typeof endsAt !== 'string' || !Number.isFinite(ends)
      || ends - starts !== WEEK_MS
      || typeof row.modifier !== 'string'
      || typeof row.completed !== 'boolean') return undefined;
  try {
    const outcome = rankedOutcomeById(row.modifier);
    if (outcome.format !== 'standard') return undefined;
  } catch { return undefined; }
  return Object.freeze({
    rotationId,
    startsAt,
    endsAt,
    modifier: row.modifier,
    completed: row.completed,
  });
}

interface WeeklyProgressionSnapshot {
  readonly weeklyUnlocked: boolean;
  readonly weekly: WeeklyChallengeSnapshot | null;
}

/** The one entry/presentation check used by Home, matchmaking and replay.
 * Weekly windows are half-open: the old mode stops being active exactly when
 * Monday's replacement starts. */
export function activeWeeklyChallenge(
  snapshot: WeeklyProgressionSnapshot | null | undefined,
  now: number = Date.now(),
): WeeklyChallengeSnapshot | null {
  if (!snapshot?.weeklyUnlocked || !snapshot.weekly || !Number.isFinite(now)) return null;
  const challenge = weeklyChallengeSnapshot(snapshot.weekly);
  if (!challenge) return null;
  const starts = Date.parse(challenge.startsAt);
  const ends = Date.parse(challenge.endsAt);
  return starts <= now && now < ends ? challenge : null;
}

function orderedSeasonIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids: number[] = [];
  for (const seasonId of value) {
    if (!Number.isSafeInteger(seasonId) || (seasonId as number) <= 0
        || ids.includes(seasonId as number)) return null;
    ids.push(seasonId as number);
  }
  return ids.every((seasonId, index) => index === 0 || ids[index - 1] < seasonId)
    ? ids
    : null;
}

function parseCurve(value: unknown): RankedCurveSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== RANKED_CURVE_CACHE_VERSION
      || !Number.isSafeInteger(row.confirmedAt) || (row.confirmedAt as number) < 0
      || (row.curveVersion !== 1 && row.curveVersion !== 2)) return null;
  return Object.freeze({
    version: RANKED_CURVE_CACHE_VERSION,
    confirmedAt: row.confirmedAt as number,
    curveVersion: row.curveVersion,
  });
}

function parse(value: unknown): ProgressionStatusSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const outcomes = outcomeIds(row.outcomes);
  const pending = outcomeIds(row.pendingBotDebuts ?? [], false);
  const neonMedalSeasons = orderedSeasonIds(row.neonMedalSeasons);
  const challenge = weeklyChallengeSnapshot(row.weekly);
  if (row.version !== PROGRESSION_STATUS_CACHE_VERSION
      || typeof row.accountId !== 'string' || !UUID.test(row.accountId)
      || !Number.isSafeInteger(row.confirmedAt) || (row.confirmedAt as number) < 0
      || (row.curveVersion !== 1 && row.curveVersion !== 2)
      || (row.scoringVersion !== 1 && row.scoringVersion !== 2)
      || row.scoringVersion !== row.curveVersion
      || typeof row.admissionPaused !== 'boolean'
      || typeof row.weeklyUnlocked !== 'boolean'
      || !outcomes || !pending || !neonMedalSeasons || challenge === undefined) return null;
  if (!row.weeklyUnlocked && challenge !== null) return null;
  return Object.freeze({
    version: PROGRESSION_STATUS_CACHE_VERSION,
    accountId: row.accountId.toLowerCase(),
    confirmedAt: row.confirmedAt as number,
    curveVersion: row.curveVersion,
    scoringVersion: row.scoringVersion,
    admissionPaused: row.admissionPaused,
    outcomes: Object.freeze(outcomes),
    weeklyUnlocked: row.weeklyUnlocked,
    pendingBotDebuts: Object.freeze(pending),
    neonMedalSeasons: Object.freeze(neonMedalSeasons),
    weekly: challenge,
  });
}

export function readProgressionStatusSnapshot(): ProgressionStatusSnapshot | null {
  const store = storage();
  if (!store) return null;
  try { return parse(JSON.parse(store.getItem(PROGRESSION_STATUS_CACHE_KEY) ?? 'null')); }
  catch { return null; }
}

export function readRankedCurveSnapshot(): RankedCurveSnapshot | null {
  const store = storage();
  if (!store) return null;
  try { return parseCurve(JSON.parse(store.getItem(RANKED_CURVE_CACHE_KEY) ?? 'null')); }
  catch { return null; }
}

/** A genuinely persisted server answer, unlike the presentation-safe v1
 * default below. Rollout reads use this distinction to keep a transient error
 * from classifying newly mapped points with speculative v1 floors. */
export function cachedLadderCurveVersion(): LadderCurveVersion | null {
  return readRankedCurveSnapshot()?.curveVersion
    ?? readProgressionStatusSnapshot()?.curveVersion
    ?? null;
}

/** The server-owned curve contract. An absent or unreadable cache answers v2,
 * because v2 is the only curve that exists: production activated it 2026-09-04
 * and the activation is irreversible. This used to answer v1 so that offline
 * presentation never rendered v2 points or unlocks speculatively — sound while
 * v1 could still be live, and wrong the moment it could not, because there is
 * nothing left to be cautious ON BEHALF OF. It reached a player: someone who
 * never creates an account never authenticates at boot (boot.ts returns before
 * the verification) and never enters ranked (which would confirm it), so
 * nothing ever confirms the curve and their offline mode picker offered Limited
 * — a GOLD unlock under v2 — while withholding Bounty, which STONE grants. A
 * genuinely cached v1 still reads v1; only the ABSENCE of a cache changed
 * meaning, and signed-out boot still makes no request. */
export function confirmedLadderCurveVersion(): LadderCurveVersion {
  return cachedLadderCurveVersion() ?? 2;
}

/** Public ladder points survive sign-out independently from account-owned
 * outcomes. This lets offline boot classify an already-confirmed v2 rating
 * while a fresh device still fails closed to v1. */
export function cacheConfirmedLadderCurveVersion(
  curveVersion: LadderCurveVersion,
  confirmedAt: number = Date.now(),
  announce = true,
): boolean {
  const value = parseCurve({
    version: RANKED_CURVE_CACHE_VERSION,
    confirmedAt,
    curveVersion,
  });
  const store = storage();
  if (!value || !store) return false;
  const previous = readRankedCurveSnapshot()?.curveVersion;
  try { store.setItem(RANKED_CURVE_CACHE_KEY, JSON.stringify(value)); }
  catch { return false; }
  if (announce && previous !== curveVersion) {
    const account = readProgressionStatusSnapshot();
    listeners.forEach((listener) => listener(account));
  }
  return true;
}

/** Per-outcome access is authoritative only for the same account under the v2
 * contract. The caller supplies its active eager-cache account id so a stale
 * signed-out/account-switched snapshot cannot unlock offline choices. */
export function confirmedRankedOutcomeEntitlements(
  accountId: string | null | undefined,
): readonly string[] | null {
  if (typeof accountId !== 'string' || !UUID.test(accountId)) return null;
  const snapshot = readProgressionStatusSnapshot();
  return snapshot?.curveVersion === 2 && snapshot.accountId === accountId.toLowerCase()
    ? snapshot.outcomes
    : null;
}

export function writeProgressionStatusSnapshot(
  snapshot: Omit<ProgressionStatusSnapshot, 'version' | 'confirmedAt'>,
  confirmedAt: number = Date.now(),
): boolean {
  const value = parse({ ...snapshot, version: PROGRESSION_STATUS_CACHE_VERSION, confirmedAt });
  const store = storage();
  if (!value || !store) return false;
  /* Public curve first: if account storage fails, presentation is still on the
     correct floors and exact entitlements remain absent/fail closed. */
  if (!cacheConfirmedLadderCurveVersion(value.curveVersion, confirmedAt, false)) return false;
  try { store.setItem(PROGRESSION_STATUS_CACHE_KEY, JSON.stringify(value)); }
  catch { return false; }
  listeners.forEach((listener) => listener(value));
  return true;
}

export function clearProgressionStatusSnapshot(accountId?: string): boolean {
  const store = storage();
  if (!store) return false;
  if (accountId) {
    const current = readProgressionStatusSnapshot();
    if (!current || current.accountId !== accountId.toLowerCase()) return false;
  }
  try { store.removeItem(PROGRESSION_STATUS_CACHE_KEY); }
  catch { return false; }
  listeners.forEach((listener) => listener(null));
  return true;
}

export function subscribeProgressionStatus(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
