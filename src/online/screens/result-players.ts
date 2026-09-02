import { currentInApex } from '../../ladder-presentation.ts';
import { t } from '../../i18n/index.ts';
import { cacheStanding, readProfileCache } from '../../profile-cache.ts';
import type { EndPlate } from '../../ui/endscreen-plates.ts';
import { setPlates } from '../../ui/endscreen-plates.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';
import {
  myLadderLookup,
  myStandingLookup,
  playerCard,
  type PlayerCard,
} from '../api/ladder-api.ts';
import { myProfile } from '../identity/profile.ts';
import { currentUser } from '../identity/session.ts';
import type { FinishReport } from '../play/play.ts';
import { showFaceoff, type MySide } from './faceoff.ts';

type ReturnDoor = (onReturn: () => void) => void;

interface ResultPlayerPorts {
  current(): boolean;
  cover(run: ReturnDoor): void;
  openProfile: ReturnDoor;
  openLadder: ReturnDoor;
}

export interface ResultPlayers {
  opponentName(): string;
  avatar(): string | null | undefined;
  plates(): EndPlate[];
  hydrate(): void;
}

/** Owns the two result identity plates and their late profile/ladder hydration. */
export function createResultPlayers(
  report: FinishReport,
  ports: ResultPlayerPorts,
): ResultPlayers {
  const cached = readProfileCache();
  const ownerAccountId = (report.ownerAccountId ?? cached?.accountId)?.toLowerCase() ?? null;
  let cache = !ownerAccountId || cached?.accountId?.toLowerCase() === ownerAccountId
    ? cached : null;
  const cachedPoints = typeof cache?.rating === 'number' ? cache.rating : null;
  const projectedPoints = cachedPoints !== null && report.delta != null
    ? cachedPoints + report.delta : cachedPoints;
  let visiblePoints: number | null = projectedPoints;
  /* A match delta changes points before a fresh standing can name its rank.
     Never pair that projected/new generation with the cached rank/apex. */
  const cachedTupleStillExact = report.delta == null || report.delta === 0;
  let visibleRank: number | null = cachedTupleStillExact ? cache?.rank ?? null : null;
  let visibleApex = cachedTupleStillExact && !!cache?.apex;
  let visibleFoe: PlayerCard | null = null;
  let visibleMine: MySide | null = null;

  const opponentName = (): string => report.opponentName?.() ?? report.opp;
  const plates = (): EndPlate[] => [
    {
      name: cache?.nickname ?? t('common', 'people.you'),
      avatar: cache?.avatar ?? null,
      points: visiblePoints,
      rank: visibleRank,
      apex: visibleApex,
      delta: report.delta,
      won: report.won,
      lost: !report.won && !report.draw,
      /* A forfeit is the one defeat that needs a stamp on the player's own
         plate: quitting or timing out is not the same as being out-rolled. */
      stamp: !report.won && !report.draw && report.forfeit
        ? t('online', 'result.forfeitedStamp') : undefined,
      /* The row is the ladder's door; its rank pill is the profile's. Both
         cover this result and return to the same still-live screen. */
      tap: () => ports.cover(ports.openLadder),
      rankTap: () => ports.cover(ports.openProfile),
    },
    {
      name: opponentName(),
      avatar: report.oppAvatar,
      points: visibleFoe?.points ?? report.oppRating,
      rank: visibleFoe?.rank ?? null,
      apex: !!visibleFoe?.apex,
      theirs: true,
      won: !report.won && !report.draw,
      lost: report.won,
      stamp: report.won ? (report.forfeit
        ? t('online', 'result.forfeitStamp') : t('online', 'result.beatenStamp')) : undefined,
      tap: visibleFoe && visibleFoe.points != null && visibleFoe.rank != null
        ? () => ports.cover((onReturn) => showFaceoff({
          nickname: opponentName(),
          points: visibleFoe!.points!,
          wins: visibleFoe!.wins ?? 0,
          losses: visibleFoe!.losses ?? 0,
          games: visibleFoe!.games ?? 0,
          rank: visibleFoe!.rank!,
          apex: visibleFoe!.apex,
          avatar: report.oppAvatar,
          peak: visibleFoe!.peak ?? 0,
        }, visibleMine, onReturn)) : undefined,
    },
  ];

  const hydrate = (): void => {
    void Promise.all([myProfile(), myStandingLookup(), myLadderLookup(), playerCard(opponentName())])
      .then(async ([profile, standingResult, ladderResult, foe]) => {
        const boundaryUser = await currentUser();
        if (!ports.current()) return;
        const accountId = profile?.id.toLowerCase() ?? null;
        if (!profile || accountId !== ownerAccountId
            || !ladderResult.ok || ladderResult.accountId !== accountId
            || boundaryUser?.id.toLowerCase() !== accountId) return;
        const ladder = ladderResult.ladder;
        const standingMatches = standingResult.ok && standingResult.accountId === accountId;
        const standing = standingMatches
          ? standingResult.standing : null;
        cache = { ...cache, nickname: profile.nickname, avatar: profile.avatar ?? null,
          rating: profile.rating };
        const points = standing?.points ?? profile?.rating ?? projectedPoints;
        const apex = standingMatches
          ? standing ? currentInApex(points ?? 0, standing.rank, standing.population) : false
          : visibleApex;
        if (standingMatches) {
          cacheStanding(profile.id, standing, apex);
        }
        refreshHomeChip();
        visiblePoints = points;
        visibleRank = standingMatches ? standing?.rank ?? null : null;
        visibleApex = standingMatches && apex;
        visibleFoe = foe;
        visibleMine = {
          name: profile.nickname,
          avatar: profile.avatar ?? null,
          lad: points == null ? ladder : { ...ladder, points },
          apex: visibleApex,
        };
        setPlates(plates());
      }).catch(() => undefined);
  };

  return {
    opponentName,
    avatar: () => cache?.avatar,
    plates,
    hydrate,
  };
}
