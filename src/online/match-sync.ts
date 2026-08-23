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
