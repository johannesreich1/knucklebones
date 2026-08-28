// WHAT HAPPENS WHEN A TURN CLOCK REACHES ZERO — on either side of the board.
//
// Both handlers are armed by startTimer and fire long after they were wired, so
// neither may close over the match it was built for: `current()` is re-read at
// fire time, and a stale generation simply does nothing.
import { S } from '../../state.ts';
import { resolveTimedOutSpellAim } from '../../flow/spells.ts';
import { showAwayAutoPlayCountdown } from './play-copy.ts';
import type { OnlineState } from './play-types.ts';

export interface TurnClockPorts {
  /** The match on screen right now, or null once it has been torn down. */
  readonly current: () => OnlineState | null;
  /** Still this match, this generation? */
  readonly isCurrent: (online: OnlineState) => boolean;
  /** The one authoritative request; also the away/forfeit path. */
  readonly watchdog: () => Promise<void>;
}

export interface TurnClockHandlers {
  /** Their clock ran out. */
  readonly opponentStalled: () => void;
  /** Mine ran out. */
  readonly autoPlace: () => Promise<void>;
}

export function createTurnClockHandlers(ports: TurnClockPorts): TurnClockHandlers {
  /* their clock ran out: say so and let the watchdog decide if they are gone */
  const opponentStalled = (): void => {
    const online = ports.current();
    if (!online || online.done) return;
    showAwayAutoPlayCountdown({
      active: () => ports.isCurrent(online) && !online.done && S.turn !== online.you,
      lastMoveAt: () => online.lastMoveAt,
      who: S.turn,
    });
  };

  /* The turn clock ran out. Do not place from here — arm the watchdog's own-turn
     branch and kick it, so a visible self placement, an away page's self-nudge,
     and a clock that died without firing all reach the server through the one
     authoritative request. The server picks the same uniform legal column this
     used to pick locally, counts it against the away allowance, and past that
     allowance answers with a settled forfeit instead of a move. */
  const autoPlace = async (): Promise<void> => {
    const online = ports.current();
    if (!online || online.done || S.busy || S.turn !== online.you) return;
    // A committed rune aim was the player's own choice; resolve it before the
    // turn is handed over. An armed-but-uncommitted one only disarms.
    if (online.trial && await resolveTimedOutSpellAim()) return;
    if (!ports.isCurrent(online) || online.done || S.busy || S.turn !== online.you) return;
    online.selfAutoDue = true;
    await ports.watchdog();
  };

  return { opponentStalled, autoPlace };
}
