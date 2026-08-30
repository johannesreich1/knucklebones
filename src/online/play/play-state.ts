import type { JoinResult } from '../api/match-api.ts';
import { RUNE_TRIAL_FORMAT } from '../../core/ranked-outcomes.ts';
import { defaultOnlineNames } from './play-copy.ts';
import type { OnlineState } from './play-types.ts';
import type { S } from '../../state.ts';

export function supportsRankedClientRules(
  match: Extract<JoinResult, { status: 'matched' }>['match'],
): boolean {
  return match.format !== RUNE_TRIAL_FORMAT
    || (match.protocol_version === 2 && match.rune_rules_version === 1);
}

/** Construct the mutable client projection for one authoritative match run. */
export function createOnlineState(
  result: Extract<JoinResult, { status: 'matched' }>,
  generation: number,
  restoreMode: typeof S.mode,
): OnlineState {
  if (!supportsRankedClientRules(result.match)) {
    throw new Error('Unsupported Rune Trial protocol or rules version.');
  }
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
    trial: result.match.format === RUNE_TRIAL_FORMAT,
    trialRunes: result.match.format === RUNE_TRIAL_FORMAT
      && result.match.p2_rune && result.match.p1_rune
      ? [result.match.p2_rune, result.match.p1_rune]
      : null,
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
       batch in a Trial, as the opening move in ordinary ranked — so the first
       read finds it already there and cannot tell it from history. The join
       response says a bot moved inside THAT request, which is the same claim a
       mid-game command response makes, and it is spent the same way.
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
