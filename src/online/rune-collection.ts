// Authenticated Rune Trial collection sync. The durable rows belong to
// Supabase; the eager cache belongs to src/rune-collection-cache.ts so offline
// setup never has to import this lazy online chunk.
import { spellById } from '../core/spells.ts';
import type { RankedPoolTier } from '../core/ranked-outcomes.ts';
import { SUPABASE_KEY, SUPABASE_URL } from '../config.ts';
import {
  clearRuneCollectionSnapshot,
  collectedRuneIds,
  readRuneCollectionSnapshot,
  writeRuneCollectionSnapshot,
} from '../rune-collection-cache.ts';
import { supa } from './client.ts';
import { createCollectionRefreshGuard } from './rune-collection-guard.ts';
import { acknowledgeRuneRewardForAccount } from './rune-reward-ack.ts';
import type { ActiveRuneRewardAccount } from './rune-reward-ack.ts';

const refreshGuard = createCollectionRefreshGuard();
const pendingRewardAcknowledgements = new Map<string, Promise<boolean>>();
const RUNE_REWARD_ACK_TIMEOUT_MS = 3000;

function rewardAcknowledgementKey(accountId: string, runeId: string): string {
  return `${accountId.toLowerCase()}:${runeId}`;
}

async function waitForRewardAcknowledgements(accountId: string): Promise<void> {
  const prefix = `${accountId.toLowerCase()}:`;
  const pending = [...pendingRewardAcknowledgements]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, acknowledgement]) => acknowledgement);
  if (pending.length) await Promise.allSettled(pending);
}

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

async function activeRuneRewardAccount(): Promise<ActiveRuneRewardAccount | null> {
  const { data, error } = await supa().auth.getSession();
  const session = data.session;
  if (error || !session?.user.id || !session.access_token) return null;
  return { accountId: session.user.id, accessToken: session.access_token };
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
    const retained = readRuneCollectionSnapshot();
    if (retained) clearRuneCollectionSnapshot(retained.accountId);
    return { accountId: null, collected: [], unseen: [], verified: false, poolTier: null };
  }
  /* Result/profile navigation may race a just-visible reward's durable ACK.
     Query only after that account's in-flight writes settle: success removes
     the unseen row, while failure deliberately leaves it recoverable. */
  await waitForRewardAcknowledgements(id);
  const token = refreshGuard.begin(id);

  const cached = readRuneCollectionSnapshot();
  if (cached && cached.accountId !== id.toLowerCase()) {
    clearRuneCollectionSnapshot(cached.accountId);
  }

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
    const activeAccountId = await sessionAccountId();
    const retained = readRuneCollectionSnapshot();
    const ownership = refreshGuard.settle(token, activeAccountId, retained?.accountId ?? null);
    if (!ownership.owns) {
      /* An implicit A -> B session replacement does not pass through signOut's
         eager invalidation. Never hand A's retained runes to B after A's
         failed request; remove only the stale A snapshot, preserving a newer
         B refresh if one already won the race. */
      if (ownership.discardRetained) clearRuneCollectionSnapshot(id);
      return {
        accountId: null,
        collected: [],
        unseen: [],
        verified: false,
        poolTier: null,
      };
    }
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
  const retained = readRuneCollectionSnapshot();
  const ownership = refreshGuard.settle(token, activeAccountId, retained?.accountId ?? null);
  if (!ownership.owns) {
    if (ownership.discardRetained) clearRuneCollectionSnapshot(id);
    return {
      accountId: null,
      collected: [],
      unseen: [],
      verified: false,
      poolTier: null,
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
async function sendRuneRewardAcknowledgement(
  expectedAccountId: string,
  runeId: string,
): Promise<boolean> {
  return acknowledgeRuneRewardForAccount(expectedAccountId, runeId, {
    activeAccount: activeRuneRewardAccount,
    acknowledge: async (rewardRuneId, account) => {
      /* Bind the write to the token captured by the immediately preceding
         identity check. supabase-js resolves ambient auth when a builder is
         executed, which would otherwise leave a small A -> B retarget window. */
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RUNE_REWARD_ACK_TIMEOUT_MS);
      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/acknowledge_rune_reward`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${account.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reward_rune_id: rewardRuneId }),
        });
        if (!response.ok) return false;
        try { return await response.json() === true; } catch { return false; }
      } catch {
        return false;
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}

export function acknowledgeRuneReward(
  expectedAccountId: string,
  runeId: string,
): Promise<boolean> {
  if (!spellById(runeId)) return Promise.resolve(false);
  const key = rewardAcknowledgementKey(expectedAccountId, runeId);
  const existing = pendingRewardAcknowledgements.get(key);
  if (existing) return existing;
  let pending!: Promise<boolean>;
  pending = sendRuneRewardAcknowledgement(expectedAccountId, runeId)
    .finally(() => {
      if (pendingRewardAcknowledgements.get(key) === pending) {
        pendingRewardAcknowledgements.delete(key);
      }
    });
  pendingRewardAcknowledgements.set(key, pending);
  return pending;
}
