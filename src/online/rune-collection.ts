// Authenticated Rune Trial collection sync. The durable rows belong to
// Supabase; the eager cache belongs to src/rune-collection-cache.ts so offline
// setup never has to import this lazy online chunk.
import { spellById } from '../core/spells.ts';
import type { RankedPoolTier } from '../core/ranked-outcomes.ts';
import {
  clearRuneCollectionSnapshot,
  collectedRuneIds,
  readRuneCollectionSnapshot,
  writeRuneCollectionSnapshot,
} from '../rune-collection-cache.ts';
import { supa } from './client.ts';
import { createCollectionRefreshGuard } from './rune-collection-guard.ts';

const refreshGuard = createCollectionRefreshGuard();

export function invalidateRuneCollectionRefreshes(): void {
  refreshGuard.invalidate();
}

export interface PlayerRuneRow {
  rune_id: string;
  collected_at: string;
  source_match_id: string | null;
  seen_at: string | null;
}

export interface RuneCollectionRefresh {
  accountId: string | null;
  collected: readonly string[];
  unseen: readonly PlayerRuneRow[];
  verified: boolean;
  poolTier: RankedPoolTier | null;
}

function usablePoolTier(value: unknown): RankedPoolTier | null {
  return value === 'stone' || value === 'bone' || value === 'ivory' ? value : null;
}

function usableRows(value: unknown): PlayerRuneRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is PlayerRuneRow => {
    if (!row || typeof row !== 'object') return false;
    const candidate = row as Record<string, unknown>;
    return typeof candidate.rune_id === 'string'
      && !!spellById(candidate.rune_id)
      && typeof candidate.collected_at === 'string'
      && (candidate.source_match_id === null || typeof candidate.source_match_id === 'string')
      && (candidate.seen_at === null || typeof candidate.seen_at === 'string');
  });
}

async function sessionAccountId(): Promise<string | null> {
  const { data, error } = await supa().auth.getSession();
  return error ? null : data.session?.user.id ?? null;
}

/**
 * Refresh the collection for the active account. A cached collection from a
 * different account is removed before the request, so an outage can retain
 * only this account's last confirmed ownership — never somebody else's.
 */
export async function refreshRuneCollection(
  accountId?: string | null,
): Promise<RuneCollectionRefresh> {
  const id = accountId ?? await sessionAccountId();
  if (!id) {
    clearRuneCollectionSnapshot();
    return { accountId: null, collected: [], unseen: [], verified: false, poolTier: null };
  }
  const token = refreshGuard.begin(id);

  const cached = readRuneCollectionSnapshot();
  if (cached && cached.accountId !== id.toLowerCase()) clearRuneCollectionSnapshot();

  const [runeResult, profileResult] = await Promise.all([
    supa().from('player_runes')
      .select('rune_id, collected_at, source_match_id, seen_at')
      .eq('player_id', id)
      .order('collected_at', { ascending: true }),
    supa().from('profiles')
      .select('ranked_pool_tier')
      .eq('id', id)
      .maybeSingle(),
  ]);
  if (runeResult.error) {
    const retained = readRuneCollectionSnapshot();
    const sameAccount = retained?.accountId === id.toLowerCase() ? retained : null;
    return {
      accountId: id,
      collected: sameAccount?.collected ?? [],
      unseen: [],
      verified: false,
      poolTier: sameAccount?.poolTier ?? null,
    };
  }

  const rows = usableRows(runeResult.data);
  const collected = [...new Set(rows.map(({ rune_id }) => rune_id))];
  const cachedTier = readRuneCollectionSnapshot()?.poolTier ?? null;
  const poolTier = profileResult.error
    ? cachedTier
    : usablePoolTier(profileResult.data?.ranked_pool_tier);
  const activeAccountId = await sessionAccountId();
  if (!refreshGuard.owns(token, activeAccountId)) {
    const retained = readRuneCollectionSnapshot();
    const sameAccount = retained?.accountId === id.toLowerCase() ? retained : null;
    return {
      accountId: id,
      collected: sameAccount?.collected ?? [],
      unseen: [],
      verified: false,
      poolTier: sameAccount?.poolTier ?? null,
    };
  }
  writeRuneCollectionSnapshot(id, collected, Date.now(), poolTier);
  return {
    accountId: id,
    collected,
    unseen: rows.filter(({ seen_at }) => seen_at === null),
    verified: true,
    poolTier,
  };
}

/** Mark a shown first-unlock reward seen without granting broad table UPDATE. */
export async function acknowledgeRuneReward(runeId: string): Promise<boolean> {
  if (!spellById(runeId)) return false;
  const { data, error } = await supa().rpc('acknowledge_rune_reward', {
    reward_rune_id: runeId,
  });
  return !error && data === true;
}
