import { inApex } from '../core/ladder.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { hide } from '../ui/dom.ts';
import { showLocalizedEnd, setPlates, type EndSpec } from '../ui/endscreen.ts';
import { refreshHomeChip } from '../ui/homechip.ts';
import {
  myLadder,
  myStanding,
  playerCard,
  type PlayerCard,
} from './ladder-api.ts';
import { showFaceoff, type MySide } from './faceoff.ts';
import { cacheStanding, myProfile } from './session.ts';
import type { FinishReport } from './play.ts';

interface ResultPorts {
  goHome(): void;
  nextDuel(): void;
  openProfile(): void;
}

export interface ResultScreen {
  show(report: FinishReport): Promise<void>;
}

export function createResultScreen(ports: ResultPorts): ResultScreen {
  async function show(report: FinishReport): Promise<void> {
    hide('#ovOnline');
    const opponentName = (): string => report.opponentName?.() ?? report.opp;
    let cache: {
      nickname?: string;
      rating?: number;
      avatar?: string | null;
      rank?: number;
      apex?: boolean;
    } | null = null;
    try {
      cache = JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null');
    } catch { /* forgetful host */ }
    const cachedRating = typeof cache?.rating === 'number' && report.delta != null
      ? cache.rating + report.delta : null;
    let visiblePoints: number | null = cachedRating;
    let visibleRank: number | null = cache?.rank ?? null;
    let visibleApex = !!cache?.apex;
    let visibleFoe: PlayerCard | null = null;
    let visibleMine: MySide | null = null;

    const plates = () => [
      {
        name: cache?.nickname ?? t('common', 'people.you'),
        avatar: cache?.avatar ?? null,
        points: visiblePoints,
        rank: visibleRank,
        apex: visibleApex,
        delta: report.delta,
        won: report.won,
        lost: !report.won && !report.draw,
        tap: ports.openProfile,
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
        tap: visibleFoe && visibleFoe.points != null && visibleFoe.rank != null ? () => showFaceoff({
          nickname: opponentName(),
          points: visibleFoe!.points!,
          wins: visibleFoe!.wins ?? 0,
          losses: visibleFoe!.losses ?? 0,
          games: visibleFoe!.games ?? 0,
          rank: visibleFoe!.rank!,
          apex: visibleFoe!.apex,
          avatar: report.oppAvatar,
          peak: visibleFoe!.peak ?? 0,
        }, visibleMine) : undefined,
      },
    ];
    const endSpec = (): EndSpec => {
      const title = report.draw ? t('game', 'result.deadHeat')
        : report.won ? t('game', 'result.victory') : t('game', 'result.defeat');
      const deltaText = report.delta != null
        ? t('online', 'result.delta', {
          count: Math.abs(report.delta),
          points: `${report.delta >= 0 ? '+' : ''}${formatNumber(report.delta)}`,
        }) : '';
      return {
        outcome: report.draw ? 'draw' : report.won ? 'win' : 'lose',
        title,
        sub: report.forfeit ? (report.won
          ? t('online', 'result.opponentForfeited', { opponent: opponentName() })
          : t('online', 'result.matchForfeited'))
          : report.draw ? t('online', 'result.lastDie')
          : report.won ? t('online', 'result.outRolledOpponent', { opponent: opponentName() })
          : t('online', 'result.opponentWins', { opponent: opponentName() }),
        you: { score: report.my, label: '' },
        them: { score: report.their, label: '' },
        plates: plates(),
        again: { label: t('online', 'result.nextDuel'), run: ports.nextDuel },
        quiet: { label: t('common', 'actions.home'), run: ports.goHome },
        share: t('online', 'result.share', {
          title,
          mine: formatNumber(report.my),
          theirs: formatNumber(report.their),
          opponent: opponentName(),
          delta: deltaText,
        }),
      };
    };
    showLocalizedEnd(endSpec);
    const [profile, standing, ladder, foe] = await Promise.all([
      myProfile(),
      myStanding(),
      myLadder(),
      playerCard(opponentName()),
    ]);
    if (profile) {
      cache = {
        ...cache,
        nickname: profile.nickname,
        avatar: profile.avatar ?? null,
        rating: profile.rating,
      };
    }
    const points = standing?.points ?? profile?.rating ?? cachedRating;
    const apex = standing ? inApex(points ?? 0, standing.rank, standing.population) : false;
    cacheStanding(standing?.rank ?? null, apex);
    refreshHomeChip();
    const mine: MySide | null = profile && ladder
      ? { name: profile.nickname, avatar: profile.avatar ?? null, lad: ladder }
      : null;
    visiblePoints = points;
    visibleRank = standing?.rank ?? null;
    visibleApex = apex;
    visibleFoe = foe;
    visibleMine = mine;
    setPlates(plates());
  }

  return { show };
}
