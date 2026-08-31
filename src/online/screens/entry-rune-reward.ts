import type { RuneCollectionRefresh } from '../runes/rune-collection.ts';
import {
  firstUnseenRuneReward,
  showRuneRewardSheet,
  type RuneRewardSheet,
} from '../runes/rune-reward-presentation.ts';

export interface EntryRuneRewardPresenter {
  close(): void;
  present(
    collection: RuneCollectionRefresh,
    owns: () => boolean,
    onContinue: () => void,
    actionLabel?: () => string,
    deferAcknowledgement?: boolean,
  ): boolean;
}

/** Owns the single reward sheet that may cover online entry/navigation. */
export function createEntryRuneRewardPresenter(): EntryRuneRewardPresenter {
  let active: RuneRewardSheet | null = null;

  const close = (): void => {
    const presentation = active;
    active = null;
    presentation?.close();
  };

  const present: EntryRuneRewardPresenter['present'] = (
    collection,
    owns,
    onContinue,
    actionLabel,
    deferAcknowledgement = false,
  ) => {
    const reward = firstUnseenRuneReward(collection);
    if (!reward || !owns()) return false;
    close();
    let presentation!: RuneRewardSheet;
    const release = (): void => {
      if (active === presentation) active = null;
    };
    presentation = showRuneRewardSheet(reward, {
      owns: () => active === presentation && owns(),
      actionLabel,
      acknowledgement: deferAcknowledgement ? 'deferred' : 'presented',
      onContinue: () => { release(); onContinue(); },
    });
    active = presentation;
    return true;
  };

  return { close, present };
}
