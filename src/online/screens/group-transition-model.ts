// Pure planning for the ranked result's mandatory group-transition deck.
// Settlement owns the historical facts; this module only validates their
// shape and turns registry ids into an ordered presentation plan.
import { boardGroup, groupsForCurve } from '../../core/ladder.ts';
import {
  RANKED_POOL_TIERS,
  legacyRankedOutcomeEntitlementsForTier,
  orderRankedOutcomes,
  rankedOutcomeById,
} from '../../core/ranked-outcomes.ts';
import { spellById } from '../../core/spells.ts';
import type { LadderGroupId } from '../../i18n/display.ts';
import type { GroupTransitionEvent } from '../api/ranked-progression-api.ts';

export type GroupTransitionSlide =
  | {
    readonly kind: 'group';
    readonly direction: 'promotion' | 'demotion';
    readonly from: LadderGroupId;
    readonly to: LadderGroupId;
  }
  | { readonly kind: 'outcome'; readonly outcomeId: string }
  | { readonly kind: 'rune-seat' }
  | { readonly kind: 'weekly-access' }
  | { readonly kind: 'neon-medal' };

const GROUP_IDS = groupsForCurve(2).map(({ id }) => id) as readonly LadderGroupId[];
const POOL_IDS = RANKED_POOL_TIERS.map(({ id }) => id);

/* Curve v1 shipped this teaching order before the canonical v2 display order
   existed. Keep already-durable legacy rows visually compatible; only v2's
   exact grants use orderRankedOutcomes(). */
const LEGACY_OUTCOME_ORDER = Object.freeze([
  'classic', 'singlestrike', 'colshield', 'limited',
  'rowswitch', 'rowmult', 'bounty', 'rune_trial',
]);

function indexOf<const Id extends string>(ids: readonly Id[], value: unknown): number {
  return typeof value === 'string' ? ids.indexOf(value as Id) : -1;
}

function validOutcomeGrants(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length) return false;
  return value.every((id) => {
    if (typeof id !== 'string') return false;
    try { rankedOutcomeById(id); return true; } catch { return false; }
  });
}

function validEvent(value: GroupTransitionEvent): boolean {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.eventId !== 'string' || !value.eventId.length
      || (value.matchId !== null
        && (typeof value.matchId !== 'string' || !value.matchId.length))) return false;
  if (!Number.isInteger(value.beforePoints) || value.beforePoints < 0
      || !Number.isInteger(value.afterPoints) || value.afterPoints < 0) return false;
  if (value.curveVersion !== 1 && value.curveVersion !== 2) return false;
  if (indexOf(GROUP_IDS, value.beforeGroup) < 0
      || indexOf(GROUP_IDS, value.afterGroup) < 0
      || indexOf(POOL_IDS, value.beforePoolTier) < 0
      || indexOf(POOL_IDS, value.afterPoolTier) < 0) return false;
  if (boardGroup(
    value.beforePoints, value.beforeGroup === 'neon', value.curveVersion,
  ).id !== value.beforeGroup || boardGroup(
    value.afterPoints, value.afterGroup === 'neon', value.curveVersion,
  ).id !== value.afterGroup) return false;
  if (typeof value.randomRuneMode !== 'boolean'
      || typeof value.runeSeatUnlockedBefore !== 'boolean'
      || typeof value.runeSeatUnlockedAfter !== 'boolean'
      || typeof value.weeklyUnlockedBefore !== 'boolean'
      || typeof value.weeklyUnlockedAfter !== 'boolean'
      || typeof value.neonMedalGranted !== 'boolean'
      || !validOutcomeGrants(value.outcomeGrants)) return false;
  if (value.weeklyUnlockedBefore && !value.weeklyUnlockedAfter) return false;
  if (value.equippedRune !== null
      && (typeof value.equippedRune !== 'string' || !spellById(value.equippedRune))) return false;
  if (value.randomRuneMode && value.equippedRune === null) return false;
  if (value.seenAt !== null && typeof value.seenAt !== 'string') return false;
  return true;
}

function legacyOutcomeSlides(event: GroupTransitionEvent): GroupTransitionSlide[] {
  const before = new Set(legacyRankedOutcomeEntitlementsForTier(event.beforePoolTier));
  const after = new Set(legacyRankedOutcomeEntitlementsForTier(event.afterPoolTier));
  const additions = new Set([...after].filter((id) => !before.has(id)));
  return LEGACY_OUTCOME_ORDER
    .filter((outcomeId) => additions.has(outcomeId))
    .map((outcomeId) => ({ kind: 'outcome' as const, outcomeId }));
}

