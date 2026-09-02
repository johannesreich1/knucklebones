// Settle the ranked client view after the server has already settled the
// match. This never computes authoritative scores or points; it only renders
// the returned row and heals the final board from the server-written log.
import { BOUNTY, ME, applyMove, emptyBoard, totalOf, type Player } from '../../core/rules.ts';
import { stopTimer } from '../../flow/timer.ts';
import { S } from '../../state.ts';
import { renderAll } from '../../ui/game/board.ts';
import { setStatus, settleBoard } from '../../ui/game/turn-state.ts';
import { supa } from '../api/client.ts';
import type { MatchRow } from '../api/match-api.ts';
import { rankedProgressionRecovery } from '../api/ranked-progression-api.ts';
import type { FinishReport, OnlineState } from './play-types.ts';

export function finishOnlineMatch(options: {
  online: OnlineState;
  match: MatchRow;
  opponentName: () => string;
  opponentSeat: 'p1' | 'p2';
  isCurrent: () => boolean;
  teardown: () => void;
  onFinished: ((report: FinishReport) => void) | null;
}): void {
  const { online, match } = options;
  if (online.done) return;
  online.done = true;
  stopTimer();

  if (!online.actionProtocol) void (async () => {
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
    ?? totalOf(S.boards[online.you], bountyOf(online.you), S.scoring, S.charm.wards[online.you]);
  const theirs = (meIsP1 ? match.p2_score : match.p1_score)
    ?? totalOf(S.boards[opponent], bountyOf(opponent), S.scoring, S.charm.wards[opponent]);
  const delta = (meIsP1 ? (match as any).p1_rating_delta : (match as any).p2_rating_delta) as number | null;
  const opponentDelta = (meIsP1 ? (match as any).p2_rating_delta : (match as any).p1_rating_delta) as number | null;
  const won = match.winner !== null
    && ((meIsP1 && match.winner === match.p1) || (!meIsP1 && match.winner === match.p2));

  setStatus('', null);
  settleBoard();
  const opponentJoinPoints = online.names.ratings?.[options.opponentSeat] ?? null;
  const report: FinishReport = {
    matchId: match.id,
    ownerAccountId: meIsP1 ? match.p1 : match.p2,
    won,
    draw: match.winner === null,
    forfeit: match.status === 'forfeit',
    my: mine,
    their: theirs,
    delta,
    opp: options.opponentName(),
    opponentName: options.opponentName,
    oppAvatar: online.names.avatars?.[options.opponentSeat] ?? null,
    oppRating: opponentJoinPoints != null ? opponentJoinPoints + (opponentDelta ?? 0) : null,
  };
  /* Settlement and this terminal row commit together. Spend the board's
     existing 1.4s final hold loading the owner-only event. The recovery seam
     bounds the wait but preserves timeout/error as retryable, never as proof
     that no mandatory deck exists. */
  const progression = rankedProgressionRecovery.preload(match.id);
  setTimeout(() => {
    void progression.then((event) => {
      if (!options.isCurrent()) return;
      options.teardown();
      options.onFinished?.({ ...report, progression: event });
    });
  }, 1400);
}
