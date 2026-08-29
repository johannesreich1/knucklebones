import {
  historyPageArgs,
  ladderPageArgs,
  ladderPageBeforeArgs,
} from '../src/online/api/ladder-api.ts';
import { readFileSync } from 'node:fs';
import { createRunGeneration } from '../src/online/api/run-generation.ts';
import { createQueueCancellation } from '../src/online/api/queue-cancellation.ts';
import { createInitialSyncBoundary } from '../src/online/play/initial-sync.ts';
import { newerMatchProjection, readMatchSyncSnapshot } from '../src/online/play/match-sync.ts';
import { randomUuid } from '../src/online/api/random-id.ts';
import { joinResultFromResponse } from '../src/online/api/match-api.ts';
import {
  isMissingQueueLifecycleRpc,
  leaveQueueWithClient,
} from '../src/online/api/queue-lifecycle.ts';
import { localizedAuthError } from '../src/online/identity/session.ts';
import { rankedBadge } from '../src/online/play/play-copy.ts';
import { supportsRankedClientRules } from '../src/online/play/play-state.ts';
import { trialSelectionSettled } from '../src/online/runes/trial-offer.ts';
import { RUNE_TRIAL_PICK_SECS } from '../src/core/rune-trial-offer.ts';
import { setLanguageOverride, t } from '../src/i18n/index.ts';
import { emitReport } from './support/emit-report.mjs';

const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

check(joinResultFromResponse(409, { error: 'incompatible-client' })?.status === 'incompatible'
  && joinResultFromResponse(409, { error: 'unsupported-rune-rules' })?.status === 'incompatible'
  && joinResultFromResponse(500, { error: 'incompatible-client' }) === null,
  'join compatibility failures were not classified narrowly');
check(supportsRankedClientRules({ format: 'rune_trial', protocol_version: 2,
  rune_rules_version: 1 } as never)
  && !supportsRankedClientRules({ format: 'rune_trial', protocol_version: 1,
    rune_rules_version: 1 } as never)
  && !supportsRankedClientRules({ format: 'rune_trial', protocol_version: 2,
    rune_rules_version: 2 } as never),
  'the client did not fail closed on incompatible Rune Trial replay rules');
check(!trialSelectionSettled({ status: 'active' })
  && trialSelectionSettled({ status: 'done' })
  && trialSelectionSettled({ status: 'forfeit' }),
  'selection did not treat every server-terminal Trial as resolved');

const first = historyPageArgs(30);
check(JSON.stringify(first) === JSON.stringify({ limit_n: 30 }),
  'the first history page must not invent a cursor', first);

const cursor = { when: '2026-08-23T12:00:00.000Z', id: '00000000-0000-4000-8000-000000000042' };
const next = historyPageArgs(30, cursor);
check(next.before_t === cursor.when && next.before_id === cursor.id,
  'history pagination must send both members of the stable cursor', next);
check(Object.keys(next).sort().join(',') === 'before_id,before_t,limit_n',
  'history pagination sent an unexpected RPC argument', next);

const ladder = ladderPageArgs(25, 76, 'ZestyFalcon614');
check(JSON.stringify(ladder) === JSON.stringify({
  limit_n: 25,
  from_rank: 76,
  after_nickname: 'ZestyFalcon614',
}),
  'ladder pagination must match the SQL RPC argument names', ladder);
check(!('after_nickname' in ladderPageArgs(25, 76)),
  'the first ladder window must include its requested rank');

const ladderBefore = ladderPageBeforeArgs(25, 76, 'ZestyFalcon614');
check(JSON.stringify(ladderBefore) === JSON.stringify({
  limit_n: 25,
  before_rank: 76,
  before_nickname: 'ZestyFalcon614',
}),
  'reverse ladder pagination must send both members of the stable cursor', ladderBefore);

/* A boolean cancellation flag can become "active" again when a replacement
   run starts. Generations only move forward, so neither cancel nor begin can
   let an older await inherit the replacement run. */
const runs = createRunGeneration();
const firstRun = runs.begin();
check(runs.owns(firstRun), 'a newly begun queue run does not own itself');
runs.cancel();
check(!runs.owns(firstRun), 'cancelled queue work became current again');
const secondRun = runs.begin();
const thirdRun = runs.begin();
check(secondRun > firstRun && thirdRun > secondRun,
  'queue run generations are not monotonic', { firstRun, secondRun, thirdRun });
check(!runs.owns(firstRun) && !runs.owns(secondRun) && runs.owns(thirdRun),
  'a replacement queue run did not exclusively invalidate older awaits');

const deterministicUuid = randomUuid((bytes) => {
  bytes.set(Array.from({ length: 16 }, (_, index) => index));
});
check(deterministicUuid === '00010203-0405-4607-8809-0a0b0c0d0e0f'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(deterministicUuid),
  'the iOS-14-compatible command/nonce generator is not RFC 4122 UUIDv4', deterministicUuid);

