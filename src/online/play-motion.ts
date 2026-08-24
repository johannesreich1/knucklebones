// Ranked-only timing around the shared move/roll visuals. Server state decides
// what happens; this module supplies the human-readable beat between updates.
import { ONLINE_TURN_SECS } from '../config.ts';
import type { Player } from '../core/rules.ts';
import { startTimer, stopTimer } from '../flow/timer.ts';
import { S } from '../state.ts';
import { $ } from '../ui/dom.ts';
import { setStageDie } from '../ui/die.ts';
import { animateGameMove } from '../ui/game/move-view.ts';
import { animateStageRoll, clearStageRoll } from '../ui/game/motion.ts';
import { setActivePlate, setStatus } from '../ui/game/turn-state.ts';
import { opponentThinkingCopy } from './play-copy.ts';

let revealSequence = 0;
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function cancelOnlineReveal(): void {
  revealSequence++;
  clearStageRoll();
}

export function revealOnlineDie(die: number, who: Player): void {
  const current = $('#dieStage').firstElementChild as HTMLElement | null;
  if (current && +(current.dataset.v ?? 0) === die) {
    setStageDie(die, who);
    return;
  }
  const generation = S.gen;
  const sequence = ++revealSequence;
  void animateStageRoll({
    who,
    durationMs: 300,
    isCurrent: () => S.gen === generation && revealSequence === sequence,
    resolveDie: () => die,
  });
}

export async function animateOnlineMove(
  who: Player,
  column: number,
  die: number,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) return;
  await animateGameMove(who, column, die, {
    isCurrent,
    stageDieBeforeFlight: true,
    flyOnlyIntoOpenSlot: true,
  });
}

function botThinkMilliseconds(): number {
  const draw = Math.random();
  const duration = draw < 0.62 ? 260 + Math.random() * 620
    : draw < 0.92 ? 900 + Math.random() * 1500
    : 2500 + Math.random() * 2800;
  return Math.min(duration, ONLINE_TURN_SECS * 1000 - 1200);
}

export async function playBotReply(
  bot: { col: number; die: number },
  options: {
    you: Player;
    isCurrent: () => boolean;
    opponentName: () => string;
    onOpponentStalled: () => void;
  },
): Promise<void> {
  if (!options.isCurrent()) return;
  const opponent = (1 - options.you) as Player;
  S.turn = opponent;
  setActivePlate(options.you);
  setStatus(opponentThinkingCopy(options.opponentName), opponent);
  startTimer(options.onOpponentStalled, ONLINE_TURN_SECS);
  await pause(260);
  if (!options.isCurrent()) return;
  revealOnlineDie(bot.die, opponent);
  await pause(340);
  await pause(botThinkMilliseconds());
  if (!options.isCurrent()) return;
  stopTimer();
  await animateOnlineMove(opponent, bot.col, bot.die, options.isCurrent);
}
