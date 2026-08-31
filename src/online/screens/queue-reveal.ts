// How a matched ranked row describes itself to the shared reveal: the roster
// the dial could have landed on, copy for a format core/modes does not name,
// and (for Rune Trial only) the two mandatory choices a settled match turns
// over. Ordinary ranked rune snapshots still pass through this boundary for
// validation and gameplay, but they are not a pre-game reveal beat.
import { modeById } from '../../core/modes.ts';
import {
  RUNE_TRIAL_CAPABILITY,
  RUNE_TRIAL_FORMAT,
  rankedOutcomeRoster,
} from '../../core/ranked-outcomes.ts';
import { spellById, type SpellSpec } from '../../core/spells.ts';
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

interface RankedRuneSide {
  readonly spell: SpellSpec | null;
  readonly name: () => string;
  readonly hue: string;
}

type RankedRunePair = readonly [RankedRuneSide, RankedRuneSide];

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

/* Validate and translate both immutable public seats, mine first. A null row
   value is a real empty seat. A non-null id this build cannot name makes the
   whole pair unreadable; shortening that to an empty hand would lie about the
   match the server is about to replay. Only Rune Trial presents this pair as a
   reveal, but standard matches still rely on the validation. */
export function rankedRevealSides(match: MatchedJoin): RankedRunePair | null {
  const mine = mySeat(match);
  const theirs = facing(mine);
  const rune = (seat: Seat) => {
    const id = seat === 'p1' ? match.match.p1_rune : match.match.p2_rune;
    return id == null ? null : spellById(id) ?? undefined;
  };
  const [myRune, theirRune] = [rune(mine), rune(theirs)];
  if (myRune === undefined || theirRune === undefined) return null;
  return [
    { spell: myRune, name: () => match.names[mine], hue: 'var(--p1)' },
    { spell: theirRune, name: () => match.names[theirs], hue: 'var(--p2)' },
  ];
}

/* Trial calls the same seating translator after both private choices settle,
   then tightens the ordinary nullable contract: a Trial can never reveal an
   empty hand. */
export function trialRevealSides(match: MatchedJoin): TrialRevealPair | null {
  const sides = rankedRevealSides(match);
  if (!sides?.[0].spell || !sides[1].spell) return null;
  return [
    { ...sides[0], spell: sides[0].spell },
    { ...sides[1], spell: sides[1].spell },
  ];
}

/** WHO IS PLAYING WHOM, as the reveal's versus line wants it. Exported because
    the private Rune Trial choice opens on top of this reveal and shows the same
    pairing: two builders would be two chances for the ratings or the avatars to
    disagree across a screen boundary the player does not perceive. */
export function revealPairing(match: MatchedJoin): { me: DialSide; foe: DialSide } {
  const mine = mySeat(match);
  const side = (seat: Seat): DialSide => ({
    name: match.names[seat],
    rating: match.names.ratings?.[seat] ?? null,
    avatar: match.names.avatars?.[seat] ?? null,
  });
  return { me: side(mine), foe: side(facing(mine)) };
}

/** Run the reveal for one matched ranked row, resolving when the player is
    done with it. Only a Trial format has a private choice and paired rune beat;
    deciding that here keeps the format name out of the queue run. */
export async function revealRankedMatch(
  match: MatchedJoin,
  trial: (note: (text: string | null) => void) => Promise<TrialRevealPair | null>,
): Promise<boolean> {
  hide('#ovOnline');
  const isTrial = match.match.format === RUNE_TRIAL_FORMAT;
  if (!isTrial && !rankedRevealSides(match)) return false;
  await reveal({
    mode: { id: isTrial ? RUNE_TRIAL_FORMAT : modeById(match.match.modifier).id },
    modeCandidates: revealCandidates(match),
    modeCopy: revealCopy,
    trial: isTrial ? { resolve: trial } : undefined,
    ...revealPairing(match),
    peer: readyPeer(match.match.id),
  });
  return true;
}