const matchApiSource = readFileSync('src/online/api/match-api.ts', 'utf8');
const onlineClientSource = readFileSync('src/online/api/client.ts', 'utf8');
check(onlineClientSource.includes('new AbortController()')
  && onlineClientSource.includes('Promise.race([request, timeout])'),
  'online function calls have no bounded abort/recovery boundary');
const moveTransport = matchApiSource.slice(
  matchApiSource.indexOf('async function moveCommand'),
  matchApiSource.indexOf('export async function move('),
);
check(!moveTransport.includes('status === 0')
  && (moveTransport.match(/callFunction<MoveResult>\('pvp-move'/g) ?? []).length === 1,
  'new web can automatically replay a move against the old non-idempotent Edge Function');
const playSource = readFileSync('src/online/play/play.ts', 'utf8');
const trialSelectionSource = readFileSync('src/online/runes/trial-offer.ts', 'utf8');
check(trialSelectionSource.includes('readRuneTrialState(current.match.id)')
  && !trialSelectionSource.includes('join(false)'),
  'Rune Trial selection recovery can mutate matchmaking instead of reading its known match');
/* THE PICK WINDOW IS ONE NUMBER. The server stamps selection_deadline from it,
   the picker counts the same number down, and the queue's stall fallback waits
   the same span — three places that disagree the moment any of them restates
   it, so each must read the constant rather than carry a copy. */
check(RUNE_TRIAL_PICK_SECS === 10,
  'the Rune Trial pick window is no longer the documented 10 seconds', RUNE_TRIAL_PICK_SECS);
const trialStartSource = readFileSync('supabase/functions/pvp-join/start.ts', 'utf8');
check(trialStartSource.includes('RUNE_TRIAL_PICK_SECS * 1000')
  && !/Date\.now\(\) \+ \d/.test(trialStartSource),
  'the server stamps the selection deadline from its own number instead of the shared window',
  trialStartSource.match(/const deadline[^;]*/)?.[0] ?? null);
const trialPickerSource = readFileSync('src/ui/trial-select.ts', 'utf8');
check(trialPickerSource.includes("t('game', 'runeTrial.pickClock')")
  && trialPickerSource.includes('clock.hidden = !counting'),
  'the picker either does not count down, or counts down without a deadline to count to',
  null);
check(readFileSync('src/online/runes/trial-offer.ts', 'utf8')
  .includes('deadline: () => deadlineValue'),
  'ranked does not hand the picker the deadline it races, so the two can disagree', null);

/* A RANKED AIM IS OPTIMISTIC, so its refusal is load-bearing. arm() sets
   S.spellArmed before the server has accepted anything and paints nothing —
   ranked commits the aim server-side, so the die only lights when the log
   projects back. Discarding the transport result therefore left the player
   holding a rune the server had refused: unlit, uncastable, and unrecoverable
   short of restarting the app (device report 2026-08-29, against 5 real
   pvp-action 409s that day). This is a SOURCE pin, and a weaker thing than a
   painted assertion: reaching a refused aim in the harness needs ANVIL
   castable, which needs a full own column and a current die unlike the weakest
   in it. Tracked separately. */
const spellAimSource = readFileSync('src/flow/spell-aim.ts', 'utf8');
check(/transportSpellAim\(id\)\?\.then\(/.test(spellAimSource)
  && spellAimSource.includes('S.spellArmed = null;'),
'a refused ranked aim no longer disarms — the player keeps a rune the server refused',
null);

const trialActionSource = readFileSync('src/online/play/play-trial-actions.ts', 'utf8');
check(trialActionSource.includes('online.actionApplied >= committedVersion')
  && trialActionSource.includes('boundedAction(')
  && trialActionSource.includes('requireProjectionRecovery(online, committedVersion)')
  && trialActionSource.includes('recoverIdempotentCommand(response')
  && (trialActionSource.match(/submittedAtVersion, action, commandId/g) ?? []).length === 2,
  'Rune Trial input can reopen before its authoritative action version projects');
check(trialSelectionSource.includes('recoverIdempotentCommand(committed')
  && (trialSelectionSource.match(/selectedRune, commandId/g) ?? []).length === 2,
  'Rune Trial selection can replace an uncertain command with a fresh choice');
check(playSource.includes('sync: () => sync(true)') && !playSource.includes('if (res.rejoined)'),
  'fresh matches do not sync a possible old-backend bot opening move before input');
/* The optimistic move lives in play-move.ts; the terminal drain and the input
   freeze stay with the view that owns the match. Both halves of the gate are
   pinned, each where it actually is. */
const moveSource = readFileSync('src/online/play/play-move.ts', 'utf8');
check(moveSource.includes('newerMatchProjection(online.pendingRow, r.data.match)')
  && playSource.includes('freezeMatchInput();')
  && playSource.includes('drainTerminalProjection(online, m'),
  'ranked play is not consuming the monotonic terminal projection/input gate');

let initialAttempts = 0;
let initialReady = 0;
let initialWaiting = 0;
const initialSync = createInitialSyncBoundary({
  sync: async () => ++initialAttempts === 2,
  owns: () => true,
  onReady: () => { initialReady++; },
  onWaiting: () => { initialWaiting++; },
});
check(await initialSync.start() && initialAttempts === 2 && initialReady === 1
  && initialWaiting === 0 && !initialSync.pending(),
  'initial match sync did not use its bounded second attempt before opening input');
check(await initialSync.retry() && initialAttempts === 2 && initialReady === 1,
  'a completed initial sync performed more network work on watchdog retry');

let failedAttempts = 0;
const failedInitial = createInitialSyncBoundary({
  sync: async () => { failedAttempts++; return false; }, owns: () => true,
  onReady: () => undefined, onWaiting: () => { initialWaiting++; },
});
check(!await failedInitial.start() && failedAttempts === 2 && failedInitial.pending(),
  'failed initial sync exceeded its bounded entry retry budget', failedAttempts);
check(!await failedInitial.retry() && failedAttempts === 3,
  'watchdog recovery did not perform exactly one paced retry', failedAttempts);

let projectionReads = 0;
const readProjection = () => readMatchSyncSnapshot({
  moves: async () => ({ data: [] as Array<{ idx: number }>, error: null }),
  match: async () => ++projectionReads === 1
    ? { data: null, error: new Error('temporary match read failure') }
    : { data: { turn: 1 }, error: null },
});
check(await readProjection() === null,
  'a sync succeeded without an authoritative match projection');
const recoveredProjection = await readProjection();
check(recoveredProjection?.match.turn === 1 && projectionReads === 2,
  'an empty move-log delta permanently skipped projection recovery',
  { recoveredProjection, projectionReads });

/* A terminal bot reply can race an older Realtime callback that was deferred
   while the local and bot move animations ran. The terminal command response
   must win in either arrival order; otherwise the stale active row reopens a
   local turn even though the opponent's board is already full. */
const projection = (status: 'active' | 'done', when: string) => ({
  id: 'match-1', p1: 'player-1', p2: 'bot-1', status, turn: 1 as const,
  winner: status === 'done' ? 'bot-1' : null,
  p1_score: status === 'done' ? 52 : null,
  p2_score: status === 'done' ? 72 : null,
  p1_rating_delta: status === 'done' ? -5 : null,
  p2_rating_delta: status === 'done' ? 5 : null,
  next_die: status === 'done' ? null : 5,
  last_move_at: when,
  modifier: 'classic',
});
const staleActive = projection('active', '2026-08-24T20:14:00.000Z');
const terminalReply = projection('done', '2026-08-24T20:15:00.000Z');
check(newerMatchProjection(staleActive, terminalReply).status === 'done'
  && newerMatchProjection(terminalReply, staleActive).status === 'done',
  'a delayed active projection can outrank the terminal board-full response');
const newerActive = projection('active', '2026-08-24T20:16:00.000Z');
check(newerMatchProjection(newerActive, staleActive) === newerActive,
  'an older active Realtime callback can roll back the current turn projection');

/* A web release may briefly run against the preceding database schema. Only
   PostgREST's exact missing-function response may use the legacy RLS DELETE;
   arbitrary permission/outage errors must remain failures. */
const missingRpc = { code: 'PGRST202', message: 'Could not find public.leave_ranked_queue in the schema cache' };
check(isMissingQueueLifecycleRpc(missingRpc)
  && !isMissingQueueLifecycleRpc({ code: '42501', message: 'leave_ranked_queue permission denied' }),
  'queue lifecycle fallback did not narrowly classify the old-schema error');
let fallbackRpcCalls = 0;
const fallbackDeletes: Array<[string, string]> = [];
const fallback = await leaveQueueWithClient({
  rpc: async () => { fallbackRpcCalls++; return { data: null, error: missingRpc }; },
  auth: { getSession: async () => ({
    data: { session: { user: { id: 'player-1' } } }, error: null,
  }) },
  from: () => ({ delete: () => ({
    eq: async (column: string, value: string) => {
      fallbackDeletes.push([column, value]);
      return { error: null };
    },
  }) }),
});
check(fallback?.status === 'left' && fallbackRpcCalls === 1
  && JSON.stringify(fallbackDeletes) === JSON.stringify([['player_id', 'player-1']]),
  'missing lifecycle RPC did not fall back to one authenticated own-row delete',
  { fallback, fallbackRpcCalls, fallbackDeletes });

let retryCalls = 0;
const retriedLeave = await leaveQueueWithClient({
  rpc: async () => ({
    data: ++retryCalls === 2 ? { status: 'left' } : null,
    error: retryCalls === 1 ? { code: '503', message: 'temporary outage' } : null,
  }),
  auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }),
});
check(retriedLeave?.status === 'left' && retryCalls === 2,
  'queue leave did not perform exactly one bounded retry', { retriedLeave, retryCalls });

