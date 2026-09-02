/* core/bot botMove(): the ONE implementation both Edge Functions ask.
   Extracted from pvp-move 2026-08-22 so pvp-join can play a bot's OPENING move
   (a bot can be seated first now that the seat handicap applies to bots too).
   Equivalence to the block it replaced was proven off-gate at 113,400 calls
   across all 7 modes and all 7 groups, 0 differences; what is pinned HERE is
   the contract that keeps it safe to call from two places. */
import {
  AI, ME, emptyBoard, legalCols, CLASSIC, COLSHIELD, ROWSWITCH,
  type Mode, type GameState,
} from '../../src/core/rules.ts';
import { searchRoot } from '../../src/core/ai.ts';
import {
  APEX,
  GROUPS,
  LADDER_CURVE_V1,
  LADDER_CURVE_V2,
  botShapeAt,
  type BotStanding,
} from '../../src/core/ladder.ts';
import {
  botMove, botMoveWithShape, botSearch, botSlipPick, declinesFreeUpgrade, scoreColumns,
} from '../../src/core/bot.ts';
import { seeded } from './policy-duel-bench.ts';

type Check = (ok: boolean, message: string, detail?: unknown) => void;

const standing = (points: number, apex = false): BotStanding => ({ points, apex });

export function checkBotMoveContract(check: Check): void {
  const st0: GameState = [emptyBoard(), emptyBoard()];
  // an OPENING move on an empty board is the case pvp-join newly depends on
  for (const g of GROUPS) {
    const c = botMove(st0, ME, 4, standing(g.floor + 10, g === APEX), CLASSIC, LADDER_CURVE_V2, seeded(7));
    check(c >= 0 && c < 3, 'botMove must open with a legal column: ' + g.id, c);
  }
  // deterministic given the SAME stream — replay and the gate both need this.
  const mid: GameState = [[[5, 5], [2], []], [[4], [6, 6], [1]]];
  for (const mode of [CLASSIC, COLSHIELD] as Mode[]) {
    const a = botMove(mid, AI, 4, standing(2020), mode, LADDER_CURVE_V2, seeded(99));
    const b = botMove(mid, AI, 4, standing(2020), mode, LADDER_CURVE_V2, seeded(99));
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
  const sparedFromAI = botMove(botAsAI, AI, 6, standing(0), CLASSIC, LADDER_CURVE_V2, draws(0, 0));
  const sparedFromME = botMove(botAsME, ME, 6, standing(0), CLASSIC, LADDER_CURVE_V2, draws(0, 0));
  check(sparedFromAI !== 0 && sparedFromME !== 0 && sparedFromAI === sparedFromME,
    'STONE random slip attacked a double six or changed meaning with its seat',
    { sparedFromAI, sparedFromME });
  const searchedFromAI = botMove(
    botAsAI, AI, 6, standing(0), CLASSIC, LADDER_CURVE_V2, draws(0.99, 0.5, 0.5, 0.5),
  );
  const searchedFromME = botMove(
    botAsME, ME, 6, standing(0), CLASSIC, LADDER_CURVE_V2, draws(0.99, 0.5, 0.5, 0.5),
  );
  check(searchedFromAI === 1 && searchedFromME === 1,
    'STONE search reversed its negative opponent weight when the bot became p1/ME',
    { searchedFromAI, searchedFromME });
  const boneAttack = botMove(
    botAsAI, AI, 6, standing(GROUPS[1].floor), CLASSIC, LADDER_CURVE_V2, draws(0, 0),
  );
  check(boneAttack === 0,
    'the bot-opener handicap leaked into a promoted bot seated second', boneAttack);
  const boneOpenerSpared = botMove(
    botAsME, ME, 6, standing(GROUPS[1].floor), CLASSIC, LADDER_CURVE_V2, draws(0, 0),
  );
  check(boneOpenerSpared !== 0,
    'a promoted bot opener turned its handicap slip into a double-six attack', boneOpenerSpared);
  // it must never answer with a column it cannot play
  const nearlyFull: GameState = [[[1, 2, 3], [1, 2, 3], [4]], [[], [], []]];
  for (let i = 0; i < 60; i++) {
    const g = GROUPS[i % GROUPS.length];
    const c = botMove(
      nearlyFull, AI, 1 + (i % 6), standing(g.floor + 10, g === APEX),
      CLASSIC, LADDER_CURVE_V2, seeded(i),
    );
    check(legalCols(nearlyFull[AI]).includes(c), 'botMove returned an illegal column', { i, c });
  }
  // a full board has nothing to answer with, and says so rather than guessing
  const full: GameState = [[[1, 2, 3], [1, 2, 3], [1, 2, 3]], [[], [], []]];
  check(botMove(full, AI, 4, standing(0), CLASSIC, LADDER_CURVE_V2, seeded(1)) === -1,
    'a bot with no legal column must return -1');
  // Search options are per call: a ranked bot cannot change how the next
  // offline search in the same process plays.
  const independent = () => searchRoot(mid, AI, 4, 2, {
    mode: CLASSIC, random: seeded(515), riskWeight: 0.9, opponentWeight: 1,
  }).c;
  const before = independent();
  botMove(mid, AI, 4, standing(0), CLASSIC, LADDER_CURVE_V2, seeded(3)); // STONE: risk 0, oppW -0.5
  const after = independent();
  check(before === after, 'botMove leaked configuration into an independent search', { before, after });
  check(botShapeAt(standing(0)).oppW === -0.5,
    'STONE is still the kill-averse shape botMove borrows', botShapeAt(standing(0)));
  check(botShapeAt(standing(300), LADDER_CURVE_V1) === GROUPS[1].bot
      && botShapeAt(standing(300), LADDER_CURVE_V2) === GROUPS[0].bot,
    'bot league classification ignored the authoritative staged curve');
  // A shape named directly decides exactly as the standing that resolves to
  // it: the bench measures shapes, production passes standings, one seam.
  for (const [k, g] of GROUPS.entries()) {
    const byShape = botMoveWithShape(mid, AI, 4, g.bot, CLASSIC, seeded(40 + k));
    const byStanding = botMove(
      mid, AI, 4, standing(g.floor + 10, g === APEX), CLASSIC, LADDER_CURVE_V2, seeded(40 + k),
    );
    check(byShape === byStanding, 'botMove and botMoveWithShape diverged for ' + g.id,
      { byShape, byStanding });
  }
  // The apex POSITION, not the points, decides which shape a top bot plays.
  // One draw between the two league slips: OBSIDIAN slips on it (any-column
  // pick lands on column 1), NEON searches on it (kills the double six).
  check(GROUPS[5].bot.slip > GROUPS[6].bot.slip,
    'this contract needs NEON to slip less often than OBSIDIAN');
  const between = (GROUPS[5].bot.slip + GROUPS[6].bot.slip) / 2;
  const demoted = botMove(
    botAsAI, AI, 6, standing(APEX.floor + 10, false), CLASSIC, LADDER_CURVE_V2,
    draws(between, 0.5, 0.5, 0.5),
  );
  const crowned = botMove(
    botAsAI, AI, 6, standing(APEX.floor + 10, true), CLASSIC, LADDER_CURVE_V2,
    draws(between, 0.5, 0.5, 0.5),
  );
  check(demoted === 1 && crowned === 0,
    'the apex POSITION, not the points, decides whether a top bot attacks the double six',
    { demoted, crowned });
  // The free-upgrade predicate on the photographed position (2026-09-02):
  // an Obsidian bot holding [6],[4,4],[] under ROWS with a 4 in hand played
  // the middle column for 18 when either side column paid 26, and the
  // human's [6],[5],[3] was untouched either way. The scorer and the
  // predicate are the ones production consults, so the bench's
  // unforced-error metric and the slip filter cannot disagree about it.
  const photographed: GameState = [[[6], [4, 4], []], [[6], [5], [3]]];
  const scored = scoreColumns(photographed, AI, 4, ROWSWITCH);
  check(scored.every((score) => score.oppLoss === 0),
    'the photographed position must not touch the human either way', scored);
  check(declinesFreeUpgrade(scored, 1) && !declinesFreeUpgrade(scored, 0)
      && !declinesFreeUpgrade(scored, 2),
    'the photographed middle column is the declined free upgrade; the sides are not', scored);
  // The slip branch's draw budget is a replay contract: exactly one slip roll
  // and one pick, and a zero-slip shape rolls nothing before search jitter.
  const counting = () => {
    let n = 0;
    return { random: () => { n++; return 0; }, draws: () => n };
  };
  const slipping = counting();
  botMoveWithShape(mid, AI, 4, GROUPS[4].bot, CLASSIC, slipping.random);
  check(slipping.draws() === 2,
    'the slip branch must draw exactly twice: the roll, then the pick', slipping.draws());
  const searching = counting();
  botMoveWithShape(mid, AI, 4, { ...GROUPS[4].bot, slip: 0, openerSlip: 0 }, CLASSIC, searching.random);
  check(searching.draws() > 2,
    'a zero-slip shape must draw nothing but search jitter', searching.draws());
  // botMoveWithShape IS botSlipPick ?? botSearch on one stream: the ranked
  // turn builder applies the two halves itself (the cast decided on the
  // un-slipped search, the one slip on the placement) and must decide
  // exactly as the composed move would.
  for (const shape of [GROUPS[0].bot, APEX.bot]) {
    for (const [seat, board] of [[AI, botAsAI], [ME, botAsME]] as const) {
      const composed = botMoveWithShape(board, seat, 6, shape, CLASSIC, seeded(77));
      const stream = seeded(77);
      const split = botSlipPick(board, seat, 6, shape, CLASSIC, stream)
        ?? botSearch(board, seat, 6, shape, CLASSIC, stream);
      check(composed === split, 'botSlipPick ?? botSearch diverged from botMoveWithShape',
        { seat, shape, composed, split });
    }
  }
  const declined = counting();
  check(botSlipPick(mid, AI, 4, { ...GROUPS[4].bot, slip: 0 }, CLASSIC, declined.random) === null
      && declined.draws() === 0, 'a zero-slip shape must draw nothing when asked to slip');
  // THE PHOTOGRAPHED MOVE, at the move level (2026-09-02): an Obsidian shape
  // seated AI on that position, slipping (roll 0) and picking with 0.5,
  // played the middle column for 18 when either side paid 26. A slip may
  // still build badly, walk into a destroy, miss a kill or spare you; it
  // may never decline eight free points with the human's board untouched
  // either way. The rule filters the candidates and draws nothing itself:
  // the roll and the pick are still the only two draws.
  let photographedDraws = 0;
  const stacked = botMoveWithShape(photographed, AI, 4, GROUPS[5].bot, ROWSWITCH, () => {
    photographedDraws++;
    return photographedDraws === 1 ? 0 : 0.5;
  });
  check(stacked !== 1 && photographedDraws === 2,
    'a slipped Obsidian bot stacked the third 4 for 18 when either side paid 26',
    { stacked, draws: photographedDraws });
}
