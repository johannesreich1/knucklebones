// Local CPU policy. Search and scoring stay pure in core/; this typed seam
// selects difficulty and tutorial behaviour from the live game state.
import { searchRoot } from '../core/ai.ts';
import { placementCharm } from '../core/spells.ts';
import {
  AI,
  ME,
  SPEC,
  colScore,
  legalCols,
  type CharmSt,
  type GameState,
} from '../core/rules.ts';
import { S } from '../state.ts';

export function aiChoose(rootCharm?: CharmSt): number {
  const state: GameState = [
    S.boards[AI].map((column) => column.slice()),
    S.boards[ME].map((column) => column.slice()),
  ];
  const legal = legalCols(state[AI]);
  if (!legal.length) throw new Error('aiChoose requires a legal column');
  if (legal.length === 1) return legal[0];

  if (S.tut) {
    if (S.tut.cmoves.length) return S.tut.cmoves.shift()!;
    // Free play: the tutorial partner deliberately picks its least helpful
    // column so a guided first game remains a lesson rather than a wall.
    let worst = legal[0];
    let worstValue = Number.POSITIVE_INFINITY;
    for (const col of legal) {
      const gain = colScore(state[AI][col].concat([S.die])) - colScore(state[AI][col]);
      const kill = colScore(state[ME][col])
        - colScore(state[ME][col].filter((value) => value !== S.die));
      if (gain + kill < worstValue) {
        worstValue = gain + kill;
        worst = col;
      }
    }
    return worst;
  }

  /* An explicit projected charm belongs to a coordinated cast preview. An
     ordinary choice asks core for the placement charm — every persistent WARD,
     never a pending one-shot SUNDER, since Normal's 5% coordination slip is
     defined as a blind final placement for that spell. Ranked asks core the
     same question (core/ranked-bot-turn.ts). */
  const searchCharm = rootCharm ?? placementCharm(S.charm);

  const filled = state[AI].flat().length + state[ME].flat().length;
  let column: number;
  if (S.diff === 'easy') {
    if (Math.random() < 0.5) return legal[(Math.random() * legal.length) | 0];
    column = searchRoot(state, AI, S.die, 1, {
      mode: S.scoring, random: Math.random, riskWeight: 0, rootCharm: searchCharm, bounty: S.bounty,
    }).c;
  } else if (S.diff === 'medium') {
    column = searchRoot(state, AI, S.die, 2, {
      mode: S.scoring, random: Math.random, riskWeight: 0.9, rootCharm: searchCharm, bounty: S.bounty,
    }).c;
  } else {
    const started = performance.now();
    column = searchRoot(state, AI, S.die, 4, {
      mode: S.scoring, random: Math.random, riskWeight: 1.5, rootCharm: searchCharm, bounty: S.bounty,
    }).c;
    if (performance.now() - started < 18 && filled < SPEC.cols * SPEC.rows * 2 - 2) {
      column = searchRoot(state, AI, S.die, 5, {
        mode: S.scoring, random: Math.random, riskWeight: 1.5, rootCharm: searchCharm, bounty: S.bounty,
      }).c;
    }
  }
  return column;
}
