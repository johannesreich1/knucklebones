// What pvp-rune-select does PAST the HTTP boundary — operation-level behaviour,
// not input parsing: a read-mode resume of a terminal Trial returns the settled
// row through the rune_trial_state RPC without touching matchmaking, the
// response still passes through the authoritative post-reveal finalizer with
// the caller's own auth context, and the ranked Trial bot opener is healed on
// both selection finalization and reconnect.
import { readFileSync } from 'node:fs';
import type { AuthenticatedContext } from '../../supabase/functions/_shared/http.ts';
import { selectRuneTrial } from '../../supabase/functions/pvp-rune-select/operation.ts';
import { verifyRuneTrialBotOpening } from './rune-trial-bot-opening-edge.ts';

type Check = (ok: boolean, message: string) => void;

export async function verifyRuneTrialSelectOperation(check: Check): Promise<void> {
  const resumeCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const terminalTrial = {
    match: { id: 'trial-1', status: 'forfeit', format: 'rune_trial', rune_rules_version: 1 },
    trial: { your_choice: 'ward' },
  };
  const resumeContext = {
    user: { id: 'player-1' }, authed: {},
    service: () => ({
      rpc: async (name: string, input: Record<string, unknown>) => {
        resumeCalls.push({ name, input });
        return { data: terminalTrial, error: null };
      },
    }),
  } as unknown as AuthenticatedContext;
  const terminalResume = await selectRuneTrial(resumeContext, {
    kind: 'read', matchId: 'trial-1',
  });
  check(terminalResume.status === 200
    && (JSON.parse(await terminalResume.text())).match.status === 'forfeit'
    && resumeCalls.length === 1 && resumeCalls[0].name === 'rune_trial_state'
    && resumeCalls[0].input.p_match_id === 'trial-1'
    && resumeCalls[0].input.p_actor === 'player-1',
    'terminal Trial resume mutated matchmaking or failed to return the settled row');
  let finalizerCalls = 0;
  const finalizedResume = await selectRuneTrial(resumeContext, {
    kind: 'read', matchId: 'trial-1',
  }, async (received, payload) => {
    finalizerCalls++;
    check(received === resumeContext, 'Rune Trial finalizer received the wrong auth context');
    return payload;
  });
  check(finalizedResume.status === 200 && finalizerCalls === 1,
    'Rune Trial selection response bypassed its authoritative post-reveal finalizer');

  const selectIndex = readFileSync('supabase/functions/pvp-rune-select/index.ts', 'utf8');
  const joinOperation = readFileSync('supabase/functions/pvp-join/operation.ts', 'utf8');
  const botOpeningSource = readFileSync(
    'supabase/functions/_shared/rune-trial-bot-opening.ts', 'utf8',
  );
  check(selectIndex.includes('ensureRuneTrialBotOpening')
      && joinOperation.includes('ensureRuneTrialBotOpening'),
    'selection finalization or reconnect no longer heals a missing ranked bot opener');
  check(botOpeningSource.includes('appendRankedBotTurn(')
      && botOpeningSource.includes('commitMatchAction(')
      && botOpeningSource.includes('actor: match.p1')
      && botOpeningSource.includes('expectedActionVersion: before.actionCount'),
    'ranked Trial bot opener bypasses shared replay or the atomic action command');
  await verifyRuneTrialBotOpening(check);
}
