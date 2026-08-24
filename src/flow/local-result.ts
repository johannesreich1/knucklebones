// Local result presentation. The turn controller settles state and hands this
// module one immutable summary; this module owns the localized EndSpec only.
import { formatNumber, t } from '../i18n/index.ts';
import { showLocalizedEnd, type EndSpec } from '../ui/endscreen.ts';

export interface LocalResultSummary {
  tutorial: boolean;
  duo: boolean;
  drawn: boolean;
  playerOneWon: boolean;
  playerOneScore: number;
  playerTwoScore: number;
  session: {
    playerOneWins: number;
    playerTwoWins: number;
    ties: number;
    wins: number;
    losses: number;
    draws: number;
  };
}

export interface LocalResultActions {
  finishTutorial: () => void;
  nextDuel: () => void;
  changeSetup: () => void;
}

function localResultSpec(result: LocalResultSummary, actions: LocalResultActions): EndSpec {
  const { tutorial, duo, drawn, playerOneWon, session } = result;
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
    meta: tutorial ? t('game', 'result.tutorialCompleteMeta')
      : duo ? t('game', session.ties ? 'result.sessionDuoDraws' : 'result.sessionDuo', {
        p1: formatNumber(session.playerOneWins),
        p2: formatNumber(session.playerTwoWins),
        count: session.ties,
        formatted: formatNumber(session.ties),
      }) : t('game', session.draws ? 'result.sessionCpuDraws' : 'result.sessionCpu', {
        wins: formatNumber(session.wins),
        losses: formatNumber(session.losses),
        count: formatNumber(session.draws),
      }),
    again: tutorial
      ? { label: t('game', 'action.finish'), run: actions.finishTutorial }
      : { label: t('game', 'action.nextDuel'), run: actions.nextDuel },
    quiet: tutorial
      ? undefined
      : { label: t('game', 'action.changeSetup'), run: actions.changeSetup },
    delay: 900,
  };
}

export function showLocalResult(result: LocalResultSummary, actions: LocalResultActions): void {
  showLocalizedEnd(() => localResultSpec(result, actions));
}
