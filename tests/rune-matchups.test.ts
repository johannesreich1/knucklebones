// Focused contract for tools/rune-matchups.ts — plan coverage, deterministic
// streams, cast grammar, finite supply, terminal casts, and raw reconciliation.
// Run: node --experimental-strip-types tests/rune-matchups.test.ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AI, BOUNTY, CLASSIC, LIMITED, legalCols, type GameState, type Player,
} from '../src/core/rules.ts';
import { MODES } from '../src/core/modes.ts';
import { SPELLS, type CastCtx, type SpellSpec } from '../src/core/spells.ts';
import {
  deriveCellSeed, deriveGameSeed, planCells, playMatchupGame, runCell, runSimulation,
  strictModes, strictRunes, validateCliArgv, type CastDecision, type CellPlan,
} from '../tools/rune-matchups.ts';

const problems: string[] = [];
const check = (condition: boolean, message: string, details?: unknown) => {
  if (!condition) problems.push(message + (details === undefined ? '' : ' :: ' + JSON.stringify(details)));
};
const throws = (fn: () => unknown, message: string) => {
  try { fn(); problems.push(message + ' :: did not throw'); } catch { /* expected */ }
};
const rune = (id: string) => SPELLS.find((candidate) => candidate.id === id)!;
const mode = (id: string) => MODES.find((candidate) => candidate.id === id)!;
const sequence = (initial: number[]) => {
  const values = initial.slice();
  let fallback = 0;
  return () => values.shift() ?? 1 + (fallback++ % 6);
};
const firstLegal = (st: GameState, who: Player) => legalCols(st[who])[0];
const alwaysCast: CastDecision = (st, who, spell, ctx) => {
  if (spell.target === 'self') return spell.legal(st, who, -1, ctx) ? -1 : null;
  for (let col = 0; col < 3; col++) if (spell.legal(st, who, col, ctx)) return col;
  return null;
};

/* ---- registry-derived experimental plan ---- */
{
  const one = planCells({ seeds: ['a'], castRules: ['one'] });
  const both = planCells({ seeds: ['a'], castRules: ['one', 'chain'] });
  check(one.length === 252, 'one-rule plan is 7×6×6', one.length);
  check(new Set(one.map((cell) => `${cell.modeId}:${cell.openerRune}:${cell.replyRune}`)).size === 252,
    'one-rule plan has 252 unique directed configurations');
  check(both.length === 329, 'reduced two-rule plan is 252+77', both.length);
  check(both.filter((cell) => cell.castRule === 'one').length === 252,
    'two-rule plan retains every one-cast cell');
  const chain = both.filter((cell) => cell.castRule === 'chain');
  check(chain.length === 77 && chain.every((cell) => cell.openerRune === 'fate' || cell.replyRune === 'fate'),
    'only FATE-containing chain cells are duplicated', chain.slice(0, 3));
  check(new Set(one.map((cell) => cell.modeId)).size === MODES.length,
    'every registered mode is planned');
  check(new Set(one.map((cell) => cell.openerRune)).size === SPELLS.length
    && new Set(one.map((cell) => cell.replyRune)).size === SPELLS.length,
  'every registered rune appears in both roles');
  check(!one.some((cell) => cell.openerRune === 'none' || cell.replyRune === 'none'),
    'diagnostic NONE never enters the default tensor');

  const fourSeeds = planCells({ seeds: ['a', 'b', 'c', 'd'], castRules: ['one', 'chain'] });
  check(fourSeeds.length === 1316, 'four seeds remain 1,316 separate cell records', fourSeeds.length);
  check(new Set(fourSeeds.map((cell) => cell.baseSeed)).size === 4,
    'replicate seeds remain explicit');
  check(planCells({ seeds: ['a'], castRules: ['one', 'chain'], uses: { fate: 1 } }).length === 252,
    'FATE=1 collapses the cast branches');
  const nudgeSensitive = planCells({
    seeds: ['a'], castRules: ['one', 'chain'], uses: { fate: 1, nudge: 2 },
  });
  check(nudgeSensitive.length === 329
    && nudgeSensitive.filter((cell) => cell.castRule === 'chain')
      .every((cell) => cell.openerRune === 'nudge' || cell.replyRune === 'nudge'),
  'effective uses, not a hard-coded FATE id, control branch sensitivity');
  check(planCells({ seeds: ['a'], castRules: ['one', 'chain'], uses: { nudge: 2 } }).length === 392,
    'two multi-use runes add 20 chain cells per mode');
  throws(() => planCells({ seeds: ['a', 'a'], castRules: ['one'] }),
    'duplicate seeds must be refused');
  throws(() => strictModes(['not-a-mode']), 'unknown mode must fail closed');
  throws(() => strictRunes(['not-a-rune']), 'unknown rune must fail closed');
  throws(() => validateCliArgv(['--mdoe', 'limited']), 'unknown CLI flags must fail closed');
  throws(() => validateCliArgv(['--seed', '--cast-rule', 'one']), 'missing CLI values must fail closed');
  throws(() => validateCliArgv(['--mode', 'classic', '--mode', 'limited']),
    'duplicate singleton CLI flags must fail closed');
  validateCliArgv(['--seed', 'a', '--seed', 'b', '--cast-rule', 'both', '--quiet']);
}

