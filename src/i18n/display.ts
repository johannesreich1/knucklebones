import { formatNumber, t } from './runtime.ts';

export const MODE_COPY_IDS = [
  'classic', 'rowswitch', 'rowmult', 'colshield', 'singlestrike', 'bounty', 'limited', 'random',
] as const;
export type ModeCopyId = typeof MODE_COPY_IDS[number];

export const SPELL_COPY_IDS = [
  'fate', 'nudge', 'ward', 'sunder', 'pilfer', 'anvil', 'none', 'random', 'random2',
] as const;
export type SpellCopyId = typeof SPELL_COPY_IDS[number];

export const LADDER_GROUP_IDS = [
  'stone', 'bone', 'ivory', 'silver', 'gold', 'obsidian', 'neon',
] as const;
export type LadderGroupId = typeof LADDER_GROUP_IDS[number];

function stableId<const Id extends string>(ids: readonly Id[], value: string, kind: string): Id {
  if (!ids.includes(value as Id)) throw new TypeError(`Unknown ${kind} id: ${value}`);
  return value as Id;
}

export interface ModeCopy {
  readonly name: string;
  readonly compactName: string;
  readonly blurb: string;
  readonly detail: string;
}

export function modeCopy(id: string): ModeCopy {
  const key = stableId(MODE_COPY_IDS, id, 'mode');
  return {
    name: t('game', `modes.${key}.name`),
    compactName: t('game', `modes.${key}.compact`),
    blurb: t('game', `modes.${key}.blurb`),
    detail: t('game', `modes.${key}.detail`),
  };
}

export interface SpellCopy extends ModeCopy {
  readonly aim: string;
  readonly aimCompact: string;
}

export function outOfTimeCopy(column: number) {
  return {
    visible: () => t('game', 'status.outOfTimeCompact', { column: formatNumber(column) }),
    accessible: () => t('game', 'status.outOfTime', { column: formatNumber(column) }),
  };
}

export function spellCopy(id: string): SpellCopy {
  const key = stableId(SPELL_COPY_IDS, id, 'spell');
  return {
    name: t('game', `runes.${key}.name`),
    compactName: t('game', `runes.${key}.compact`),
    blurb: t('game', `runes.${key}.blurb`),
    detail: t('game', `runes.${key}.detail`),
    aim: t('game', `runes.${key}.aim`),
    /* WARD and PILFER need a shorter visible instruction in the landscape
       status lane. The complete localized aim remains its accessible name. */
    aimCompact: key === 'ward' || key === 'pilfer'
      ? t('game', `runes.${key}.aimCompact`)
      : t('game', `runes.${key}.aim`),
  };
}

export interface LadderGroupCopy {
  readonly name: string;
  readonly compactName: string;
}

export function ladderGroupCopy(id: string): LadderGroupCopy {
  const key = stableId(LADDER_GROUP_IDS, id, 'ladder group');
  return {
    name: t('online', `ladder.groups.${key}.name`),
    compactName: t('online', `ladder.groups.${key}.compact`),
  };
}

export const ladderGroupName = (id: string): string => ladderGroupCopy(id).name;
export const ladderGroupCompactName = (id: string): string => ladderGroupCopy(id).compactName;
