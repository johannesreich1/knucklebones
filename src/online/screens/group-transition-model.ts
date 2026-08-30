// Pure planning for the ranked result's mandatory group-transition deck.
// Settlement owns the historical facts; this module only validates their
// shape and turns registry ids into an ordered presentation plan.
import { GROUPS } from '../../core/ladder.ts';
import {
  RANKED_POOL_TIERS,
  rankedPoolUnlocks,
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
  | { readonly kind: 'equipped-rune'; readonly state: 'active' | 'resting' };

const GROUP_IDS = GROUPS.map(({ id }) => id) as readonly LadderGroupId[];
const POOL_IDS = RANKED_POOL_TIERS.map(({ id }) => id);

function indexOf<const Id extends string>(ids: readonly Id[], value: unknown): number {
  return typeof value === 'string' ? ids.indexOf(value as Id) : -1;
}

function validEvent(value: GroupTransitionEvent): boolean {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.eventId !== 'string' || !value.eventId.length
      || typeof value.matchId !== 'string' || !value.matchId.length) return false;
  if (!Number.isInteger(value.beforePoints) || value.beforePoints < 0
      || !Number.isInteger(value.afterPoints) || value.afterPoints < 0) return false;
  if (indexOf(GROUP_IDS, value.beforeGroup) < 0
      || indexOf(GROUP_IDS, value.afterGroup) < 0
      || indexOf(POOL_IDS, value.beforePoolTier) < 0
      || indexOf(POOL_IDS, value.afterPoolTier) < 0) return false;
  if (typeof value.randomRuneMode !== 'boolean'
      || typeof value.runeLiveBefore !== 'boolean'
      || typeof value.runeLiveAfter !== 'boolean') return false;
  if (value.equippedRune !== null
      && (typeof value.equippedRune !== 'string' || !spellById(value.equippedRune))) return false;
  if (value.randomRuneMode && value.equippedRune === null) return false;
  if (value.seenAt !== null && typeof value.seenAt !== 'string') return false;
  return true;
}

/** Fail closed: a malformed server event must never obscure the ranked result. */
export function groupTransitionSlides(
  event: GroupTransitionEvent,
): readonly GroupTransitionSlide[] {
  if (!validEvent(event) || event.seenAt !== null) return [];
  const beforeGroupIndex = indexOf(GROUP_IDS, event.beforeGroup);
  const afterGroupIndex = indexOf(GROUP_IDS, event.afterGroup);
  if (beforeGroupIndex === afterGroupIndex) return [];

  const direction = afterGroupIndex > beforeGroupIndex ? 'promotion' : 'demotion';
  /* A numeric group direction may not contradict the settled point step.
     NEON is different: it is an authoritative position, and its boundary can
     move independently of this player's points. */
  const positional = event.beforeGroup === 'neon' || event.afterGroup === 'neon';
  if (!positional && ((direction === 'promotion' && event.afterPoints < event.beforePoints)
      || (direction === 'demotion' && event.afterPoints > event.beforePoints))) return [];
  if (indexOf(POOL_IDS, event.afterPoolTier) < indexOf(POOL_IDS, event.beforePoolTier)) return [];

  const slides: GroupTransitionSlide[] = [{
    kind: 'group', direction, from: event.beforeGroup, to: event.afterGroup,
  }];
  try {
    for (const outcome of rankedPoolUnlocks(event.beforePoolTier, event.afterPoolTier)) {
      slides.push({ kind: 'outcome', outcomeId: outcome.id });
    }
  } catch {
    return [];
  }

  /* Equipment is reversible, unlike the permanent pool. Only an actual saved
     seat earns a slide; an impossible live flag on an empty historical seat
     is ignored rather than turning a valid group crossing into no UI. */
  if (event.equippedRune && event.runeLiveBefore !== event.runeLiveAfter) {
    slides.push({
      kind: 'equipped-rune',
      state: event.runeLiveAfter ? 'active' : 'resting',
    });
  }
  return slides;
}
