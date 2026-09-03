// EVERY READ A PLAYER WAITS ON MUST BE ABLE TO END, AND MAY HEAL ITSELF ONCE.
//
// Split out of tests/online-api.test.ts, which owns the online transport's
// argument and response contracts; this owns the two properties that decide
// whether a screen can strand a player. Both are read from source, because
// they are wiring rather than behaviour: the behaviour has its own browser
// scenario (tests/browser/online-ui/scenarios/ladder-recovery.mjs).
//
// `check` arrives from the entry suite so a failure lands in the array its
// exit code reads.
import { readFileSync } from 'node:fs';

type Check = (condition: boolean, message: string, detail?: unknown) => void;

/* A read carries a deadline when its builder is given the shared abort signal.
   Match the call, then look ahead far enough to cover the chained filters. */
const carriesDeadline = (source: string, read: string): boolean => {
  const calls = [...source.matchAll(new RegExp(read.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'))];
  return calls.length > 0
    && calls.every(({ index }) => source.slice(index, index + 160).includes('.abortSignal('));
};

export function runOnlineReadContractCases(check: Check): void {
  /* PostgREST carries no timeout of its own, so a hung connection used to
     leave the Ladder and the Profile rank waiting with nothing to show and
     nothing to press (user report, 3 Sep 2026). */
  const clientSource = readFileSync('src/online/api/client.ts', 'utf8');
  check(clientSource.includes('export async function readWithin'),
    'the shared read deadline is gone; a hung read can strand a screen again');
  const ladderApiSource = readFileSync('src/online/api/ladder-api.ts', 'utf8');
  const profileSource = readFileSync('src/online/identity/profile.ts', 'utf8');
  for (const [name, source, reads] of [
    ['ladder-api', ladderApiSource, ["rpc('player_standing'", "rpc('active_ranked_curve_version'"]],
    ['profile', profileSource, ["from('profiles')\n      .select('id, nickname"]],
  ] as const) {
    for (const read of reads) {
      check(carriesDeadline(source, read),
        `${name} has a screen-facing read outside the shared deadline`, read);
    }
  }
  /* An access token lives an hour. When the library's own refresh has already
     failed it deletes the session and answers from a cached failure, so the
     read that a player is watching has to ask for a new one itself — once. */
  check(ladderApiSource.includes('isAuthRefusal(first.error)')
    && profileSource.includes('isAuthRefusal(first.error)')
    && ladderApiSource.includes('currentUserOrRecover')
    && profileSource.includes('currentUserOrRecover'),
  'an expired session no longer heals itself: a refused read is reported without one refresh');
}
