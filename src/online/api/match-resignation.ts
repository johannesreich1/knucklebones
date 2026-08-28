// The resignation latch — the ranked client's only module-level mutable state.
// A forfeit reaches the server through two independent routes (the quit tap in
// play-leave, and queue-cancellation's cleanup of a match discovered while
// leaving), so both must answer from ONE in-flight call: "is it over?" and
// "give me the terminal row" read the same promise, and a call that did not
// settle the match is re-issued rather than duplicated.
import { callFunction } from './client.ts';
import type { MatchRow } from './match-api.ts';

/** A finished resignation: whether the match is over, and the settled row when
    this call is the one that settled it. "match-over" means somebody else got
    there first, so there is no row here — read the authoritative one. */
interface Resignation { over: boolean; match: MatchRow | null }

let resigned: { matchId: string; done: Promise<Resignation> } | null = null;

const resignCall = async (matchId: string): Promise<Resignation> => {
  const response = await callFunction<{ match?: MatchRow; error?: string }>(
    'pvp-claim', { match_id: matchId, resign: true },
  );
  return {
    over: response.status === 200 || response.data?.error === 'match-over',
    match: response.status === 200 ? response.data?.match ?? null : null,
  };
};

export function resign(matchId: string): void {
  resigned = { matchId, done: resignCall(matchId) };
}

async function resignation(matchId: string): Promise<Resignation> {
  if (resigned?.matchId !== matchId) return { over: false, match: null };
  const first = await resigned.done;
  if (first.over) return first;
  resigned = { matchId, done: resignCall(matchId) };
  return resigned.done;
}

export async function resignedOver(matchId: string): Promise<boolean> {
  return (await resignation(matchId)).over;
}

/** Resign and wait for the terminal row, so the player who chose to forfeit
    reaches the same result screen their opponent does. */
export async function resignedMatch(matchId: string): Promise<MatchRow | null> {
  resign(matchId);
  return (await resignation(matchId)).match;
}
