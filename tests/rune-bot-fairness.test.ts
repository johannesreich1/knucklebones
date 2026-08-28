// Production-path Rune Trial bot balance. The ordinary botbench owns the
// weighted league curve; this focused cell executes real ranked action replay,
// offers, casts, and bot turns so removing the Rune cast-slip cannot hide
// behind its Classic proxy.
// Run: mise exec -- node --experimental-strip-types tests/rune-bot-fairness.test.ts
import { searchRoot } from '../src/core/ai.ts';
import { randStream } from '../src/core/dice.ts';
import { GROUPS } from '../src/core/ladder.ts';
import {
  appendRankedAction,
  rankedActionTotal,
  rebuildRankedActions,
  type RankedActionRow,
  type RankedActionState,
  type RankedRuneDeal,
} from '../src/core/ranked-actions.ts';
import { appendRankedBotTurn } from '../src/core/ranked-bot-turn.ts';
import {
  seededRuneTrialAutoPick,
  seededRuneTrialOffer,
} from '../src/core/rune-trial-offer.ts';
import {
  AI, CLASSIC, ME, legalCols,
  type CharmSt, type Player,
} from '../src/core/rules.ts';
import { machineCastPlan, spellById } from '../src/core/spells.ts';

const problems: string[] = [];
const errs: string[] = [];
const GAMES = 1000;
const other = (who: Player) => (1 - who) as Player;

function humanMove(
  state: RankedActionState,
  who: Player,
  random: () => number,
  rootCharm?: CharmSt,
): number {
  return searchRoot(state.st, who, state.nextDie!, 1, {
    mode: CLASSIC,
    random,
    riskWeight: 0,
    opponentWeight: 0,
    rootCharm,
  }).c;
}

/* The comparison player is deliberately simple: a seat-neutral depth-one
   builder using the production Normal spell demand. Dice stay authoritative
   to the match seed; human and bot decisions have independent keyed streams. */
function appendHumanTurn(
  seed: string,
  rows: RankedActionRow[],
  initial: RankedActionState,
  dealt: RankedRuneDeal,
  random: () => number,
): RankedActionState {
  let state = initial;
  const who = state.turn;
  const spell = spellById(dealt[who]);
  let coordinatedPlacement: number | null = null;

  if (spell && (state.charges[who][spell.id] ?? 0) > 0) {
    const plan = machineCastPlan(state.st, who, spell, {
      mode: CLASSIC,
      die: state.nextDie!,
      setDie: () => undefined,
      draw: () => state.nextDie!,
      bagLeft: null,
      charm: state.charm,
    }, 16, (rootCharm) => humanMove(state, who, random, rootCharm));
    coordinatedPlacement = plan.placement;

    if (plan.target !== null) {
      if (spell.commitsOnAim) {
        const aimed = appendRankedAction(seed, rows, CLASSIC, dealt, {
          kind: 'aim', rune_id: spell.id,
        });
        if (!aimed) throw new Error('simple human produced an illegal Rune aim');
        rows.push(aimed.row);
        state = aimed.state;
      }
      const cast = appendRankedAction(seed, rows, CLASSIC, dealt, {
        kind: 'cast', rune_id: spell.id, target_col: plan.target,
      });
      if (!cast) throw new Error('simple human produced an illegal Rune cast');
      rows.push(cast.row);
      state = cast.state;
    }
  }

  if (!state.over && state.nextDie !== null) {
    const placedCol = coordinatedPlacement ?? humanMove(state, who, random);
    if (!legalCols(state.st[who]).includes(placedCol)) {
      throw new Error('simple human produced an illegal placement');
    }
    const placed = appendRankedAction(seed, rows, CLASSIC, dealt, {
      kind: 'place', placed_col: placedCol,
    });
    if (!placed) throw new Error('simple human placement failed replay validation');
    rows.push(placed.row);
    state = placed.state;
  }
  return state;
}

function play(groupIndex: number, humanFirst: boolean, game: number): number {
  const seed = `rune-bot-fairness-v1#g:${groupIndex}#seat:${humanFirst ? 'h' : 'b'}#${game}`;
  const offer = seededRuneTrialOffer(seed);
  const humanIdx: Player = humanFirst ? ME : AI;
  const botIdx = other(humanIdx);
  const dealt: [string, string] = ['', ''];
  dealt[humanIdx] = seededRuneTrialAutoPick(seed, 'human-seat', offer);
  dealt[botIdx] = seededRuneTrialAutoPick(seed, 'bot-seat', offer);

  const rows: RankedActionRow[] = [];
  let state = rebuildRankedActions(seed, rows, CLASSIC, dealt);
  if (!state) throw new Error('Rune balance replay did not initialize');
  const humanRandom = randStream(`${seed}#human-policy`);
  const botRandom = randStream(`${seed}#bot-policy`);
  let turns = 0;

  while (!state.over) {
    if (++turns > 100) throw new Error('Rune balance replay exceeded its turn cap');
    if (state.turn === botIdx) {
      const turn = appendRankedBotTurn({
        seed,
        rows,
        state,
        mode: CLASSIC,
        dealt,
        rating: GROUPS[groupIndex].floor,
        random: botRandom,
      });
      if (!turn) throw new Error('production bot could not append a Rune turn');
      rows.push(...turn.actions);
      state = turn.state;
    } else {
      state = appendHumanTurn(seed, rows, state, dealt, humanRandom);
    }
  }

  const mine = rankedActionTotal(state, humanIdx, CLASSIC);
  const theirs = rankedActionTotal(state, botIdx, CLASSIC);
  return mine > theirs ? 1 : mine < theirs ? 0 : 0.5;
}

const humanOutcomeShare: Record<string, { humanFirst: number; botFirst: number }> = {};
try {
  for (let groupIndex = 2; groupIndex < GROUPS.length; groupIndex++) {
    const measure = (humanFirst: boolean) => {
      let points = 0;
      for (let game = 0; game < GAMES; game++) points += play(groupIndex, humanFirst, game);
      return points / GAMES;
    };
    const humanFirst = measure(true);
    const botFirst = measure(false);
    humanOutcomeShare[GROUPS[groupIndex].id] = { humanFirst, botFirst };
    if (humanFirst < 0.50 || botFirst < 0.50) {
      problems.push(`${GROUPS[groupIndex].id} made the Rune bot the calibrated favourite: `
        + `${(humanFirst * 100).toFixed(1)}% / ${(botFirst * 100).toFixed(1)}% human share`);
    }
  }
} catch (error) {
  errs.push(error instanceof Error ? error.stack ?? error.message : String(error));
}

console.log(JSON.stringify({
  gamesPerSeat: GAMES,
  humanOutcomeShare: Object.fromEntries(Object.entries(humanOutcomeShare).map(
    ([group, seats]) => [group, {
      humanFirst: +(seats.humanFirst * 100).toFixed(1),
      botFirst: +(seats.botFirst * 100).toFixed(1),
    }],
  )),
  problems,
  errs,
}, null, 2));
