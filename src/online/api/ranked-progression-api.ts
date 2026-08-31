// Owner-only transport for the settlement event that drives the ranked
// result's group-transition deck. The database stores points + positional
// apex truth; the shared ladder registry remains the one group classifier.
import { boardGroup } from '../../core/ladder.ts';
import { rankedPoolTierById, type RankedPoolTier } from '../../core/ranked-outcomes.ts';
import { spellById } from '../../core/spells.ts';
import type { LadderGroupId } from '../../i18n/display.ts';
import { supa } from './client.ts';

export interface GroupTransitionEvent {
  readonly eventId: string;
  readonly matchId: string;
  readonly beforePoints: number;
  readonly afterPoints: number;
  readonly beforeGroup: LadderGroupId;
  readonly afterGroup: LadderGroupId;
  readonly beforePoolTier: RankedPoolTier;
  readonly afterPoolTier: RankedPoolTier;
  /** Concrete fallback for both a fixed seat and RANDOM RUNE MODE. */
  readonly equippedRune: string | null;
  readonly randomRuneMode: boolean;
  /** Whether this player had ever reached SILVER on either side of settlement. */
  readonly runeSeatUnlockedBefore: boolean;
  readonly runeSeatUnlockedAfter: boolean;
  readonly seenAt: string | null;
}

export type ProgressionLookup =
  | { readonly kind: 'event'; readonly event: GroupTransitionEvent }
  | { readonly kind: 'absent' }
  | { readonly kind: 'retryable' };

export interface RankedProgressionTransportResult {
  readonly data: unknown;
  readonly error: unknown | null;
}

export interface RankedProgressionRecoveryPorts {
  readForMatch(matchId: string): Promise<RankedProgressionTransportResult>;
  /** RLS owns identity; this lookup deliberately has no player-id argument. */
  readUnseen(): Promise<RankedProgressionTransportResult>;
  acknowledge(eventId: string): Promise<RankedProgressionTransportResult>;
}

export interface RankedProgressionRecovery {
  preload(matchId: string): Promise<ProgressionLookup>;
  recover(matchId: string, preloaded: ProgressionLookup): Promise<ProgressionLookup>;
  acknowledge(eventId: string): Promise<boolean>;
}

const FIELDS = [
  'id',
  'source_match_id',
  'points_before',
  'points_after',
  'apex_before',
  'apex_after',
  'pool_tier_before',
  'pool_tier_after',
  'equipped_rune_before',
  'equipped_rune_after',
  'random_rune_mode_before',
  'random_rune_mode_after',
  'rune_seat_active_before',
  'rune_seat_active_after',
  'seen_at',
].join(', ');

function poolTier(value: unknown): RankedPoolTier | null {
  try {
    return rankedPoolTierById(value).id;
  } catch {
    return null;
  }
}

const ABSENT: ProgressionLookup = Object.freeze({ kind: 'absent' });
const RETRYABLE: ProgressionLookup = Object.freeze({ kind: 'retryable' });
const TIMED_OUT = Symbol('ranked-progression-timeout');

async function within<T>(promise: Promise<T>, deadlineMs: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), deadlineMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function lookupFromTransport(result: RankedProgressionTransportResult): ProgressionLookup {
  if (result.error) return RETRYABLE;
  const row = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
  if (row === null) return ABSENT;
  const event = rankedProgressionFromRow(row);
  return event ? { kind: 'event', event } : RETRYABLE;
}

