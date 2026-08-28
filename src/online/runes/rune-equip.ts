// THE EQUIPPED RUNE — the seat, not the collection.
//
// Split from rune-collection.ts by ownership: that module answers "what does
// this account own", this one answers "what does it carry". They share the
// eager cache and nothing else, and this file deliberately takes primitives
// rather than a RuneCollectionRefresh so the dependency runs one way only.
import { spellById } from '../../core/spells.ts';
import {
  readRuneCollectionSnapshot,
  writeRuneCollectionSnapshot,
} from '../../rune-collection-cache.ts';
import { supa } from '../api/client.ts';

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
 * Seat a collected rune, or clear the seat with null. Returns the value the
 * server now holds, which is not always the one asked for: a refused write
 * leaves the previous seat standing rather than guessing.
 *
 * There is no RPC behind this and there does not need to be. `profiles` already
 * grants a player UPDATE on their own row, and the composite foreign key on
 * (id, equipped_rune) means the strongest possible forged request still cannot
 * name a rune the account does not own — the database refuses it. An RPC would
 * add a second place for that rule to live and be wrong in.
 */
export async function equipRune(accountId: string, runeId: string | null): Promise<string | null> {
  const snapshot = readRuneCollectionSnapshot();
  const owned = snapshot?.accountId === accountId.toLowerCase() ? snapshot.collected : [];
  /* Refuse locally what the database would refuse anyway, so an impossible
     request never costs a round trip. */
  if (runeId !== null && !owned.includes(runeId)) return snapshot?.equippedRune ?? null;
  const { error } = await supa().from('profiles')
    .update({ equipped_rune: runeId })
    .eq('id', accountId);
  if (error) return snapshot?.equippedRune ?? null;
  const current = readRuneCollectionSnapshot();
  /* Only restamp a cache that still belongs to this account: a sign-out or an
     account switch may have landed while the write was in flight. */
  if (current?.accountId === accountId.toLowerCase()) {
    writeRuneCollectionSnapshot(
      accountId, current.collected, current.verifiedAt, current.poolTier, runeId,
    );
  }
  return runeId;
}

/**
 * THE FIRST RUNE YOU EVER WIN SEATS ITSELF. Told, not asked — a player who has
 * exactly one rune and an empty seat has no decision to make, and sending them
 * to find the control that expresses the only available answer is a worse
 * screen. Every later change is theirs.
 *
 * Deliberately silent about failure: this is a convenience on top of a refresh,
 * never a precondition for one.
 */
export async function autoEquipFirstRune(
  accountId: string | null,
  collected: readonly string[],
  equipped: string | null,
): Promise<void> {
  if (!accountId || equipped !== null || collected.length !== 1) return;
  await equipRune(accountId, collected[0]);
}
