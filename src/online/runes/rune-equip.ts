// THE EQUIPPED RUNE — the seat, not the collection.
//
// Split from rune-collection.ts by ownership: that module answers "what does
// this account own", this one answers "what does it carry". They share the
// eager cache and nothing else, and this file deliberately takes primitives
// rather than a RuneCollectionRefresh so the dependency runs one way only.
import { spellById } from '../../core/spells.ts';
import {
  readRuneCollectionSnapshot,
  selectionFromEquipment,
  writeRuneCollectionSnapshot,
} from '../../rune-collection-cache.ts';
import type { EquippedRuneSelection } from '../../rune-collection-cache.ts';
import { supa } from '../api/client.ts';

export type { EquippedRuneSelection } from '../../rune-collection-cache.ts';

export interface RuneEquipmentWrite {
  readonly equippedRune: string | null;
  readonly randomRuneMode: boolean;
}

/** Pure profile-write resolver, kept separate so ownership and compatibility
 * fallback rules stay pinned without an authenticated browser. */
export function resolveRuneEquipmentWrite(
  selection: EquippedRuneSelection,
  owned: readonly string[],
  previousEquippedRune: string | null,
): RuneEquipmentWrite | null {
  if (selection.kind === 'fixed') {
    return owned.includes(selection.runeId)
      ? { equippedRune: selection.runeId, randomRuneMode: false }
      : null;
  }
  if (selection.kind === 'random') {
    const equippedRune = previousEquippedRune && owned.includes(previousEquippedRune)
      ? previousEquippedRune
      : owned[0] ?? null;
    return equippedRune === null ? null : { equippedRune, randomRuneMode: true };
  }
  return { equippedRune: null, randomRuneMode: false };
}

/* A seat may only hold a rune the account actually collected. The database
   guarantees it through the composite key on (id, equipped_rune); this is the
   client refusing to DISPLAY a claim it cannot back, which also covers the
   window where a rune was equipped and the collection read is older. */
export function usableEquippedRune(value: unknown, collected: readonly string[]): string | null {
  return typeof value === 'string' && spellById(value) && collected.includes(value)
    ? value
    : null;
}

/**
 * Persist fixed, RANDOM, or empty equipment and return the resulting semantic
 * selection. A refused write leaves the previous selection standing rather
 * than guessing. The narrow authenticated RPC owns the atomic two-field write;
 * ownership remains canonical in the profile foreign key.
 */
export async function setRuneEquipment(
  accountId: string,
  selection: EquippedRuneSelection,
): Promise<EquippedRuneSelection> {
  const snapshot = readRuneCollectionSnapshot();
  const owned = snapshot?.accountId === accountId.toLowerCase() ? snapshot.collected : [];
  const previous = snapshot?.accountId === accountId.toLowerCase()
    ? snapshot.equipment
    : { kind: 'none' } as const;
  const write = resolveRuneEquipmentWrite(selection, owned, snapshot?.equippedRune ?? null);
  if (!write) return previous;
  const { equippedRune, randomRuneMode } = write;
  /* The legacy direct profile grant means "fixed or clear" and its trigger
     exits RANDOM. Only the RPC can change both v2 fields without that legacy
     meaning; it derives the row from auth.uid(), so accountId never crosses
     the trust boundary as a writable target. */
  const { error } = await supa().rpc('set_rune_equipment', {
    p_equipped_rune: equippedRune,
    p_random_rune_mode: randomRuneMode,
  });
  if (error) return previous;
  const current = readRuneCollectionSnapshot();
  /* Only restamp a cache that still belongs to this account: a sign-out or an
     account switch may have landed while the write was in flight. */
  if (current?.accountId === accountId.toLowerCase()) {
    writeRuneCollectionSnapshot(
      accountId, current.collected, current.verifiedAt, current.poolTier,
      equippedRune, randomRuneMode,
    );
  }
  return selectionFromEquipment(equippedRune, randomRuneMode);
}

/** Compatibility wrapper for callers that still speak fixed-or-empty only. */
export async function equipRune(accountId: string, runeId: string | null): Promise<string | null> {
  const result = await setRuneEquipment(
    accountId,
    runeId === null ? { kind: 'none' } : { kind: 'fixed', runeId },
  );
  return result.kind === 'fixed' ? result.runeId : null;
}