function v2MilestoneSlides(
  event: GroupTransitionEvent,
  afterGroupIndex: number,
): readonly GroupTransitionSlide[] | null {
  const milestones: Array<{
    readonly groupIndex: number;
    readonly slide: GroupTransitionSlide;
  }> = [];
  const add = (group: LadderGroupId, slide: GroupTransitionSlide): boolean => {
    const groupIndex = indexOf(GROUP_IDS, group);
    if (groupIndex < 0 || groupIndex > afterGroupIndex) return false;
    milestones.push({ groupIndex, slide });
    return true;
  };

  const orderedOutcomes = orderRankedOutcomes(
    event.outcomeGrants.map((id) => rankedOutcomeById(id)),
  );
  for (const outcome of orderedOutcomes) {
    if (!add(outcome.unlockGroup, { kind: 'outcome', outcomeId: outcome.id })) return null;
  }
  if (!event.runeSeatUnlockedBefore && event.runeSeatUnlockedAfter
      && !add('silver', { kind: 'rune-seat' })) return null;
  if (!event.weeklyUnlockedBefore && event.weeklyUnlockedAfter
      && !add('obsidian', { kind: 'weekly-access' })) return null;
  if (event.neonMedalGranted && !add('neon', { kind: 'neon-medal' })) return null;

  /* Array#sort is stable: canonical outcome order is preserved within one
     milestone while cross-boundary catch-up is taught from low to high. */
  milestones.sort((a, b) => a.groupIndex - b.groupIndex);
  return milestones.map(({ slide }) => slide);
}

/** Fail closed: a malformed server event must never obscure the ranked result. */
export function groupTransitionSlides(
  event: GroupTransitionEvent,
): readonly GroupTransitionSlide[] {
  if (!validEvent(event) || event.seenAt !== null) return [];
  const beforeGroupIndex = indexOf(GROUP_IDS, event.beforeGroup);
  const afterGroupIndex = indexOf(GROUP_IDS, event.afterGroup);
  if (indexOf(POOL_IDS, event.afterPoolTier) < indexOf(POOL_IDS, event.beforePoolTier)) return [];
  if (beforeGroupIndex === afterGroupIndex) {
    /* Positional NEON can be established between settlements. Its next v2
       event may truthfully carry delayed lower-milestone catch-up and the
       season medal while both apex snapshots already classify as NEON. There
       is no fabricated group slide: teach only the exact durable grants. */
    if (event.curveVersion !== 2
        || (event.runeSeatUnlockedBefore && !event.runeSeatUnlockedAfter)) return [];
    try { return v2MilestoneSlides(event, afterGroupIndex) ?? []; }
    catch { return []; }
  }

  const direction = afterGroupIndex > beforeGroupIndex ? 'promotion' : 'demotion';
  /* A numeric group direction may not contradict the settled point step.
     NEON is different: it is an authoritative position, and its boundary can
     move independently of this player's points. */
  const positional = event.beforeGroup === 'neon' || event.afterGroup === 'neon';
  if (!positional && ((direction === 'promotion' && event.afterPoints < event.beforePoints)
      || (direction === 'demotion' && event.afterPoints > event.beforePoints))) return [];
  const groupSlide: GroupTransitionSlide = {
    kind: 'group', direction, from: event.beforeGroup, to: event.afterGroup,
  };
  try {
    if (event.curveVersion === 1) {
      /* Legacy rows did not carry exact authoritative grants. Preserve their
         shipped group-only demotion presentation, including old falling
         snapshot oddities that cannot represent a new durable capability. */
      if (direction === 'demotion') return [groupSlide];
      const slides = [groupSlide, ...legacyOutcomeSlides(event)];
      if (!event.runeSeatUnlockedBefore && event.runeSeatUnlockedAfter) {
        slides.push({ kind: 'rune-seat' });
      }
      return slides;
    }
    /* V2 grants are exact settlement facts. A player who was apex before the
       game may earn the season medal/catch-up even when this game demotes
       them, so acknowledge the demotion first and then teach every truthful
       milestone they had reached on either side. Permanent flags may never
       fall. */
    if (event.runeSeatUnlockedBefore && !event.runeSeatUnlockedAfter) return [];
    const milestones = v2MilestoneSlides(event,
      direction === 'demotion' ? Math.max(beforeGroupIndex, afterGroupIndex) : afterGroupIndex);
    return milestones ? [groupSlide, ...milestones] : [];
  } catch {
    return [];
  }
}
