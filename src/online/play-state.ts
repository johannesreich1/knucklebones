import type { JoinResult } from './match-api.ts';
import { defaultOnlineNames } from './play-copy.ts';
import type { OnlineState } from './play-types.ts';

/** Construct the mutable client projection for one authoritative match run. */
export function createOnlineState(
  result: Extract<JoinResult, { status: 'matched' }>,
  generation: number,
): OnlineState {
  return {
    matchId: result.match.id,
    you: result.you,
    names: result.names ?? defaultOnlineNames(),
    namesAreFallback: !result.names,
    pendingDie: result.match.next_die,
    applied: 0,
    gen: generation,
    channel: null,
    tick: null,
    lastMoveAt: Date.parse(result.match.last_move_at),
    busySync: false,
    animating: false,
    pendingRow: null,
    done: false,
    limited: false,
  };
}
