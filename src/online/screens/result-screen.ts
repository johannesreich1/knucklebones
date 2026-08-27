import { inApex } from '../../core/ladder.ts';
import { formatNumber, t } from '../../i18n/index.ts';
import { $, hide } from '../../ui/dom.ts';
import {
  repaintEndLocale,
  showLocalizedEnd,
  setPlates,
  type EndSpec,
} from '../../ui/endscreen.ts';
import { refreshHomeChip } from '../../ui/homechip.ts';
import {
  myLadder,
  myStanding,
  playerCard,
  type PlayerCard,
} from '../api/ladder-api.ts';
import { showFaceoff, type MySide } from './faceoff.ts';
import { cacheStanding, myProfile } from '../identity/session.ts';
import {
  acknowledgeRuneReward,
  refreshRuneCollection,
  runeCollectionMatchesActiveAccount,
} from '../runes/rune-collection.ts';
import {
  acknowledgeRuneRewardWhenPresented,
  firstUnseenRuneReward,
  runeRewardFeature,
  type RuneRewardAcknowledgement,
  type RuneRewardPresentation,
} from '../runes/rune-reward-presentation.ts';
import type { FinishReport } from '../play/play.ts';

interface ResultPorts {
  goHome(): void;
  nextDuel(): void;
  openProfile(onReturn: () => void): void;
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
    let reward: RuneRewardPresentation | null = null;
    let rewardAcknowledgement: RuneRewardAcknowledgement | null = null;
    let rewardExplicitlyAcknowledged = false;
    let foreground = true;
    const opponentName = (): string => report.opponentName?.() ?? report.opp;
    const depart = (run: () => void, before?: () => void) => (): void => {
      if (revision !== showRevision) return;
      before?.();
      foreground = false;
      rewardAcknowledgement?.cancel();
      rewardAcknowledgement = null;
      showRevision++;
      run();
    };
    const armRewardAcknowledgement = (): void => {
      if (!reward || !foreground || revision !== showRevision) return;
      rewardAcknowledgement?.cancel();
      rewardAcknowledgement = acknowledgeRuneRewardWhenPresented(
        reward,
        $('#endFeature'),
        () => foreground && revision === showRevision && $('#ovEnd').classList.contains('on'),
      );
    };
    const acknowledgeRewardForAction = (): void => {
      if (!reward || rewardExplicitlyAcknowledged) return;
      rewardExplicitlyAcknowledged = true;
      const presentedReward = reward;
      const submitted = rewardAcknowledgement?.acknowledge() ?? null;
      rewardAcknowledgement = null;
      /* A temporary cover cancels the visibility watcher. Its return refresh
         can still be pending when the player immediately chooses TRY IT, so
         bind that explicit action directly to the already-presented reward.
         Both paths retry a failed/deadlined ACK after its de-duplication entry
         has cleared; an explicit CTA must durably consume the presentation. */
      const acknowledgement = submitted ?? acknowledgeRuneReward(
        presentedReward.accountId,
        presentedReward.rune.id,
      );
      void acknowledgement.then((acknowledged) => {
        if (!acknowledged) {
          void acknowledgeRuneReward(presentedReward.accountId, presentedReward.rune.id);
        }
      });
    };
    const resumeReward = (): void => {
      if (revision !== showRevision) return;
      foreground = true;
      const expectedRune = reward?.rune.id;
      if (!expectedRune) return;
      /* Profile may have presented/acknowledged the same durable row while it
         covered this result. Re-read before rearming, avoiding a stale second
         RPC while still restoring an unseen reward after a dismissed cover. */
      void refreshRuneCollection().then(async (collection) => {
        if (!foreground || revision !== showRevision) return;
        const ownsCollection = await runeCollectionMatchesActiveAccount(collection);
        if (!ownsCollection || !foreground || revision !== showRevision) return;
        if (firstUnseenRuneReward(collection)?.rune.id === expectedRune) {
          armRewardAcknowledgement();
        }
      }).catch(() => undefined);
    };
    const cover = (run: (onReturn: () => void) => void): void => {
      if (revision !== showRevision) return;
      foreground = false;
      rewardAcknowledgement?.cancel();
      rewardAcknowledgement = null;
      run(resumeReward);
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
        /* The winner's screen has always stamped the foe. A forfeit is the one
           ending the loser needs named on their OWN plate too — quitting, or
           being away too long, is not the same defeat as being out-rolled, and
           the scoreline alone cannot say which happened. */
        stamp: !report.won && !report.draw && report.forfeit
          ? t('online', 'result.forfeitedStamp') : undefined,
        tap: () => cover(ports.openProfile),
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
        tap: visibleFoe && visibleFoe.points != null && visibleFoe.rank != null ? () => cover((onReturn) => showFaceoff({
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
        feature: reward ? runeRewardFeature(
          reward,
          depart(
            () => ports.tryRune(reward!.rune.id, report),
            acknowledgeRewardForAction,
          ),
        ) : undefined,
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

    void refreshRuneCollection().then(async (collection) => {
      if (revision !== showRevision) return;
      const ownsCollection = await runeCollectionMatchesActiveAccount(collection);
      if (!ownsCollection || revision !== showRevision) return;
      /* A durable reward may predate this result. Never label that older win
         as a reward for the loss/draw currently on screen; entry/profile owns
         recovery when this report itself is not a settled win. */
      if (!report.won) return;
      reward = firstUnseenRuneReward(collection);
      if (!reward) return;
      repaintEndLocale();
      armRewardAcknowledgement();
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
