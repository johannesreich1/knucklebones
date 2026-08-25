// Manual Rune Trial casts and placements share one authoritative submission
// seam. Local state is frozen until the committed action log is projected.
import type { RankedActionIntent } from '../core/ranked-actions.ts';
import { spellById } from '../core/spells.ts';
import { disarm, renderSpells } from '../flow/spells.ts';
import { stopTimer } from '../flow/timer.ts';
import { S } from '../state.ts';
import { clearHints } from '../ui/game/hints.ts';
import { rankedAction, type MatchRow } from './match-api.ts';
import { newerMatchProjection } from './match-sync.ts';
import { cancelOnlineReveal } from './play-motion.ts';
import type { OnlineState } from './play-types.ts';

export interface TrialActionPorts {
  current(): OnlineState | null;
  isCurrent(online: OnlineState): boolean;
  sync(fullRedraw: boolean): Promise<boolean>;
  applyMatchRow(match: MatchRow): void;
}

const ACTION_TIMEOUT_MS = 12_000;

async function boundedAction(
  promise: ReturnType<typeof rankedAction>,
): Promise<Awaited<ReturnType<typeof rankedAction>> | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ACTION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createTrialActionSubmitter(ports: TrialActionPorts) {
  const submit = async (action: RankedActionIntent): Promise<boolean> => {
    const online = ports.current();
    if (!online?.trial || online.done || S.busy || S.turn !== online.you) return false;
    const submittedAtVersion = online.actionVersion;
    stopTimer();
    cancelOnlineReveal();
    S.busy = true;
    S.phase = 'anim';
    clearHints();
    renderSpells();
    online.animating = true;
    let response: Awaited<ReturnType<typeof rankedAction>> | null = null;
    try {
      response = await boundedAction(
        rankedAction(online.matchId, submittedAtVersion, action),
      );
    } catch { /* the authoritative log read below owns network recovery */ }
    if (!ports.isCurrent(online)) return false;
    online.animating = false;
    if (!response || response.status !== 200 || !response.data?.match) {
      const synced = await ports.sync(true);
      return ports.isCurrent(online) && synced
        && online.actionApplied > submittedAtVersion;
    }
    const committedVersion = response.data.action_version
      ?? response.data.match.action_version ?? submittedAtVersion + 1;
    online.actionVersion = committedVersion;
    online.lastMoveAt = Date.now();
    online.pendingRow = newerMatchProjection(online.pendingRow, response.data.match);
    const synced = await ports.sync(false);
    return ports.isCurrent(online) && synced
      && online.actionApplied >= committedVersion;
  };

  return {
    aim: async (id: string): Promise<boolean> => {
      const spell = spellById(id);
      if (!spell?.commitsOnAim) return false;
      return submit({ kind: 'aim', rune_id: id });
    },
    cast: async (id: string, column: number): Promise<boolean> => {
      const online = ports.current();
      if (!online?.trial || online.done || S.busy || S.turn !== online.you || !spellById(id)) {
        return false;
      }
      disarm(true);
      return submit({ kind: 'cast', rune_id: id, target_col: column });
    },
    place: async (column: number): Promise<boolean> => {
      if (S.spellAimCommitted) return false;
      disarm(true);
      return submit({ kind: 'place', placed_col: column });
    },
  };
}