/** Normalize an untyped PostgREST row and reject partial-rollout/malformed data. */
export function rankedProgressionFromRow(value: unknown): GroupTransitionEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id.length
      || typeof row.source_match_id !== 'string' || !row.source_match_id.length
      || !Number.isInteger(row.points_before) || (row.points_before as number) < 0
      || !Number.isInteger(row.points_after) || (row.points_after as number) < 0
      || typeof row.apex_before !== 'boolean' || typeof row.apex_after !== 'boolean'
      || typeof row.random_rune_mode_before !== 'boolean'
      || typeof row.random_rune_mode_after !== 'boolean'
      || typeof row.rune_seat_active_before !== 'boolean'
      || typeof row.rune_seat_active_after !== 'boolean'
      || (row.seen_at !== null && typeof row.seen_at !== 'string')) return null;
  const beforePoolTier = poolTier(row.pool_tier_before);
  const afterPoolTier = poolTier(row.pool_tier_after);
  if (!beforePoolTier || !afterPoolTier) return null;
  const equippedBefore = row.equipped_rune_before;
  const equippedAfter = row.equipped_rune_after;
  for (const equipped of [equippedBefore, equippedAfter]) {
    if (equipped !== null
        && (typeof equipped !== 'string' || !spellById(equipped))) return null;
  }
  if ((row.random_rune_mode_before && equippedBefore === null)
      || (row.random_rune_mode_after && equippedAfter === null)) return null;
  const beforePoints = row.points_before as number;
  const afterPoints = row.points_after as number;
  return {
    eventId: row.id,
    matchId: row.source_match_id,
    beforePoints,
    afterPoints,
    beforeGroup: boardGroup(beforePoints, row.apex_before).id as LadderGroupId,
    afterGroup: boardGroup(afterPoints, row.apex_after).id as LadderGroupId,
    beforePoolTier,
    afterPoolTier,
    equippedRune: equippedAfter as string | null,
    randomRuneMode: row.random_rune_mode_after,
    runeSeatUnlockedBefore: row.rune_seat_active_before,
    runeSeatUnlockedAfter: row.rune_seat_active_after,
    seenAt: row.seen_at as string | null,
  };
}

/**
 * Keep transport uncertainty distinct from a successful zero-row lookup.
 * The injected seam makes the durability policy independently testable while
 * production ports below remain the only place that knows PostgREST.
 */
export function createRankedProgressionRecovery(
  ports: RankedProgressionRecoveryPorts,
  options: { readonly deadlineMs?: number } = {},
): RankedProgressionRecovery {
  const deadlineMs = Math.max(1, options.deadlineMs ?? 2600);
  const read = async (
    operation: () => Promise<RankedProgressionTransportResult>,
  ): Promise<ProgressionLookup> => {
    try {
      const result = await within(operation(), deadlineMs);
      return result === TIMED_OUT ? RETRYABLE : lookupFromTransport(result);
    } catch {
      return RETRYABLE;
    }
  };

  return {
    preload(matchId): Promise<ProgressionLookup> {
      return matchId ? read(() => ports.readForMatch(matchId)) : Promise.resolve(ABSENT);
    },
    async recover(matchId, preloaded): Promise<ProgressionLookup> {
      if (preloaded.kind === 'event') return preloaded;
      if (preloaded.kind === 'retryable' && matchId) {
        const retried = await read(() => ports.readForMatch(matchId));
        if (retried.kind === 'event') return retried;
      }
      return read(ports.readUnseen);
    },
    async acknowledge(eventId): Promise<boolean> {
      if (!eventId) return false;
      try {
        const result = await within(ports.acknowledge(eventId), deadlineMs);
        return result !== TIMED_OUT && !result.error && result.data === true;
      } catch {
        return false;
      }
    },
  };
}

const productionPorts: RankedProgressionRecoveryPorts = {
  async readForMatch(matchId) {
    return supa().from('ranked_progression_events')
      .select(FIELDS)
      .eq('source_match_id', matchId)
      .is('seen_at', null)
      .maybeSingle();
  },
  async readUnseen() {
    return supa().from('ranked_progression_events')
      .select(FIELDS)
      .is('seen_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
  },
  async acknowledge(eventId) {
    return supa().rpc('acknowledge_ranked_progression', { p_event_id: eventId });
  },
};

export const rankedProgressionRecovery = createRankedProgressionRecovery(productionPorts);

/** Load this signed-in player's unseen event for one terminal match. */
export async function rankedProgressionForMatch(
  matchId: string,
): Promise<GroupTransitionEvent | null> {
  const lookup = await rankedProgressionRecovery.preload(matchId);
  return lookup.kind === 'event' ? lookup.event : null;
}

/** Displayed crossings reach this through Continue; same-group rows are silent. */
export async function acknowledgeRankedProgression(eventId: string): Promise<boolean> {
  return rankedProgressionRecovery.acknowledge(eventId);
}
