// How a matched ranked row describes itself to the shared reveal: the roster
// the dial could have landed on, copy for a format core/modes does not name,
// and the two runes a settled Rune Trial turns over. The reveal itself is the
// same overlay local play uses; only this translation is ranked-specific, and
// keeping it here is what lets the queue run stay one control flow.
import { modeById } from '../../core/modes.ts';
import {
  RUNE_TRIAL_CAPABILITY,
  RUNE_TRIAL_FORMAT,
  rankedOutcomeRoster,
} from '../../core/ranked-outcomes.ts';
import { spellById } from '../../core/spells.ts';
import { modeCopy, t } from '../../i18n/index.ts';
import { hide } from '../../ui/dom.ts';
import { reveal } from '../../ui/reveal.ts';
import type { DialSide } from '../../ui/reveal-types.ts';
import type { TrialRevealSide } from '../../ui/trial-reveal.ts';
import { type JoinResult } from '../api/match-api.ts';
import { readyPeer } from '../api/match-realtime.ts';

export type MatchedJoin = Extract<JoinResult, { status: 'matched' }>;

/** The pair the reveal turns over, in its own seating order. Declared against
    the reveal's side type so a drift in that contract fails here, at the
    boundary, rather than at the call that hands the pair over. */
export type TrialRevealPair = readonly [TrialRevealSide, TrialRevealSide];

type Seat = 'p1' | 'p2';

const mySeat = (match: MatchedJoin): Seat => (match.you === 1 ? 'p1' : 'p2');
const facing = (seat: Seat): Seat => (seat === 'p1' ? 'p2' : 'p1');

const revealCandidates = (result: MatchedJoin) => {
  const tier = result.match.pool_tier;
  if (!tier) return undefined;
  return rankedOutcomeRoster([{
    tier,
    capabilities: result.match.protocol_version === 2 ? [RUNE_TRIAL_CAPABILITY] : [],
  }]).map(({ id }) => ({ id }));
};

const revealCopy = (id: string) => id === RUNE_TRIAL_FORMAT
  ? {
    name: t('game', 'modes.runeTrial.name'),
    blurb: t('game', 'modes.runeTrial.blurb'),
  }
  : modeCopy(id);

/* Both public choices, in the seating the reveal reads: mine first, in my
   colour. Null when the row is missing one — the resolver only returns after
   the server has published both, so this is a contract check, not a state. */
export function trialRevealSides(match: MatchedJoin): TrialRevealPair | null {
  const mine = mySeat(match);
  const theirs = facing(mine);
  const rune = (seat: Seat) =>
    spellById(seat === 'p1' ? match.match.p1_rune : match.match.p2_rune);
  const [myRune, theirRune] = [rune(mine), rune(theirs)];
  if (!myRune || !theirRune) return null;
  return [
    { spell: myRune, name: () => match.names[mine], hue: 'var(--p1)' },
    { spell: theirRune, name: () => match.names[theirs], hue: 'var(--p2)' },
  ];
}

/** Run the reveal for one matched ranked row, resolving when the player is
    done with it. `trial` is passed unconditionally: only a Trial format has a
    private choice left to make, and deciding that here is what keeps the
    format name out of the queue run. */
export async function revealRankedMatch(
  match: MatchedJoin,
  trial: (note: (text: string | null) => void) => Promise<TrialRevealPair | null>,
): Promise<void> {
  hide('#ovOnline');
  const mine = mySeat(match);
  const isTrial = match.match.format === RUNE_TRIAL_FORMAT;
  const side = (seat: Seat): DialSide => ({
    name: match.names[seat],
    rating: match.names.ratings?.[seat] ?? null,
    avatar: match.names.avatars?.[seat] ?? null,
  });
  await reveal({
    mode: { id: isTrial ? RUNE_TRIAL_FORMAT : modeById(match.match.modifier).id },
    modeCandidates: revealCandidates(match),
    modeCopy: revealCopy,
    trial: isTrial ? { resolve: trial } : undefined,
    me: side(mine),
    foe: side(facing(mine)),
    peer: readyPeer(match.match.id),
  });
}
