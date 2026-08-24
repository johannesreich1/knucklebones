import type { MatchRow } from './match-api.ts';

interface ReadResult<T> {
  data: T | null;
  error: unknown;
}

interface MatchSyncReads<Move, Match> {
  moves(): Promise<ReadResult<Move[]>>;
  match(): Promise<ReadResult<Match>>;
}

export interface MatchSyncSnapshot<Move, Match> {
  moves: Move[];
  match: Match;
}

/**
 * Keep the client match projection monotonic while Realtime callbacks, a sync
 * read, and the move response race one another. A terminal row is absorbing:
 * no delayed active update may reopen input after the server ended the match.
 * Among active rows, `last_move_at` is the server-owned ordering key.
 */
export function newerMatchProjection(current: MatchRow | null, incoming: MatchRow): MatchRow {
  if (!current) return incoming;
  const currentTerminal = current.status !== 'active';
  const incomingTerminal = incoming.status !== 'active';
  if (currentTerminal || incomingTerminal) {
    if (currentTerminal !== incomingTerminal) return incomingTerminal ? incoming : current;
    return current;
  }
  const currentAt = Date.parse(current.last_move_at);
  const incomingAt = Date.parse(incoming.last_move_at);
  if (Number.isFinite(currentAt) && Number.isFinite(incomingAt) && incomingAt < currentAt) {
    return current;
  }
  return incoming;
}

/** A sync is authoritative only when both the move log and match projection read. */
export async function readMatchSyncSnapshot<Move, Match>(
  reads: MatchSyncReads<Move, Match>,
): Promise<MatchSyncSnapshot<Move, Match> | null> {
  const moves = await reads.moves();
  if (moves.error || !moves.data) return null;
  const match = await reads.match();
  if (match.error || !match.data) return null;
  return { moves: moves.data, match: match.data };
}
