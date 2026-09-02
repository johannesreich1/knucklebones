// Does the bot cast each rune TO ITS ADVANTAGE? Coverage is not the question —
// every rune has had a cpuCast for months. This asks the only question that
// makes "the bots understand every rune" mean something: a bot dealt the rune
// and allowed to spend it must beat a bot dealt the same rune that never does.
//
// Both seats are the same league shape playing the production action log
// (tests/support/rune-trial-replay.ts), on the same seeded dice, alternating
// seats. The only difference is the cast window, so the share IS the rune's
// worth in the bot's hands. A rune below parity means the bot spends it into
// a worse position than holding it — a policy bug in that rune's cpuCast, not
// a balance question about the rune itself.
// Run: mise exec -- node --experimental-strip-types tests/rune-cast-duel.test.ts
import { randStream } from '../src/core/dice.ts';
import { GROUPS, LADDER_CURVE_V2 } from '../src/core/ladder.ts';
import { CLASSIC } from '../src/core/rules.ts';
import { SPELLS } from '../src/core/spells.ts';
import { castVsHold } from './support/rune-trial-replay.ts';
import { emitReport } from './support/emit-report.mjs';

const problems: string[] = [];
const errs: string[] = [];
const GAMES = 600;                     // SE ≈ 2.0pp per cell
/* GOLD: full board sight, depth 2, and the ordinary merit demand — the league
   where a cast decision is the bot's own rather than its slip's. */
const LEAGUE = 4;
const bot = { points: GROUPS[LEAGUE].floor, apex: false };
/* Casting must never be worse than holding. Measured cells sit well above
   this (recorded in the report); the floor catches a cpuCast that starts
   spending charges into worse positions, which is what "understands the rune"
   would stop meaning. */
const CAST_FLOOR = 0.50;

const cells: Record<string, number> = {};
try {
  for (const spell of SPELLS) {
    const share = castVsHold(spell.id, CLASSIC, bot, LADDER_CURVE_V2, GAMES,
      'rune-cast-duel-v1', (seed: string) => randStream(seed));
    cells[spell.id] = +(share * 100).toFixed(1);
    if (share < CAST_FLOOR) {
      problems.push(`${spell.id}: a bot that casts it wins only ${cells[spell.id]}% against a bot `
        + `dealt the same rune that never casts — the bot does not spend this rune to its advantage`);
    }
  }
} catch (error) {
  errs.push(error instanceof Error ? error.stack ?? error.message : String(error));
}

emitReport({
  league: GROUPS[LEAGUE].id,
  gamesPerRune: GAMES,
  casterOutcomeShare: cells,
  problems,
  errs,
}, problems.length || errs.length);
