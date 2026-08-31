// Last server-confirmed rune collection, kept eager and Supabase-free so the
// offline setup can fail closed before the online chunk is loaded. The account
// id is part of the value: an unbound list must never unlock another account's
// practice choices after sign-out or account switching.
import { SPELLS } from './core/spells.ts';
import type { RankedPoolTier } from './core/ranked-outcomes.ts';

export const RUNE_COLLECTION_CACHE_KEY = 'knucklebones.runes.v1';
export const RUNE_COLLECTION_CACHE_VERSION = 1 as const;

export type EquippedRuneSelection =
  | { readonly kind: 'none' }
  | { readonly kind: 'fixed'; readonly runeId: string }
  | { readonly kind: 'random' };

export interface RuneCollectionSnapshot {
  readonly version: typeof RUNE_COLLECTION_CACHE_VERSION;
  readonly accountId: string;
  readonly verifiedAt: number;
  readonly collected: readonly string[];
  /** Last server-confirmed permanent variety tier. Null means unknown/pre-v2. */
  readonly poolTier: RankedPoolTier | null;
  /* The fixed rune, or the concrete owned fallback retained while RANDOM is
     active so an installed pre-random client still carries a valid rune. */
  readonly equippedRune: string | null;
  /** Each fresh ordinary match after SILVER was reached once samples the owned collection. */
  readonly randomRuneMode: boolean;
  /** Semantic profile/UI view; never exposes the RANDOM compatibility fallback. */
  readonly equipment: EquippedRuneSelection;
}

type Listener = (snapshot: RuneCollectionSnapshot | null) => void;
const listeners = new Set<Listener>();
const knownRuneIds = new Set(SPELLS.map(({ id }) => id));
const knownPoolTiers = new Set<RankedPoolTier>(['stone', 'bone', 'ivory']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; }
}

function normalizedIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string' || !knownRuneIds.has(id)) return null;
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids;
}

export function selectionFromEquipment(
  equippedRune: string | null,
  randomRuneMode: boolean,
): EquippedRuneSelection {
  if (randomRuneMode) return { kind: 'random' };
  return equippedRune === null ? { kind: 'none' } : { kind: 'fixed', runeId: equippedRune };
}

function parse(value: unknown): RuneCollectionSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const collected = normalizedIds(candidate.collected);
  if (candidate.version !== RUNE_COLLECTION_CACHE_VERSION
      || typeof candidate.accountId !== 'string' || !UUID.test(candidate.accountId)
      || typeof candidate.verifiedAt !== 'number' || !Number.isSafeInteger(candidate.verifiedAt)
      || candidate.verifiedAt < 0 || !collected) return null;
  const equippedRune = typeof candidate.equippedRune === 'string'
      && knownRuneIds.has(candidate.equippedRune)
      && collected.includes(candidate.equippedRune)
    ? candidate.equippedRune
    : null;
  const randomRuneMode = candidate.randomRuneMode === true;
  /* RANDOM must retain a concrete owned fallback. This is a database
     invariant as well as stale-client compatibility, so a tampered cache
     fails closed instead of silently changing modes. */
  if (randomRuneMode && equippedRune === null) return null;
  return Object.freeze({
    version: RUNE_COLLECTION_CACHE_VERSION,
    accountId: candidate.accountId.toLowerCase(),
    verifiedAt: candidate.verifiedAt,
    collected: Object.freeze(collected),
    poolTier: knownPoolTiers.has(candidate.poolTier as RankedPoolTier)
      ? candidate.poolTier as RankedPoolTier
      : null,
    /* An id the registry retired—or the collection no longer owns—must not
       survive in a cache and re-appear in the seat. */
    equippedRune,
    randomRuneMode,
    equipment: selectionFromEquipment(equippedRune, randomRuneMode),
  });
}

export function readRuneCollectionSnapshot(): RuneCollectionSnapshot | null {
  const store = storage();
  if (!store) return null;
  try { return parse(JSON.parse(store.getItem(RUNE_COLLECTION_CACHE_KEY) ?? 'null')); }
  catch { return null; }
}

export function collectedRuneIds(): readonly string[] {
  return readRuneCollectionSnapshot()?.collected ?? [];
}

export function collectedRuneCount(): number {
  return collectedRuneIds().length;
}

export function hasCollectedRune(id: string): boolean {
  return collectedRuneIds().includes(id);
}

export function confirmedRankedPoolTier(): RankedPoolTier | null {
  return readRuneCollectionSnapshot()?.poolTier ?? null;
}

/** The selected rune ordinary ranked can use after SILVER is reached once, or null. */
export function equippedRuneId(): string | null {
  return readRuneCollectionSnapshot()?.equippedRune ?? null;
}

export function equippedRuneSelection(): EquippedRuneSelection {
  return readRuneCollectionSnapshot()?.equipment ?? { kind: 'none' };
}

function publish(): void {
  const snapshot = readRuneCollectionSnapshot();
  listeners.forEach((listener) => listener(snapshot));
}

/** Called only after an authenticated server response confirms the collection. */
export function writeRuneCollectionSnapshot(
  accountId: string,
  ids: readonly string[],
  verifiedAt: number = Date.now(),
  poolTier: RankedPoolTier | null = null,
  equippedRune: string | null = null,
  randomRuneMode: boolean = false,
): boolean {
  const collected = normalizedIds(ids);
  if (!UUID.test(accountId) || !collected || !Number.isSafeInteger(verifiedAt) || verifiedAt < 0
      || (poolTier !== null && !knownPoolTiers.has(poolTier))
      || (equippedRune !== null && !knownRuneIds.has(equippedRune))
      || typeof randomRuneMode !== 'boolean') return false;
  const resolvedEquipped = equippedRune !== null && collected.includes(equippedRune)
    ? equippedRune
    : null;
  if (randomRuneMode && resolvedEquipped === null) return false;
  const snapshot: RuneCollectionSnapshot = {
    version: RUNE_COLLECTION_CACHE_VERSION,
    accountId: accountId.toLowerCase(),
    verifiedAt,
    collected,
    poolTier,
    /* A rune can only be carried once it is owned. Enforced in the database by
       the composite key on (id, equipped_rune); mirrored here so a stale cache
       cannot show a seat the account has no claim to. */
    equippedRune: resolvedEquipped,
    randomRuneMode,
    equipment: selectionFromEquipment(resolvedEquipped, randomRuneMode),
  };
  const store = storage();
  if (!store) return false;
  try { store.setItem(RUNE_COLLECTION_CACHE_KEY, JSON.stringify(snapshot)); }
  catch { return false; }
  publish();
  return true;
}

/**
 * Drop the active snapshot. When an account id is supplied, a stale sign-out
 * callback cannot erase a newer account's cache.
 */
export function clearRuneCollectionSnapshot(accountId?: string): boolean {
  const store = storage();
  if (!store) return false;
  if (accountId) {
    const current = readRuneCollectionSnapshot();
    if (!current || current.accountId !== accountId.toLowerCase()) return false;
  }
  try { store.removeItem(RUNE_COLLECTION_CACHE_KEY); }
  catch { return false; }
  publish();
  return true;
}

export function subscribeRuneCollection(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
