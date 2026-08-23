// Settle the ranked client view after the server has already settled the
// match. This never computes authoritative scores or points; it only renders
// the returned row and heals the final board from the server-written log.
import { BOUNTY, ME, applyMove, boardTotalMode, emptyBoard, type Player } from '../core/rules.ts';
import { stopTimer } from '../flow/timer.ts';
import { S } from '../state.ts';
import { renderAll } from '../ui/game/board.ts';
import { setStatus, settleBoard } from '../ui/game/turn-state.ts';
import { supa } from './client.ts';
import type { MatchRow } from './match-api.ts';
import type { FinishReport, OnlineState } from './play-types.ts';

export function finishOnlineMatch(options: {
  online: OnlineState;
  match: MatchRow;
  opponentName: string;
  opponentSeat: 'p1' | 'p2';
  isCurrent: () => boolean;
  teardown: () => void;
  onFinished: ((report: FinishReport) => void) | null;
}): void {
  const { online, match } = options;
  if (online.done) return;
  online.done = true;
  stopTimer();

  void (async () => {
    const { data: rows } = await supa().from('match_moves')
      .select('idx, who, col, die').eq('match_id', online.matchId).order('idx');
    if (!rows || !options.isCurrent()) return;
    S.boards = [emptyBoard(), emptyBoard()];
    S.bounty = [0, 0];
    for (const row of rows) {
      const bounty = applyMove(S.boards, row.who as Player, row.col, row.die, S.scoring);
      if (S.scoring === BOUNTY) S.bounty[row.who as Player] += bounty;
    }
    renderAll(false);
  })();

  const bountyOf = (player: Player) => S.scoring === BOUNTY ? S.bounty[player] : 0;
  const meIsP1 = online.you === ME;
  const opponent = (1 - online.you) as Player;
  const mine = (meIsP1 ? match.p1_score : match.p2_score)
    ?? boardTotalMode(S.boards[online.you], S.scoring) + bountyOf(online.you);
  const theirs = (meIsP1 ? match.p2_score : match.p1_score)
    ?? boardTotalMode(S.boards[opponent], S.scoring) + bountyOf(opponent);
  const delta = (meIsP1 ? (match as any).p1_rating_delta : (match as any).p2_rating_delta) as number | null;
  const opponentDelta = (meIsP1 ? (match as any).p2_rating_delta : (match as any).p1_rating_delta) as number | null;
  const won = match.winner !== null
    && ((meIsP1 && match.winner === match.p1) || (!meIsP1 && match.winner === match.p2));

  setStatus('', null);
  settleBoard();
  const opponentJoinPoints = online.names.ratings?.[options.opponentSeat] ?? null;
  const report: FinishReport = {
    won,
    draw: match.winner === null,
    forfeit: match.status === 'forfeit',
    my: mine,
    their: theirs,
    delta,
    opp: options.opponentName,
    oppAvatar: online.names.avatars?.[options.opponentSeat] ?? null,
    oppRating: opponentJoinPoints != null ? opponentJoinPoints + (opponentDelta ?? 0) : null,
  };
  setTimeout(() => {
    if (!options.isCurrent()) return;
    options.teardown();
    options.onFinished?.(report);
  }, 1400);
}
