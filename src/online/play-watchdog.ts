// Ranked stall recovery. The server proves every timeout; this client only
// nudges authoritative endpoints and then projects their committed rows.
import { S } from '../state.ts';
import {
  claim as claimMatch,
  nudge,
  nudgeRankedAction,
  type MatchRow,
} from './match-api.ts';
import {
  completeProjectionRecovery,
  requireProjectionRecovery,
} from './play-recovery.ts';
import type { OnlineState } from './play-types.ts';

export interface OnlineWatchdogPorts {
  current(): OnlineState | null;
  isCurrent(online: OnlineState): boolean;
  initialPending(): boolean;
  retryInitial(): Promise<boolean>;
  sync(fullRedraw: boolean): Promise<boolean>;
  applyMatchRow(match: MatchRow): void;
  teardown(): void;
  now?(): number;
  hidden?(): boolean;
  nudgeAction?: typeof nudgeRankedAction;
  nudgeMove?: typeof nudge;
  claim?: typeof claimMatch;
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
  const recoverProjection = async (fullRedraw: boolean): Promise<boolean> => {
    let synced = false;
    try {
      synced = await ports.sync(fullRedraw);
    } catch { /* the recovery flag keeps the next watchdog tick armed */ }
    return ports.isCurrent(online)
      && completeProjectionRecovery(online, synced);
  };

  /* A failed post-command read is durable state, not a one-shot catch block.
     Retry it even on a visible own turn, where the normal stall branches are
     intentionally idle. */
  if (online.recoverySync) {
    if (!online.animating && !online.busySync) {
      await recoverProjection(true);
    }
    return;
  }

  const now = (): number => ports.now?.() ?? Date.now();
  const stalled = now() - online.lastMoveAt > 13_000;
  const askForAuto = async (): Promise<void> => {
    const response = online.trial
      ? await (ports.nudgeAction ?? nudgeRankedAction)(online.matchId, online.actionVersion)
      : await (ports.nudgeMove ?? nudge)(online.matchId, online.applied);
    if (!ports.isCurrent(online)) return;
    if (response.status === 200 && response.data?.match) {
      requireProjectionRecovery(online, online.trial
        ? response.data.action_version ?? response.data.match.action_version ?? null
        : null);
      const recovered = await recoverProjection(false);
      if (recovered) {
        ports.applyMatchRow(response.data.match);
      }
      return;
    }
    if (response.status === 425) return;
    /* A conflict or transport failure often means this client missed the
       projection that changed the turn. Make that repair survive visibility
       changes and future watchdog ticks. */
    const before = {
      actionApplied: online.actionApplied,
      applied: online.applied,
      done: online.done,
      lastMoveAt: online.lastMoveAt,
      turn: S.turn,
    };
    requireProjectionRecovery(online);
    const recovered = await recoverProjection(true);
    if (!ports.isCurrent(online)) return;
    const projectionAdvanced = recovered && (
      online.done !== before.done
      || online.lastMoveAt > before.lastMoveAt
      || S.turn !== before.turn
      || online.actionApplied > before.actionApplied
      || online.applied > before.applied
    );
    if (projectionAdvanced) return;
    /* A legacy pvp-move may not support auto placement. Preserve its previous
       forfeit fallback only after the longer authoritative stall window. A
       healthy read of the same stalled projection is not recovery. */
    if (now() - online.lastMoveAt > 35_000) {
      const fallback = await (ports.claim ?? claimMatch)(online.matchId);
      if (ports.isCurrent(online) && fallback.status === 200 && fallback.data?.match) {
        requireProjectionRecovery(online, online.trial
          ? fallback.data.match.action_version ?? null : null);
        if (await recoverProjection(true)) {
          ports.applyMatchRow(fallback.data.match);
        }
      }
    }
  };

  if (S.turn !== online.you && stalled) {
    await askForAuto();
  } else if (S.turn !== online.you) {
    void ports.sync(false).catch(() => undefined);
  } else if ((ports.hidden?.() ?? document.hidden) && stalled) {
    await askForAuto();
  }
}
