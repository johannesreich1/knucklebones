import type { JoinResult } from '../api/match-api.ts';
import {
  RUNE_TRIAL_FORMAT,
  STANDARD_FORMAT,
  usesRankedActionProtocol,
} from '../../core/ranked-outcomes.ts';
import { defaultOnlineNames } from './play-copy.ts';
import type { OnlineState } from './play-types.ts';
import type { S } from '../../state.ts';

export function supportsRankedClientRules(
  match: Extract<JoinResult, { status: 'matched' }>['match'],
): boolean {
  const format = match.format ?? STANDARD_FORMAT;
  if (format !== STANDARD_FORMAT && format !== RUNE_TRIAL_FORMAT) return false;
  if (match.rune_rules_version !== null && match.rune_rules_version !== undefined
      && match.rune_rules_version !== 1) return false;
  if (format === RUNE_TRIAL_FORMAT) return usesRankedActionProtocol(match);
  return match.rune_rules_version == null || usesRankedActionProtocol(match);
}

/** Construct the mutable client projection for one authoritative match run. */
export function createOnlineState(
  result: Extract<JoinResult, { status: 'matched' }>,
  generation: number,
  restoreMode: typeof S.mode,
): OnlineState {
  if (!supportsRankedClientRules(result.match)) {
    throw new Error('Unsupported ranked action protocol or rules version.');
  }
  const actionProtocol = usesRankedActionProtocol(result.match);
  return {
    matchId: result.match.id,
    you: result.you,
    names: result.names ?? defaultOnlineNames(),
    namesAreFallback: !result.names,
    restoreMode,
    pendingDie: result.match.next_die,
    applied: 0,
    actionApplied: 0,
    actionVersion: result.match.action_version ?? 0,
    actionProtocol,
    rankedRunes: actionProtocol
      ? [result.match.p2_rune ?? null, result.match.p1_rune ?? null]
      : null,
    trial: result.match.format === RUNE_TRIAL_FORMAT,
    gen: generation,
    channel: null,
    tick: null,
    lastMoveAt: Date.parse(result.match.last_move_at),
    busySync: false,
    animating: false,
    recoverySync: false,
    recoveryActionVersion: null,
    pendingRow: null,
    selfAutoDue: false,
    resigning: false,
    /* A BOT'S OPENING IS OWED A TURN, LIKE ANY OTHER BOT REPLY. The server bakes
       it into the match before this client ever reads the board — as an action
       batch under either action format, or as a move in legacy standard play —
       so the first read finds it already there and cannot tell it from history.
       The join response says a bot moved inside THAT request, which is the same
       claim a mid-game command response makes, and it is spent the same way.
       Only the response that committed it carries either field: a rejoin has
       neither, so reconnecting into a long match still paints silently. */
    botBeatDue: !!result.bot_actions?.length || !!result.bot_move,
    painted: null,
    autoStreak: 0,
    finalizing: false,
    done: false,
    limited: false,
  };
}
