import { inApex } from '../core/ladder.ts';
import { spellById, type SpellSpec } from '../core/spells.ts';
import { formatNumber, spellCopy, t } from '../i18n/index.ts';
import { $, hide } from '../ui/dom.ts';
import {
  repaintEndLocale,
  showLocalizedEnd,
  setPlates,
  type EndSpec,
} from '../ui/endscreen.ts';
import { refreshHomeChip } from '../ui/homechip.ts';
import { spellHue, spellIcon } from '../ui/spellicons.ts';
import {
  myLadder,
  myStanding,
  playerCard,
  type PlayerCard,
} from './ladder-api.ts';
import { showFaceoff, type MySide } from './faceoff.ts';
import { cacheStanding, myProfile } from './session.ts';
import { acknowledgeRuneReward, refreshRuneCollection } from './rune-collection.ts';
import type { FinishReport } from './play.ts';

interface ResultPorts {
  goHome(): void;
  nextDuel(): void;
  openProfile(): void;
  tryRune(runeId: string, report: FinishReport): void;
}

export interface ResultScreen {
  show(report: FinishReport): Promise<void>;
}

export function createResultScreen(ports: ResultPorts): ResultScreen {
  let showRevision = 0;
  async function show(report: FinishReport): Promise<void> {
    const revision = ++showRevision;
    hide('#ovOnline');
    let rewardRune: SpellSpec | null = null;
    const opponentName = (): string => report.opponentName?.() ?? report.opp;
    const depart = (run: () => void) => (): void => {
      if (revision !== showRevision) return;
      showRevision++;
      run();
    };
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
        feature: rewardRune ? {
          className: 'rune-reward',
          hue: spellHue(rewardRune.id),
          icon: spellIcon(rewardRune.id, 24),
          kicker: t('online', 'result.newRune'),
          title: spellCopy(rewardRune.id).name,
          body: spellCopy(rewardRune.id).blurb,
          action: {
            label: t('online', 'result.tryIt'),
            run: depart(() => ports.tryRune(rewardRune!.id, report)),
          },
        } : undefined,
        again: { label: t('online', 'result.nextDuel'), run: depart(ports.nextDuel) },
        quiet: { label: t('common', 'actions.home'), run: depart(ports.goHome) },
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

    void refreshRuneCollection().then((collection) => {
      if (revision !== showRevision) return;
      rewardRune = spellById(collection.unseen[0]?.rune_id);
      if (!rewardRune) return;
      repaintEndLocale();
      const shownRune = rewardRune;
      setTimeout(() => {
        if (revision === showRevision && !$('#endFeature').hidden
            && $('#ovEnd').classList.contains('on')) {
          void acknowledgeRuneReward(shownRune.id);
        }
      }, 0);
    }).catch(() => undefined);

    void Promise.all([myProfile(), myStanding(), myLadder(), playerCard(opponentName())])
      .then(([profile, standing, ladder, foe]) => {
        if (revision !== showRevision) return;
        if (profile) {
          cache = { ...cache, nickname: profile.nickname, avatar: profile.avatar ?? null,
            rating: profile.rating };
        }
        const points = standing?.points ?? profile?.rating ?? cachedRating;
        const apex = standing ? inApex(points ?? 0, standing.rank, standing.population) : false;
        cacheStanding(standing?.rank ?? null, apex);
        refreshHomeChip();
        visiblePoints = points;
        visibleRank = standing?.rank ?? null;
        visibleApex = apex;
        visibleFoe = foe;
        visibleMine = profile && ladder
          ? { name: profile.nickname, avatar: profile.avatar ?? null, lad: ladder }
          : null;
        setPlates(plates());
      }).catch(() => undefined);
  }

  return { show };
}