/* ---- deterministic cell/game derivation and order isolation ---- */
const target: CellPlan = {
  baseSeed: 'isolation', replication: 0, castRule: 'one', modeId: 'classic',
  openerRune: 'fate', replyRune: 'ward',
};
{
  const variants: CellPlan[] = [
    { ...target, baseSeed: 'other' }, { ...target, castRule: 'chain' },
    { ...target, modeId: 'limited' }, { ...target, openerRune: 'nudge' },
    { ...target, replyRune: 'pilfer' },
  ];
  check(variants.every((cell) => deriveCellSeed(cell) !== deriveCellSeed(target)),
    'every treatment identity changes the cell seed');
  check(deriveGameSeed(target, 0) !== deriveGameSeed(target, 1), 'game index changes the game seed');

  const direct = runCell(target, { games: 2, depth: 1 });
  const rerun = runCell(target, { games: 2, depth: 1 });
  check(JSON.stringify(direct) === JSON.stringify(rerun), 'the same cell reruns byte-identically');
  const full = runSimulation({ games: 2, depth: 1, seeds: ['isolation'], castRules: ['one'] });
  const extracted = full.cells.find((cell) => cell.modeId === 'classic'
    && cell.openerRune === 'fate' && cell.replyRune === 'ward')!;
  check(JSON.stringify(direct) === JSON.stringify(extracted),
    'a cell run alone equals the same cell inside the full plan');

  const selected = (openers: string[]) => runSimulation({
    games: 2, depth: 1, seeds: ['isolation'], castRules: ['one'],
    modes: [mode('classic')], openerRunes: openers.map(rune), replyRunes: [rune('ward')],
  }).cells.find((cell) => cell.openerRune === 'fate')!;
  check(JSON.stringify(selected(['fate', 'nudge'])) === JSON.stringify(selected(['nudge', 'fate'])),
    'selector order cannot shift a keyed cell');

  const originalRandom = Math.random;
  Math.random = () => { throw new Error('ambient Math.random reached'); };
  try { runCell(target, { games: 1, depth: 1 }); } catch (error) {
    problems.push('simulation reached ambient Math.random :: ' + String(error));
  } finally { Math.random = originalRandom; }
}

/* ---- one-cast versus chained FATE, with fresh contexts ---- */
{
  const common = {
    gameSeed: 'fate-grammar', mode: CLASSIC, openerRune: rune('fate'), replyRune: null,
    openerPlayer: AI as Player, endlessDraw: sequence([1, 1, 6]), decideCast: alwaysCast,
    choosePlacement: firstLegal,
  };
  const one = playMatchupGame({ ...common, castRule: 'one' });
  const chain = playMatchupGame({ ...common, castRule: 'chain', endlessDraw: sequence([1, 1, 6]) });
  check(one.casts[0].length === 2 && new Set(one.casts[0].map((cast) => cast.turn)).size === 2,
    'one-cast FATE spends its charges on separate turns', one.casts[0]);
  check(chain.casts[0].length === 2 && chain.casts[0][0].turn === 0 && chain.casts[0][1].turn === 0,
    'chain FATE can cast twice before one placement', chain.casts[0]);
  check(chain.casts[0][0].chargesBefore === 2 && chain.casts[0][0].chargesAfter === 1
    && chain.casts[0][1].chargesBefore === 1 && chain.casts[0][1].chargesAfter === 0,
  'chain charges progress 2→1→0', chain.casts[0]);
  check(chain.casts[0][1].dieBefore === chain.casts[0][0].dieAfter,
    'the second FATE decision sees the first redraw', chain.casts[0]);

  const seen: Array<{ die: number; bagLeft: number | null }> = [];
  playMatchupGame({
    ...common, castRule: 'chain', endlessDraw: sequence([1, 6]),
    decideCast(st: GameState, who: Player, spell: SpellSpec, ctx: CastCtx) {
      seen.push({ die: ctx.die, bagLeft: ctx.bagLeft });
      return ctx.die === 1 && spell.legal(st, who, -1, ctx) ? -1 : null;
    },
  });
  check(seen[0]?.die === 1 && seen[1]?.die === 6,
    'a declined second cast is evaluated against the refreshed hand', seen.slice(0, 2));

  const nonFate = {
    gameSeed: 'invariant', mode: CLASSIC, openerRune: rune('ward'), replyRune: rune('pilfer'),
    openerPlayer: AI as Player, depth: 1,
  };
  check(JSON.stringify(playMatchupGame({ ...nonFate, castRule: 'one' }))
    === JSON.stringify(playMatchupGame({ ...nonFate, castRule: 'chain' })),
  'non-multi-use matchups are mechanically identical under both grammars');
}

