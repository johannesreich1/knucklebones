import { currentInApex } from '../../ladder-presentation.ts';
import { t } from '../../i18n/index.ts';
import { cacheStanding, readProfileCache } from '../../profile-cache.ts';
import type { EndPlate } from '../../ui/endscreen-plates.ts';
import { setPlates } from '../../ui/endscreen-plates.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';
import {
  myLadder,
  myStanding,
  playerCard,
  type PlayerCard,
} from '../api/ladder-api.ts';
import { myProfile } from '../identity/profile.ts';
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
  let cache = readProfileCache();
  const cachedRating = typeof cache?.rating === 'number' && report.delta != null
    ? cache.rating + report.delta : null;
  let visiblePoints: number | null = cachedRating;
  let visibleRank: number | null = cache?.rank ?? null;
  let visibleApex = !!cache?.apex;
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
    void Promise.all([myProfile(), myStanding(), myLadder(), playerCard(opponentName())])
      .then(([profile, standing, ladder, foe]) => {
        if (!ports.current()) return;
        if (profile) {
          cache = { ...cache, nickname: profile.nickname, avatar: profile.avatar ?? null,
            rating: profile.rating };
        }
        const points = standing?.points ?? profile?.rating ?? cachedRating;
        const apex = standing
          ? currentInApex(points ?? 0, standing.rank, standing.population) : false;
        cacheStanding(standing?.rank ?? null, apex);
        refreshHomeChip();
        visiblePoints = points;
        visibleRank = standing?.rank ?? null;
        visibleApex = apex;
        visibleFoe = foe;
        visibleMine = profile && ladder
          ? { name: profile.nickname, avatar: profile.avatar ?? null, lad: ladder, apex }
          : null;
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
