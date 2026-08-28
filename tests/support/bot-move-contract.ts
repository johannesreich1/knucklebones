/* core/bot botMove(): the ONE implementation both Edge Functions ask.
   Extracted from pvp-move 2026-08-22 so pvp-join can play a bot's OPENING move
   (a bot can be seated first now that the seat handicap applies to bots too).
   Equivalence to the block it replaced was proven off-gate at 113,400 calls
   across all 7 modes and all 7 groups, 0 differences; what is pinned HERE is
   the contract that keeps it safe to call from two places. */
import {
  AI, ME, emptyBoard, legalCols, CLASSIC, COLSHIELD,
  type Mode, type GameState,
} from '../../src/core/rules.ts';
import { searchRoot } from '../../src/core/ai.ts';
import { GROUPS, botShapeAt } from '../../src/core/ladder.ts';
import { botMove } from '../../src/core/bot.ts';
import { seeded } from './policy-duel-bench.ts';

type Check = (ok: boolean, message: string, detail?: unknown) => void;

export function checkBotMoveContract(check: Check): void {
  const st0: GameState = [emptyBoard(), emptyBoard()];
  // an OPENING move on an empty board is the case pvp-join newly depends on
  for (const g of GROUPS) {
    const c = botMove(st0, ME, 4, g.floor + 10, CLASSIC, seeded(7));
    check(c >= 0 && c < 3, 'botMove must open with a legal column: ' + g.id, c);
  }
  // deterministic given the SAME stream — replay and the gate both need this.
  const mid: GameState = [[[5, 5], [2], []], [[4], [6, 6], [1]]];
  for (const mode of [CLASSIC, COLSHIELD] as Mode[]) {
    const a = botMove(mid, AI, 4, 2020, mode, seeded(99));
    const b = botMove(mid, AI, 4, 2020, mode, seeded(99));
    check(a === b, 'botMove must be deterministic on one seeded stream', { mode, a, b });
  }
  // STONE's negative opponent weight is a promise across BOTH branches and
  // BOTH seats. A random slip may build badly; it may not become a perfect
  // attack when a score-preserving column exists. The same safe-slip rule is
  // the explicit handicap for any bot that opens as ME/p1.
  const draws = (...values: number[]) => {
    let index = 0;
    return () => values[index++] ?? 0;
  };
  const botAsAI: GameState = [[[], [], []], [[6, 6], [], []]];
  const botAsME: GameState = [[[6, 6], [], []], [[], [], []]];
  const sparedFromAI = botMove(botAsAI, AI, 6, 0, CLASSIC, draws(0, 0));
  const sparedFromME = botMove(botAsME, ME, 6, 0, CLASSIC, draws(0, 0));
  check(sparedFromAI !== 0 && sparedFromME !== 0 && sparedFromAI === sparedFromME,
    'STONE random slip attacked a double six or changed meaning with its seat',
    { sparedFromAI, sparedFromME });
  const searchedFromAI = botMove(botAsAI, AI, 6, 0, CLASSIC, draws(0.99, 0.5, 0.5, 0.5));
  const searchedFromME = botMove(botAsME, ME, 6, 0, CLASSIC, draws(0.99, 0.5, 0.5, 0.5));
  check(searchedFromAI === 1 && searchedFromME === 1,
    'STONE search reversed its negative opponent weight when the bot became p1/ME',
    { searchedFromAI, searchedFromME });
  const boneAttack = botMove(botAsAI, AI, 6, GROUPS[1].floor, CLASSIC, draws(0, 0));
  check(boneAttack === 0,
    'the bot-opener handicap leaked into a promoted bot seated second', boneAttack);
  const boneOpenerSpared = botMove(botAsME, ME, 6, GROUPS[1].floor, CLASSIC, draws(0, 0));
  check(boneOpenerSpared !== 0,
    'a promoted bot opener turned its handicap slip into a double-six attack', boneOpenerSpared);
  // it must never answer with a column it cannot play
  const nearlyFull: GameState = [[[1, 2, 3], [1, 2, 3], [4]], [[], [], []]];
  for (let i = 0; i < 60; i++) {
    const c = botMove(nearlyFull, AI, 1 + (i % 6), GROUPS[i % GROUPS.length].floor + 10, CLASSIC, seeded(i));
    check(legalCols(nearlyFull[AI]).includes(c), 'botMove returned an illegal column', { i, c });
  }
  // a full board has nothing to answer with, and says so rather than guessing
  const full: GameState = [[[1, 2, 3], [1, 2, 3], [1, 2, 3]], [[], [], []]];
  check(botMove(full, AI, 4, 0, CLASSIC, seeded(1)) === -1, 'a bot with no legal column must return -1');
  // Search options are per call: a ranked bot cannot change how the next
  // offline search in the same process plays.
  const independent = () => searchRoot(mid, AI, 4, 2, {
    mode: CLASSIC, random: seeded(515), riskWeight: 0.9, opponentWeight: 1,
  }).c;
  const before = independent();
  botMove(mid, AI, 4, 0, CLASSIC, seeded(3));          // STONE: risk 0, oppW -0.5
  const after = independent();
  check(before === after, 'botMove leaked configuration into an independent search', { before, after });
  check(botShapeAt(0).oppW === -0.5, 'STONE is still the kill-averse shape botMove borrows', botShapeAt(0));
}