/* ---- LIMITED exhaustion and cast-terminal PILFER ---- */
{
  const limited = (bag: number[]) => playMatchupGame({
    gameSeed: 'limited-script', mode: LIMITED, openerRune: rune('fate'), replyRune: null,
    castRule: 'chain', openerPlayer: AI, limitedBag: bag,
    decideCast: alwaysCast, choosePlacement: firstLegal,
  });
  const oneRedraw = limited([1, 1]);
  check(oneRedraw.casts[0].length === 1 && oneRedraw.fateDraws === 1
    && oneRedraw.placements === 1 && oneRedraw.terminalReason === 'supply-empty',
  'emptying LIMITED on the first redraw refuses a second and still places', oneRedraw);
  const twoRedraws = limited([1, 1, 6]);
  check(twoRedraws.casts[0].length === 2 && twoRedraws.fateDraws === 2
    && twoRedraws.placements === 1 && twoRedraws.turnDraws + twoRedraws.fateDraws === 3,
  'three-die LIMITED supply supports two casts then the mandatory placement', twoRedraws);
  throws(() => limited([]), 'an undefined LIMITED draw must throw');

  const pilferState: GameState = [
    [[1, 2], [3, 4, 5], [1, 1, 1]],
    [[6], [2], []],
  ];
  const pilfer = playMatchupGame({
    gameSeed: 'pilfer-terminal', mode: CLASSIC, openerRune: rune('pilfer'), replyRune: null,
    castRule: 'one', openerPlayer: AI, initialState: pilferState,
    decideCast: alwaysCast, endlessDraw: sequence([3]),
    choosePlacement: () => { throw new Error('placement searched after terminal cast'); },
  });
  check(pilfer.terminalReason === 'cast-full' && pilfer.placements === 0
    && pilfer.placementDecisions === 0 && pilfer.turnDraws === 1,
  'terminal PILFER performs no placement search or placement', pilfer);
  const limitedPilfer = playMatchupGame({
    gameSeed: 'limited-pilfer-terminal', mode: LIMITED,
    openerRune: rune('pilfer'), replyRune: null,
    castRule: 'one', openerPlayer: AI, initialState: pilferState,
    limitedBag: [3], decideCast: alwaysCast,
    choosePlacement: () => { throw new Error('placement searched after terminal cast'); },
  });
  check(limitedPilfer.terminalReason === 'cast-full-and-supply-empty'
    && limitedPilfer.bagRemaining === 0 && limitedPilfer.placements === 0,
  'LIMITED records cast-full and supply-empty when both occur', limitedPilfer);

  const bountyState: GameState = [
    [[1, 2], [3, 3, 3], [5, 5, 5]],
    [[4, 4], [], []],
  ];
  const bounty = playMatchupGame({
    gameSeed: 'bounty-score', mode: BOUNTY, openerRune: null, replyRune: null,
    castRule: 'one', openerPlayer: AI, initialState: bountyState,
    endlessDraw: sequence([4]), choosePlacement: () => 0,
  });
  check(bounty.bounty[0] === 2 && bounty.openerScore === 81,
    'final BOUNTY score includes the two banked kills', bounty);
}

