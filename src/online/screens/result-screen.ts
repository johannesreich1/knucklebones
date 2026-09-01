import { formatNumber, t } from '../../i18n/index.ts';
import { $, hide } from '../../ui/dom.ts';
import {
  repaintEndLocale,
  showLocalizedEnd,
  type EndSpec,
} from '../../ui/endscreen.ts';
import {
  acknowledgeRuneReward,
  refreshRuneCollection,
  runeCollectionMatchesActiveAccount,
} from '../runes/rune-collection.ts';
import {
  acknowledgeRuneRewardWhenPresented,
  firstCollectedRuneReward,
  firstUnseenRuneReward,
  runeRewardFeature,
  showRuneRewardSheet,
  type RuneRewardAcknowledgement,
  type RuneRewardPresentation,
  type RuneRewardSheet,
} from '../runes/rune-reward-presentation.ts';
import type { FinishReport } from '../play/play.ts';
import { rankedProgressionRecovery } from '../api/ranked-progression-api.ts';
import { createGroupTransitionScreen } from './group-transition-screen.ts';
import type { AccountShowOptions } from './account-screen.ts';
import { createResultPlayers } from './result-players.ts';

interface ResultPorts {
  goHome(): void;
  nextDuel(): void;
  openProfile(onReturn: () => void, options?: AccountShowOptions): void;
  openLadder(onReturn: () => void): void;
}

const TRANSITION_RUNE_DECISION_MS = 1200;

export interface ResultScreen {
  show(report: FinishReport): Promise<void>;
}

