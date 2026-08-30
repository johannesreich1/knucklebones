// Ranked-only timing around the shared move/roll visuals. Server state decides
// what happens; this module supplies the human-readable beat between updates.
import { ONLINE_TURN_SECS } from '../../config.ts';
import type { CharmSt, Player } from '../../core/rules.ts';
import { startTimer, stopTimer } from '../../flow/timer.ts';
import { handTurnTo } from '../../flow/turn.ts';
import { S } from '../../state.ts';
import { $, show } from '../../ui/dom.ts';
import { setStageDie } from '../../ui/die.ts';
import { animateGameMove } from '../../ui/game/move-view.ts';
import { animateStageRoll, clearStageRoll } from '../../ui/game/motion.ts';
import { setStatus } from '../../ui/game/turn-state.ts';
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
  charm?: CharmSt,
): Promise<void> {
  if (!isCurrent()) return;
  await animateGameMove(who, column, die, {
    isCurrent,
    stageDieBeforeFlight: true,
    flyOnlyIntoOpenSlot: true,
    charm,
  });
}

function botThinkMilliseconds(): number {
  const draw = Math.random();
  const duration = draw < 0.62 ? 260 + Math.random() * 620
    : draw < 0.92 ? 900 + Math.random() * 1500
    : 2500 + Math.random() * 2800;
  return Math.min(duration, ONLINE_TURN_SECS * 1000 - 1200);
}

export interface OpponentTurnOptions {
  you: Player;
  isCurrent: () => boolean;
  opponentName: () => string;
  onOpponentStalled: () => void;
}

/* THE OPPONENT'S TURN IS PERFORMED, NOT ANNOUNCED. A bot has no request loop,
   so the server commits its whole reply inside the human's own command — in
   legacy standard play as `bot_move`, and in either action-protocol format as
   extra action rows. Replayed as they arrive, the machine answers in the same
   frame the player taps, which is exactly what gives a bot away.
   So the beat is shared rather than owned by one driver: the seat changes
   hands (the rune rail's forward card follows it), the status names who is
   thinking, their die is rolled in the open, the countdown runs in THEIR
   colour, and the think is drawn at random. Answers false once the match this
   was opened for is no longer the one on screen. */
export async function openOpponentTurn(
  opponent: Player,
  die: number | null,
  options: OpponentTurnOptions,
): Promise<boolean> {
  if (!options.isCurrent()) return false;
  handTurnTo(opponent, options.you);
  setStatus(opponentThinkingCopy(options.opponentName), opponent);
  startTimer(options.onOpponentStalled, ONLINE_TURN_SECS);
  await pause(260);
  if (!options.isCurrent()) return false;
  if (die) revealOnlineDie(die, opponent);
  await pause(340);
  await pause(botThinkMilliseconds());
  if (!options.isCurrent()) return false;
  stopTimer();
  return true;
}

export async function playBotReply(
  bot: { col: number; die: number },
  options: OpponentTurnOptions,
): Promise<void> {
  const opponent = (1 - options.you) as Player;
  if (!await openOpponentTurn(opponent, bot.die, options)) return;
  await animateOnlineMove(opponent, bot.col, bot.die, options.isCurrent);
}

/* THE AWAY WARNING, RAISED ONCE. The turn painter runs on every state change,
   so showing and hiding it there took the card away a moment after it appeared
   and the player only saw it flash past mid-game (user report). Its own copy
   promises "tap anywhere to keep playing", so the tap retires it
   (boot/menu-bindings.ts); the latch on the match state stops the next paint
   putting back one the player has already dismissed, and being per-match it
   needs no teardown. */
export function raiseAwayWarning(state: { awayWarned?: boolean }, away: boolean): void {
  if (away && !state.awayWarned) show('#ovAway');
  state.awayWarned = away;
}