/* ---- aggregate reconciliation ---- */
{
  const cell: CellPlan = {
    baseSeed: 'reconcile', replication: 0, castRule: 'one', modeId: 'limited',
    openerRune: 'fate', replyRune: 'nudge',
  };
  const result = runCell(cell, { games: 20, depth: 1 });
  check(result.openerWins + result.draws + result.replyWins === result.games,
    'W/D/L reconcile to games', result);
  check(result.outcomePoints2 === 2 * result.openerWins + result.draws,
    'doubled outcome numerator reconciles');
  check(Object.values(result.terminalReasons).reduce((sum, count) => sum + count, 0) === result.games,
    'terminal reasons reconcile to games');
  check(result.internalOpener.ai.games === 10 && result.internalOpener.me.games === 10,
    'internal core identities alternate inside the oriented cell', result.internalOpener);
  check(result.turnDraws === result.placementsSum + result.terminalReasons['cast-full']
    + result.terminalReasons['cast-full-and-supply-empty'],
    'one turn draw belongs to each placement or cast-terminal turn');
  check(result.totalSupplyDraws === result.turnDraws + result.fateDraws
    && result.totalSupplyDraws <= 24 * result.games,
  'LIMITED draw counts reconcile and never exceed its bag');
  check(result.fateDraws === result.roles[0].casts, 'every FATE cast consumes exactly one extra draw');
  check(result.actionsSum === result.placementsSum + result.roles[0].casts + result.roles[1].casts,
    'actions reconcile to placements plus casts');
  check(result.marginSum === result.openerScoreSum - result.replyScoreSum,
    'margin sum reconciles to the two score sums');
  const seatGroups = [result.internalOpener.ai, result.internalOpener.me];
  check(seatGroups.every((seat) => seat.wins + seat.draws + seat.losses === seat.games),
    'each internal opener identity reconciles its W/D/L');
  check(seatGroups.reduce((sum, seat) => sum + seat.games, 0) === result.games
    && seatGroups.reduce((sum, seat) => sum + seat.wins, 0) === result.openerWins
    && seatGroups.reduce((sum, seat) => sum + seat.draws, 0) === result.draws
    && seatGroups.reduce((sum, seat) => sum + seat.losses, 0) === result.replyWins,
  'internal opener identities sum to the oriented-cell totals');
  const effectiveUses = [rune('fate').uses, rune('nudge').uses];
  for (let index = 0; index < result.roles.length; index++) {
    const role = result.roles[index];
    const histogramGames = Object.values(role.chargesSpentHistogram).reduce((sum, count) => sum + count, 0);
    const histogramCasts = Object.entries(role.chargesSpentHistogram)
      .reduce((sum, [casts, count]) => sum + +casts * count, 0);
    check(histogramGames === result.games, 'charge histogram contains every game', role);
    check(histogramCasts === role.casts, 'charge histogram reconciles to casts', role);
    check(role.gamesWithCast === Object.entries(role.chargesSpentHistogram)
      .filter(([casts]) => +casts > 0).reduce((sum, [, count]) => sum + count, 0),
    'games-with-cast reconciles to histogram', role);
    check(role.casts + role.unusedCharges === result.games * effectiveUses[index],
      'spent and unused charges reconcile to configured supply', { index, role });
  }
  const finite = (value: unknown): boolean => typeof value === 'number' ? Number.isFinite(value)
    : Array.isArray(value) ? value.every(finite)
      : value !== null && typeof value === 'object' ? Object.values(value).every(finite) : true;
  check(finite(result), 'every numeric raw field is finite');
}

/* ---- real CLI boundary: strict failures and JSON success ---- */
{
  const script = fileURLToPath(new URL('../tools/rune-matchups.ts', import.meta.url));
  const invoke = (args: string[]) => spawnSync(process.execPath, [
    '--no-warnings', '--experimental-strip-types', script, ...args,
  ], { encoding: 'utf8' });
  const success = invoke([
    '--games', '1', '--seed', 'cli-smoke', '--cast-rule', 'one', '--mode', 'classic',
    '--opener', 'ward', '--reply', 'ward', '--depth', '1', '--quiet',
  ]);
  let parsed: { plan?: { cellRecords?: number; totalGames?: number } } | null = null;
  try { parsed = JSON.parse(success.stdout); } catch { /* assertion below reports stderr/stdout */ }
  check(success.status === 0 && parsed?.plan?.cellRecords === 1 && parsed.plan.totalGames === 1,
    'valid CLI request emits one-cell JSON', { status: success.status, stderr: success.stderr });
  const unknown = invoke(['--mdoe', 'limited']);
  check(unknown.status !== 0 && unknown.stderr.includes('Unknown option: --mdoe'),
    'unknown CLI option exits nonzero', { status: unknown.status, stderr: unknown.stderr });
  const missing = invoke(['--seed', '--cast-rule', 'one']);
  check(missing.status !== 0 && missing.stderr.includes('Missing value for --seed'),
    'missing CLI value exits nonzero', { status: missing.status, stderr: missing.stderr });
}

console.log(JSON.stringify({ problems }, null, 2));
process.exitCode = problems.length ? 1 : 0;