/* Cancellation calls are a serial boundary: the second leave represents the
   cleanup that runs after an in-flight join settles. It may not finish late
   and erase a replacement run that already enqueued. */
let releaseFirstLeave!: () => void;
const firstLeaveGate = new Promise<void>((resolve) => { releaseFirstLeave = resolve; });
let leaveCalls = 0;
const serialCancellation = createQueueCancellation({
  leaveQueue: async () => {
    leaveCalls++;
    if (leaveCalls === 1) await firstLeaveGate;
    return { status: 'left' };
  },
  resign: () => undefined,
  resignedOver: async () => true,
});
const firstCleanup = serialCancellation.cleanup();
const settledCleanup = serialCancellation.cleanup({ status: 'queued' });
await Promise.resolve();
check(leaveCalls === 1, 'cancel cleanups ran concurrently across the join race', leaveCalls);
releaseFirstLeave();
await Promise.all([firstCleanup, settledCleanup]);
check(leaveCalls === 2, 'a queued join result did not receive post-settlement cleanup', leaveCalls);

await serialCancellation.cleanup({ status: 'incompatible' });
check(leaveCalls === 2,
  'an incompatible active-match response mutated queue lifecycle state', leaveCalls);

/* If matching committed before cancellation, either the lifecycle RPC or the
   join response can discover it. Both routes converge on one confirmed resign
   rather than stranding the opponent or sending duplicate forfeits. */
