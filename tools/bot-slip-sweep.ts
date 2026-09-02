// Slip sweep for one league — the retune's instrument, NOT a gate. It measures
// exactly the cells tests/botbench.test.ts measures (tests/support/
// bot-calibration.ts measureLeagueCells: same pool, same game counts, same
// seeds, same reference humans), so at the shipped shape it reproduces the
// bench cell to the digit — the first run asserts that before any sweep.
//
// Run: mise exec -- node --experimental-strip-types tools/bot-slip-sweep.ts \
//   --league gold --slip 0.70:0.82:0.02 --opener 0.64:0.76:0.02 [--seed 7200]
// or --opener-offset -0.04 to pair each slip with one opener rate.
import { GROUPS } from '../src/core/ladder.ts';
import { measureLeagueCells, productionPool, reweight } from '../tests/support/bot-calibration.ts';
import type { Policy } from '../tests/support/policy-duel-bench.ts';

function parseArgs(argv: readonly string[]) {
  const options: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) {
      throw new Error(`usage: --league <id> --slip a:b:step --opener a:b:step [--seed n]`);
    }
    options[argv[i].slice(2)] = argv[i + 1];
  }
  return options;
}
function range(spec: string | undefined, fallback: number): number[] {
  if (!spec) return [fallback];
  const [from, to, step] = spec.split(':').map(Number);
  if (![from, to, step].every(Number.isFinite) || step <= 0) throw new Error(`bad range ${spec}`);
  const values: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) values.push(Math.round(v * 1000) / 1000);
  return values;
}

const options = parseArgs(process.argv.slice(2));
const index = GROUPS.findIndex((group) => group.id === options.league);
if (index < 0) throw new Error(`unknown league ${options.league}`);
const group = GROUPS[index];
const seed = options.seed ? Number(options.seed) : 7200;
/* The league's own permanent pool, exactly as botbench weights it. */
const pool = productionPool(index === 0 ? 'stone' : index === 1 ? 'bone' : 'ivory');
const pct = (share: number) => +(share * 100).toFixed(1);

const rows = [];
const offset = options['opener-offset'] === undefined ? null : Number(options['opener-offset']);
for (const slip of range(options.slip, group.bot.slip)) {
  const openers = offset === null
    ? range(options.opener, group.bot.openerSlip)
    : [Math.round((slip + offset) * 1000) / 1000];
  for (const openerSlip of openers) {
    const bot: Policy = { shape: { ...group.bot, slip, openerSlip } };
    const cells = measureLeagueCells(bot, index, seed);
    const humanFirst = reweight(cells.newcomer.humanFirst, pool);
    const botFirst = reweight(cells.newcomer.botFirst, pool);
    rows.push({
      slip,
      openerSlip,
      humanOpens: pct(humanFirst.weighted),
      botOpens: pct(botFirst.weighted),
      learnerOpens: pct(reweight(cells.learner.humanFirst, pool).weighted),
      learnerSecond: pct(reweight(cells.learner.botFirst, pool).weighted),
      unforced: `${pct(humanFirst.unforced.weighted)} / ${pct(botFirst.unforced.weighted)}`,
    });
    console.error(JSON.stringify(rows.at(-1)));
  }
}
console.log(JSON.stringify({ league: group.id, seed, shipped: group.bot, rows }, null, 2));
