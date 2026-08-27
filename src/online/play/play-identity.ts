// Ranked board identity is stable (P1/P2), while missing optional profile copy
// follows the active locale. Keep that distinction in one place so shared
// plates, ARIA, status copy, and the delayed result all resolve the same name.
import { ME, type Player } from '../../core/rules.ts';
import { claimPlayerNames } from '../../ui/identity.ts';
import { defaultOnlineNames } from './play-copy.ts';
import type { MatchNames, OnlineState } from './play-types.ts';

function names(online: OnlineState): MatchNames {
  return online.namesAreFallback ? defaultOnlineNames() : online.names;
}

export function onlinePlayerName(online: OnlineState, who: Player): string {
  return who === ME ? names(online).p1 : names(online).p2;
}

export function onlineOpponentSeat(online: OnlineState): 'p1' | 'p2' {
  return online.you === ME ? 'p2' : 'p1';
}

/** Safe to retain after teardown: it closes over this match, not global O. */
export function onlineOpponentName(online: OnlineState): () => string {
  const opponent = (1 - online.you) as Player;
  return () => onlinePlayerName(online, opponent);
}

export function claimOnlinePlayerNames(read: () => OnlineState | null): () => void {
  return claimPlayerNames((who) => {
    const online = read();
    return online ? onlinePlayerName(online, who) : null;
  });
}
