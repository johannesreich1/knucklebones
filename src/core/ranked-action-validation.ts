import type { RankedActionIntent, RankedActionRow } from './ranked-action-types.ts';

export const rankedDieOk = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 6;

export function rankedIntentOf(row: RankedActionRow): RankedActionIntent | null {
  if (row.kind === 'aim' && typeof row.rune_id === 'string'
      && row.target_col === null && row.placed_col === null && row.move_idx === null) {
    return { kind: 'aim', rune_id: row.rune_id };
  }
  if (row.kind === 'cast' && typeof row.rune_id === 'string'
      && Number.isInteger(row.target_col) && row.placed_col === null && row.move_idx === null) {
    return { kind: 'cast', rune_id: row.rune_id, target_col: row.target_col as number };
  }
  if (row.kind === 'place' && Number.isInteger(row.placed_col)
      && row.rune_id === null && row.target_col === null && Number.isInteger(row.move_idx)) {
    return { kind: 'place', placed_col: row.placed_col as number };
  }
  return null;
}

export function sameRankedAction(actual: RankedActionRow, expected: RankedActionRow): boolean {
  return actual.idx === expected.idx
    && actual.move_idx === expected.move_idx
    && actual.who === expected.who
    && actual.kind === expected.kind
    && actual.rune_id === expected.rune_id
    && actual.target_col === expected.target_col
    && actual.placed_col === expected.placed_col
    && actual.die_before === expected.die_before
    && actual.die_after === expected.die_after;
}
