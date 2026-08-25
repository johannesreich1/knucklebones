// Local result presentation. The turn controller settles state and hands this
// module one immutable summary; this module owns the localized EndSpec only.
import { t } from '../i18n/index.ts';
import { showLocalizedEnd, type EndSpec } from '../ui/endscreen.ts';

export interface LocalResultSummary {
  tutorial: boolean;
  duo: boolean;
  drawn: boolean;
  playerOneWon: boolean;
  playerOneScore: number;
  playerTwoScore: number;
}

export interface LocalResultActions {
  finishTutorial: () => void;
  nextDuel: () => void;
  changeSetup: () => void;
  backToRanked?: () => void;
}

function localResultSpec(result: LocalResultSummary, actions: LocalResultActions): EndSpec {
  const { tutorial, duo, drawn, playerOneWon } = result;
  return {
    outcome: drawn ? 'draw' : (duo || playerOneWon) ? 'win' : 'lose',
    title: drawn ? t('game', 'result.deadHeat')
      : duo ? (playerOneWon ? t('game', 'result.player1Wins') : t('game', 'result.player2Wins'))
        : (playerOneWon ? t('game', 'result.victory') : t('game', 'result.defeat')),
    sub: drawn ? t('game', 'result.nobodyBlinks')
      : tutorial ? (playerOneWon ? t('game', 'result.tutorialWon')
                                  : t('game', 'result.tutorialLost'))
      /* Name the seat, never the hue: Settings may repaint the pair. */
      : duo ? (playerOneWon ? t('game', 'result.player1Round') : t('game', 'result.player2Round'))
             : (playerOneWon ? t('game', 'result.outRolled') : t('game', 'result.aiTakesRound')),
    you: {
      score: result.playerOneScore,
      label: duo ? t('game', 'player.player1') : t('game', 'player.you'),
    },
    them: {
      score: result.playerTwoScore,
      label: duo ? t('game', 'player.player2') : t('game', 'player.ai'),
    },
    /* Ordinary local results need no second score recap under the scoreline.
       Tutorial completion is distinct context and remains visible. */
    meta: tutorial ? t('game', 'result.tutorialCompleteMeta') : undefined,
    again: actions.backToRanked
      ? { label: t('game', 'action.backToRanked'), run: actions.backToRanked }
      : tutorial
      ? { label: t('game', 'action.finish'), run: actions.finishTutorial }
      : { label: t('game', 'action.nextDuel'), run: actions.nextDuel },
    quiet: tutorial || actions.backToRanked
      ? undefined
      : { label: t('game', 'action.changeSetup'), run: actions.changeSetup },
    delay: 900,
  };
}

export function showLocalResult(result: LocalResultSummary, actions: LocalResultActions): void {
  showLocalizedEnd(() => localResultSpec(result, actions));
}
