// MY MOVE: animate IMMEDIATELY, in parallel with the server request — the die
// and column are both known at tap time, so the round-trip must never be felt.
// The rare server rejection falls back to a full log resync, which also reverts
// the optimistic board.
import { S } from '../../state.ts';
import { stopTimer } from '../../flow/timer.ts';
import { clearHints } from '../../ui/game/hints.ts';
import { move, type MatchRow } from '../api/match-api.ts';
import { newerMatchProjection } from './match-sync.ts';
import { animateOnlineMove, cancelOnlineReveal, playBotReply } from './play-motion.ts';
import { onlineOpponentName } from './play-identity.ts';
import type { OnlineState } from './play-types.ts';

/** What submitting a move needs from the view that owns the match. */
export interface MovePorts {
  /** Still this match, this generation? Every await must re-ask. */
  readonly isCurrent: () => boolean;
  /** Out of step — refetch the log, which is the truth. */
  readonly sync: (reset: boolean) => Promise<unknown>;
  readonly applyMatchRow: (m: MatchRow) => void;
  readonly onOpponentStalled: () => void;
  /** Rune Trial submits through the action log instead of a plain move. */
  readonly trialPlace: (col: number) => Promise<unknown>;
}

export async function submitOnlineMove(
  online: OnlineState,
  col: number,
  ports: MovePorts,
): Promise<void> {
  if (online.trial) {
    await ports.trialPlace(col);
    return;
  }
  const die = online.pendingDie;
  if (!die) return;
  stopTimer();
  cancelOnlineReveal();         // a running scramble must not fight the fly animation
  S.busy = true; S.phase = 'anim';
  clearHints();
  // the gate goes up BEFORE the request: the realtime echo of our own move can
  // arrive during the round-trip, and sync must not rebuild around it. Our
  // move's log slot is claimed up front too — it is our turn, so no other
  // move can take idx online.applied.
  online.animating = true;
  const expectedMoveCount = online.applied;
  online.applied += 1;
  const [r] = await Promise.all([
    move(online.matchId, col, expectedMoveCount),
    animateOnlineMove(online.you, col, die, ports.isCurrent),
  ]);
  if (!ports.isCurrent()) return;
  if (r.status !== 200 || !r.data?.match) {
    online.applied -= 1;              // un-claim; sync(true) resets it absolutely anyway
    online.animating = false;
    await ports.sync(true);           // out of step — the log is the truth
    return;
  }
  const bot = r.data.bot_move;
  if (bot) online.applied += 1;       // the bot's reply is committed server-side too
  online.lastMoveAt = Date.now();
  try {
    if (bot) await playBotReply(bot, {
      you: online.you,
      isCurrent: ports.isCurrent,
      opponentName: onlineOpponentName(online),
      onOpponentStalled: ports.onOpponentStalled,
    });
  } finally { if (ports.isCurrent()) online.animating = false; }
  if (!ports.isCurrent()) return;
  const row = newerMatchProjection(online.pendingRow, r.data.match);
  online.pendingRow = null;
  ports.applyMatchRow(row);   // may re-defer into pendingRow if a sync is mid-fetch
}
