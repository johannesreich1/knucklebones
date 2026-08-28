// Manual Rune Trial casts and placements share one authoritative submission
// seam. Local state is frozen until the committed action log is projected.
import type { RankedActionIntent } from '../../core/ranked-actions.ts';
import { spellById } from '../../core/spells.ts';
import { disarm, renderSpells } from '../../flow/spells.ts';
import { stopTimer } from '../../flow/timer.ts';
import { S } from '../../state.ts';
import { clearHints } from '../../ui/game/hints.ts';
import { rankedAction, type MatchRow } from '../api/match-api.ts';
import { recoverIdempotentCommand } from '../api/idempotent-command.ts';
import { newerMatchProjection } from './match-sync.ts';
import { animateOnlineMove, cancelOnlineReveal } from './play-motion.ts';
import {
  completeProjectionRecovery,
  requireProjectionRecovery,
} from './play-recovery.ts';
import type { OnlineState } from './play-types.ts';
import { randomUuid } from '../api/random-id.ts';

export interface TrialActionPorts {
  current(): OnlineState | null;
  isCurrent(online: OnlineState): boolean;
  sync(fullRedraw: boolean): Promise<boolean>;
  applyMatchRow(match: MatchRow): void;
}

/* callFunction aborts at 15s. This outer guard trails that abort so it cannot
   abandon a still-running transport promise and reopen input underneath it. */
const ACTION_TIMEOUT_MS = 16_000;

async function safeSync(ports: TrialActionPorts, fullRedraw: boolean): Promise<boolean> {
  try {
    return await ports.sync(fullRedraw);
  } catch {
    return false;
  }
}

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
  /* `paint` is this client's own optimistic animation. It starts next to the
     request, exactly as the ordinary ranked path does with Promise.all, and is
     always awaited before anything syncs — the authoritative replay must never
     run while a paint is still in flight. */
  const submit = async (
    action: RankedActionIntent,
    paint?: () => Promise<void>,
  ): Promise<boolean> => {
    const online = ports.current();
    if (!online?.trial || online.done || online.recoverySync
        || S.busy || S.turn !== online.you) return false;
    const submittedAtVersion = online.actionVersion;
    const commandId = randomUuid();
    online.botBeatDue = false;
    requireProjectionRecovery(online);
    stopTimer();
    cancelOnlineReveal();
    S.busy = true;
    S.phase = 'anim';
    clearHints();
    renderSpells();
    online.animating = true;
    let response: Awaited<ReturnType<typeof rankedAction>> | null = null;
    const request = boundedAction(
      rankedAction(online.matchId, submittedAtVersion, action, commandId),
    );
    const painted = paint ? paint() : null;
    try {
      response = await request;
    } catch { /* the authoritative log read below owns network recovery */ }
    if (painted) await painted;
    if (!ports.isCurrent(online)) return false;
    online.animating = false;
    const uncertain = (candidate: typeof response): boolean => !candidate
      || candidate.status === 0 || candidate.status >= 500
      || (candidate.status === 200 && !candidate.data?.match);
    if (uncertain(response)) {
      /* One logical tap owns one command id until it is resolved. An aborted
         fetch may still be committing behind the Edge boundary; an unchanged
         read therefore keeps the input gate closed and replays only that id. */
      requireProjectionRecovery(online, submittedAtVersion + 1);
      const recovered = await recoverIdempotentCommand(response, {
        owns: () => ports.isCurrent(online),
        uncertain,
        observe: async () => {
          const synced = await safeSync(ports, true);
          return ports.isCurrent(online)
            && completeProjectionRecovery(online, synced)
            && online.actionApplied > submittedAtVersion;
        },
        replay: async () => await boundedAction(
          rankedAction(online.matchId, submittedAtVersion, action, commandId),
        ),
      });
      if (recovered.kind === 'observed') return true;
      if (recovered.kind === 'cancelled') return false;
      response = recovered.response;
    }
    if (!response || response.status !== 200 || !response.data?.match) {
      /* A real 4xx is a definitive rejection, so the speculative +1 target no
         longer applies. The coherent read below may safely reopen input. */
      online.recoveryActionVersion = null;
      const synced = await safeSync(ports, true);
      if (!ports.isCurrent(online)) return false;
      completeProjectionRecovery(online, synced);
      return synced
        && online.actionApplied > submittedAtVersion;
    }
    const committedVersion = response.data.action_version
      ?? response.data.match.action_version ?? submittedAtVersion + 1;
    requireProjectionRecovery(online, committedVersion);
    online.actionVersion = committedVersion;
    /* The bot's whole reply rode along inside this command. The rows are the
       server's, but the TURN is ours to perform — the replay below is the only
       place it can happen. Set before the sync that replays them. */
    online.botBeatDue = !!response.data.bot_actions?.length;
    online.lastMoveAt = Date.now();
    online.pendingRow = newerMatchProjection(online.pendingRow, response.data.match);
    const synced = await safeSync(ports, false);
    if (!ports.isCurrent(online)) return false;
    const projected = completeProjectionRecovery(online, synced);
    return projected && online.actionApplied >= committedVersion;
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
    /* A PLACEMENT IS NOT A CAST. A cast's outcome belongs to the server — which
       dice SUNDER destroys, what FATE rerolls — so it must wait for the log. A
       placement does not: the die is already public in `pendingDie` and the
       column is the tap, which is exactly what ordinary ranked animates from.
       Waiting here cost the player the whole round trip on the majority of
       their taps (measured: die on the board 336ms AFTER the response), on the
       path that is becoming the common one. Paint it next to the request, and
       let the replay skip the row this already drew. */
    place: async (column: number): Promise<boolean> => {
      if (S.spellAimCommitted) return false;
      disarm(true);
      const online = ports.current();
      /* The die is this path's ONLY extra precondition — there is nothing to
         paint without one. Every other reason to refuse belongs to submit, and
         it refuses before the paint is ever started, so stating them here too
         would only be a second copy to drift. */
      const die = online?.pendingDie ?? 0;
      if (!online || die <= 0) return submit({ kind: 'place', placed_col: column });
      online.optimisticPlace = { who: online.you, col: column, die };
      const placed = await submit(
        { kind: 'place', placed_col: column },
        () => animateOnlineMove(online.you, column, die,
          () => ports.isCurrent(online), S.charm),
      );
      /* A refused placement never entered the log, so nothing will arrive to
         match the marker; drop it or it would swallow a later real row. */
      if (!placed) online.optimisticPlace = null;
      return placed;
    },
  };
}