export function createResultScreen(ports: ResultPorts): ResultScreen {
  let showRevision = 0;
  const groupTransition = createGroupTransitionScreen();
  let activeRewardSheet: RuneRewardSheet | null = null;
  async function show(report: FinishReport): Promise<void> {
    const revision = ++showRevision;
    groupTransition.cancel();
    activeRewardSheet?.close();
    activeRewardSheet = null;
    hide('#ovOnline');
    $('#ovEnd').inert = false;
    let reward: RuneRewardPresentation | null = null;
    let pendingFirstRune: RuneRewardPresentation | null = null;
    let rewardAcknowledgement: RuneRewardAcknowledgement | null = null;
    let rewardExplicitlyAcknowledged = false;
    let foreground = true;
    const depart = (run: () => void, before?: () => void) => (): void => {
      if (revision !== showRevision) return;
      groupTransition.cancel();
      $('#ovEnd').inert = false;
      before?.();
      foreground = false;
      rewardAcknowledgement?.cancel();
      rewardAcknowledgement = null;
      activeRewardSheet?.close();
      activeRewardSheet = null;
      pendingFirstRune = null;
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
         can still be pending when the player immediately opens the reward
         card, so bind that explicit action directly to the already-presented
         reward. Both paths retry a failed/deadlined ACK after its
         de-duplication entry has cleared; an explicit tap must durably consume
         the presentation. */
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
      if (pendingFirstRune) {
        const waiting = pendingFirstRune;
        pendingFirstRune = null;
        void resumeFirstRuneReward(waiting).catch(() => {
          if (revision === showRevision) pendingFirstRune = waiting;
        });
        return;
      }
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
    const openRuneGuide = (
      deferredRuneReward?: RuneRewardPresentation,
      expectedAccountId: string | undefined = deferredRuneReward?.accountId,
    ): Promise<boolean> => new Promise((resolve) => {
      if (revision !== showRevision) {
        resolve(false);
        return;
      }
      cover((onReturn) => ports.openProfile(() => {
        onReturn();
        resolve(false);
      }, {
        runeGuide: {
          complete: () => resolve(true),
          cancel: () => resolve(false),
        },
        ...(expectedAccountId ? { expectedAccountId } : {}),
        ...(deferredRuneReward ? { deferredRuneReward } : {}),
      }));
    });
    const presentFirstRuneReward = (nextReward: RuneRewardPresentation): void => {
      if (revision !== showRevision) return;
      if (!foreground) {
        pendingFirstRune = nextReward;
        return;
      }
      let presentation!: RuneRewardSheet;
      const release = (): void => {
        if (activeRewardSheet === presentation) activeRewardSheet = null;
      };
      presentation = showRuneRewardSheet(nextReward, {
        owns: () => activeRewardSheet === presentation && foreground
          && revision === showRevision && $('#ovEnd').classList.contains('on'),
        actionLabel: () => t('online', 'profile.equipRune'),
        acknowledgement: 'deferred',
        onContinue: () => {
          release();
          void openRuneGuide(nextReward);
        },
      });
      activeRewardSheet = presentation;
    };
    const resumeFirstRuneReward = async (
      expected: RuneRewardPresentation,
    ): Promise<void> => {
      const latest = await refreshRuneCollection();
      if (!foreground || revision !== showRevision
          || !await runeCollectionMatchesActiveAccount(latest)) {
        if (revision === showRevision && !foreground) pendingFirstRune = expected;
        return;
      }
      const unseen = firstCollectedRuneReward(latest);
      if (unseen?.rune.id === expected.rune.id
          && unseen.row.source_match_id === expected.row.source_match_id
          && unseen.row.collected_at === expected.row.collected_at) {
        presentFirstRuneReward(unseen);
      }
    };
    const players = createResultPlayers(report, {
      current: () => revision === showRevision,
      cover,
      openProfile: (onReturn) => ports.openProfile(onReturn),
      openLadder: ports.openLadder,
    });
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
          ? t('online', 'result.opponentForfeited', { opponent: players.opponentName() })
          : t('online', 'result.matchForfeited'))
          : report.draw ? t('online', 'result.lastDie')
          : report.won ? t('online', 'result.outRolledOpponent', {
            opponent: players.opponentName(),
          })
          : t('online', 'result.opponentWins', { opponent: players.opponentName() }),
        you: { score: report.my, label: '' },
        them: { score: report.their, label: '' },
        plates: players.plates(),
        /* The card opens the rune's own entry over this screen — a cover, not
           a departure, so the result is still here when the sheet closes. */
        feature: reward ? runeRewardFeature(reward, acknowledgeRewardForAction) : undefined,
        again: { label: t('online', 'result.nextDuel'), icon: 'play', run: depart(ports.nextDuel) },
        quiet: { label: t('common', 'actions.home'), run: depart(ports.goHome) },
        share: t('online', 'result.share', {
          title,
          mine: formatNumber(report.my),
          theirs: formatNumber(report.their),
          opponent: players.opponentName(),
          delta: deltaText,
        }),
      };
    };
    showLocalizedEnd(endSpec);

    /* One verified collection read answers both decisions below: whether a
       SILVER transition may honestly offer Profile, and whether this result
       earned the player's first rune. Unknown fails closed to neither. */
    const collectionLookup = refreshRuneCollection().then(async (collection) => {
      if (revision !== showRevision) return null;
      const ownsCollection = await runeCollectionMatchesActiveAccount(collection);
      return ownsCollection && revision === showRevision ? collection : null;
    }).catch(() => null);
    const transitionCollectionLookup = Promise.race([
      collectionLookup,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), TRANSITION_RUNE_DECISION_MS);
      }),
    ]);

    /* The preload is tri-state: only a successful zero-row read means absent.
       Hold the result while retrying uncertainty and checking the owner-only
       unseen queue, so a prior failed read/ACK is recovered on a later result.
       One result drains at most eight rows; same-league rows acknowledge
       silently, while every real crossing owns its mandatory deck. */
    let progressionFlow: Promise<void> = Promise.resolve();
    if (report.matchId) {
      const initial = report.progression ?? { kind: 'retryable' as const };
      $('#ovEnd').inert = true;
      progressionFlow = (async () => {
        const handled = new Set<string>();
        let lookup = initial;
        for (let count = 0; count < 8; count++) {
          lookup = await rankedProgressionRecovery.recover(report.matchId!, lookup);
          if (revision !== showRevision || lookup.kind !== 'event') return;
          const { event } = lookup;
          if (handled.has(event.eventId)) return;
          handled.add(event.eventId);

          /* present() makes its own background snapshot synchronously. It must
             see the result enabled or closing the modal would restore a stale
             inert=true value and strand the result controls. */
          const collection = await transitionCollectionLookup;
          const ownsTransitionCollection = collection
            ? await runeCollectionMatchesActiveAccount(collection) : false;
          if (revision !== showRevision || !foreground) return;
          $('#ovEnd').inert = false;
          const action = await groupTransition.present(event, players.avatar(), {
            /* A rune earned by this same result still belongs to the separate
               NEW RUNE handoff below. Only an earlier collection turns the
               SILVER slide itself into the Profile tutorial door. */
            hasCollectedRune: ownsTransitionCollection && !!collection?.rows.some(
              ({ source_match_id }) => source_match_id !== report.matchId,
            ),
          });
          if (action === 'cancelled' || revision !== showRevision) return;
          if (action === 'profile') {
            /* Profile covers the result synchronously. Keep the result's true
               background state non-inert before the equipment sheet takes its
               modal snapshot; otherwise closing that nested sheet restores a
               stale inert=true and strands the result after Profile returns. */
            $('#ovEnd').inert = false;
            if (!await openRuneGuide(undefined, collection?.accountId ?? undefined)
                || revision !== showRevision) return;
            if (!await rankedProgressionRecovery.acknowledge(event.eventId)) return;
            /* Profile remains over this result. Never drain another transition
               deck behind the tutorial the player is using. */
            return;
          }
          $('#ovEnd').inert = true;
          if (!await rankedProgressionRecovery.acknowledge(event.eventId)) return;
          lookup = { kind: 'absent' };
        }
      })();
      void progressionFlow.catch(() => undefined).finally(() => {
        /* Profile is a modal cover over this still-open result. Its route owns
           the lock until Back/onReturn; finishing progression underneath must
           not make the covered result interactive again. */
        if (revision === showRevision && foreground) $('#ovEnd').inert = false;
      });
    }

    void (async () => {
      const collection = await collectionLookup;
      await progressionFlow.catch(() => undefined);
      if (!collection || revision !== showRevision) return;
      /* The mandatory deck may outlive an account replacement in another
         context. Re-bind the captured collection at the actual paint boundary
         so the new account never sees the old account's reward. */
      const ownsCollection = await runeCollectionMatchesActiveAccount(collection);
      if (!ownsCollection || revision !== showRevision) return;
      /* A durable reward may predate this result. Never label that older win
         as a reward for the loss/draw currently on screen; entry/profile owns
         recovery when this report itself is not a settled win. */
      if (!report.won) return;
      const nextReward = firstUnseenRuneReward(collection);
      if (!nextReward) return;
      const firstRune = firstCollectedRuneReward(collection);
      if (firstRune?.rune.id === nextReward.rune.id) {
        presentFirstRuneReward(firstRune);
        return;
      }
      if (!foreground) return;
      reward = nextReward;
      repaintEndLocale();
      armRewardAcknowledgement();
    })().catch(() => undefined);

    players.hydrate();
  }

  return { show };
}
