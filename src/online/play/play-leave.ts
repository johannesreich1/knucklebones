// Leaving a live ranked match. The confirmation already happened (flow/leave →
// boot, which asks what quitting costs); this is only what a confirmed forfeit
// then does.
import type { MatchRow } from '../api/match-api.ts';
import { resignedMatch } from '../api/match-resignation.ts';
import type { OnlineState } from './play-types.ts';

export interface OnlineLeavePorts {
  current(): OnlineState | null;
  isCurrent(online: OnlineState): boolean;
  freezeInput(): void;
  sync(fullRedraw: boolean): Promise<boolean>;
  applyMatchRow(match: MatchRow): void;
  resign?: typeof resignedMatch;
}

/**
 * Forfeit at the SERVER, immediately. The match flips, so the opponent's client
 * hears the row change and celebrates its win right away instead of waiting out
 * the stall clock, and the next pvp-join finds no active match to drag this
 * player back into.
 *
 * Returns TRUE — handled — which keeps this player on the board instead of
 * dropping them at the menu, so the settled row can carry them into the same
 * result screen the winner gets. A forfeit is still a finished match, and
 * hiding its verdict from the only person who chose it was the odd one out
 * among every other ending. The row arrives by whichever lands first: this
 * response, or the Realtime projection.
 *
 * Returns FALSE only when there is no live ranked match to lose, which is the
 * signal boot needs to perform its ordinary quit instead.
 */
export function leaveRankedMatch(ports: OnlineLeavePorts): boolean {
  const online = ports.current();
  if (!online || online.done) return false;
  if (online.resigning) return true;       // a second tap must not resign twice
  online.resigning = true;
  ports.freezeInput();
  void (async () => {
    const settled = await (ports.resign ?? resignedMatch)(online.matchId);
    if (!ports.isCurrent(online) || online.done) return;
    /* Cleared before the last await so a resignation the transport never
       landed can simply be asked for again, rather than stranding the player
       on a frozen board. resignedOver keeps retrying underneath either way,
       and the Realtime projection settles the screen the moment it does. */
    online.resigning = false;
    if (settled) ports.applyMatchRow(settled);
    // Settled by somebody else first (a stall claim, or the away forfeit): no
    // row comes back with that answer, so read the authoritative one.
    else await ports.sync(true);
  })();
  return true;
}