const resigned: string[] = [];
const confirmed: string[] = [];
const matchedCancellation = createQueueCancellation({
  leaveQueue: async () => ({ status: 'matched', match_id: 'race-match' }),
  resign: (matchId) => { resigned.push(matchId); },
  resignedOver: async (matchId) => { confirmed.push(matchId); return true; },
});
await matchedCancellation.cleanup();
await matchedCancellation.cleanup({ status: 'matched', match: { id: 'race-match' } });
check(resigned.join(',') === 'race-match' && confirmed.join(',') === 'race-match',
  'matched cancellation did not converge on one confirmed resign', { resigned, confirmed });

/* Provider prose is not player copy. Stable provider codes map into the
   current catalog, and unknown messages fall back without leaking English
   returned by Supabase into a German or French screen. */
setLanguageOverride('de');
check(localizedAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' })
  === 'E-Mail oder Passwort ist falsch.',
  'known auth errors do not use the effective locale');
check(localizedAuthError({ code: 'email_address_invalid', message: 'Invalid email' })
  === 'Gib eine gültige E-Mail-Adresse ein.',
  'the exact invalid-email provider code is not localized');
check(localizedAuthError({ code: 'validation_failed', message: 'Some field failed validation' })
  === 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
  'the generic validation code was unsafely presented as an email error');
const unknownGerman = localizedAuthError({ code: 'future_provider_code', message: 'Raw provider English' });
check(unknownGerman === 'Etwas ist schiefgelaufen. Bitte versuche es erneut.'
  && !unknownGerman.includes('Raw provider English'),
  'unknown provider prose leaked through the localized error boundary', unknownGerman);
setLanguageOverride('en');
check(t('online', 'result.delta', { count: 1, points: '+1' }) === ' · +1 point'
  && t('online', 'result.delta', { count: 2, points: '+2' }) === ' · +2 points',
  'ranked result points do not select singular/plural copy');
check(t('online', 'matchmaking.cancel') === 'Cancel',
  'the English queue action is not concise');
setLanguageOverride('de');
check(t('online', 'matchmaking.cancel') === 'Abbrechen',
  'the German queue action should say only Abbrechen');
setLanguageOverride('fr');
check(t('online', 'matchmaking.cancel') === 'Annuler',
  'the French queue action is not concise');
setLanguageOverride('en');

const rankedChips = rankedBadge({ id: 'classic' })();
check(rankedChips.length === 1
  && rankedChips[0]?.lib === 'modes'
  && rankedChips[0]?.id === 'classic'
  && !rankedChips[0]?.html.includes('ONLINE'),
  'the ranked HUD should keep the shared mode chip without a redundant ONLINE tag', rankedChips);

emitReport({ problems, errs: [] }, problems.length);
