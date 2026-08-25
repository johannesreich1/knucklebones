// Ranked stall recovery. The server proves every timeout; this client only
// nudges authoritative endpoints and then projects their committed rows.
import { S } from '../state.ts';
import { claim, nudge, nudgeRankedAction, type MatchRow } from './match-api.ts';
import type { OnlineState } from './play-types.ts';

export interface OnlineWatchdogPorts {
  current(): OnlineState | null;
  isCurrent(online: OnlineState): boolean;
  initialPending(): boolean;
  retryInitial(): Promise<boolean>;
  sync(fullRedraw: boolean): Promise<boolean>;
  applyMatchRow(match: MatchRow): void;
  teardown(): void;
}

export async function runOnlineWatchdog(ports: OnlineWatchdogPorts): Promise<void> {
  const online = ports.current();
  if (!online) return;
  if (S.gen !== online.gen) return ports.teardown();
  if (online.done) return;
  if (ports.initialPending()) {
    await ports.retryInitial();
    return;
  }

  const stalled = Date.now() - online.lastMoveAt > 13_000;
  const askForAuto = async (): Promise<void> => {
    const response = online.trial
      ? await nudgeRankedAction(online.matchId, online.actionVersion)
      : await nudge(online.matchId, online.applied);
    if (!ports.isCurrent(online)) return;
    if (response.status === 200 && response.data?.match) {
      const synced = await ports.sync(false);
      const complete = !online.trial
        || online.actionApplied >= (response.data.match.action_version ?? online.actionApplied);
      if (ports.isCurrent(online) && synced && complete) {
        ports.applyMatchRow(response.data.match);
      }
      return;
    }
    if (response.status === 425) return;
    /* A legacy pvp-move may not support auto placement. Preserve its previous
       forfeit fallback only after the longer authoritative stall window. */
    if (Date.now() - online.lastMoveAt > 35_000) {
      const fallback = await claim(online.matchId);
      if (ports.isCurrent(online) && fallback.status === 200 && fallback.data?.match) {
        ports.applyMatchRow(fallback.data.match);
      }
    }
  };

  if (S.turn !== online.you && stalled) {
    await askForAuto();
  } else if (S.turn !== online.you) {
    void ports.sync(false);
  } else if (document.hidden && stalled) {
    await askForAuto();
    void ports.sync(false);
  }
}
