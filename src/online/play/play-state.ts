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
    autoStreak: 0,
    finalizing: false,
    done: false,
    limited: false,
  };
}
