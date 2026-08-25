// Focused contract for tools/rune-matchup-analysis.ts.
// Run: mise exec -- node --experimental-strip-types tests/rune-matchup-analysis.test.ts
import { analyzeRuneMatchupReports, approximateZeroSum } from '../tools/rune-matchup-analysis.ts';
import { MODES } from '../src/core/modes.ts';
import { SPELLS } from '../src/core/spells.ts';

let problems = 0;
function check(condition: unknown, message: string, detail?: unknown) {
  if (condition) return;
  problems++;
  console.error(`FAIL: ${message}`);
  if (detail !== undefined) console.error(detail);
}

function throws(fn: () => unknown, pattern: RegExp, message: string) {
  try { fn(); check(false, message); }
  catch (error) {
    check(error instanceof Error && pattern.test(error.message), message,
      error instanceof Error ? error.message : error);
  }
}

const runeIds = SPELLS.map(({ id }) => id);
const sortedRunes = runeIds.slice().sort();
const strengthIndex = new Map(sortedRunes.map((id, index) => [id, index]));

function roleAggregate(games: number) {
  return {
    casts: 0,
    gamesWithCast: 0,
    legalCastOpportunities: 0,
    unusedCharges: 0,
    chargesSpentHistogram: { '0': games },
    castTimingBins: Array.from({ length: 10 }, () => 0),
    lateCasts: 0,
    immediateSwingCount: 0,
    immediateSwingSum: 0,
    immediateSwingSquaredSum: 0,
  };
}

function rawReport(baseSeed: string) {
  const games = 100;
  const cells = MODES.flatMap((mode) => runeIds.flatMap((openerRune) => runeIds.map((replyRune) => {
    const openerIndex = strengthIndex.get(openerRune)!;
    const replyIndex = strengthIndex.get(replyRune)!;
    // A separable constant-sum benchmark: a 3pp opener edge and a 2pp step
    // between adjacent runes. Seat-neutral Q therefore removes exactly 3pp.
    const openerScore = 0.53 + 0.02 * (openerIndex - replyIndex);
    const draws = 20;
    const openerWins = Math.round(games * openerScore - draws / 2);
    const replyWins = games - draws - openerWins;
    const aiWins = Math.floor(openerWins / 2);
    const aiDraws = draws / 2;
    const aiLosses = games / 2 - aiWins - aiDraws;
    return {
      baseSeed,
      replication: 0,
      castRule: 'one',
      modeId: mode.id,
      openerRune,
      replyRune,
      cellSeed: `rune-matchups-v1#${baseSeed}#one#${mode.id}#${openerRune}#${replyRune}`,
      games,
      openerWins,
      draws,
      replyWins,
      outcomePoints2: 2 * openerWins + draws,
      openerScoreSum: games * 50,
      openerScoreSquaredSum: games * 2_500,
      replyScoreSum: games * 50,
      replyScoreSquaredSum: games * 2_500,
      marginSum: 0,
      marginSquaredSum: 0,
      placementsSum: games * 10,
      placementsSquaredSum: games * 100,
      placementsMin: 10,
      placementsMax: 10,
      actionsSum: games * 10,
      actionsSquaredSum: games * 100,
      kills: [0, 0],
      bounty: [0, 0],
      turnDraws: games * 10,
      fateDraws: 0,
      totalSupplyDraws: games * 10,
      terminalReasons: {
        'board-full': games,
        'supply-empty': 0,
        'board-full-and-supply-empty': 0,
        'cast-full': 0,
        'cast-full-and-supply-empty': 0,
      },
      roles: [roleAggregate(games), roleAggregate(games)],
      internalOpener: {
        ai: { games: games / 2, wins: aiWins, draws: aiDraws, losses: aiLosses },
        me: {
          games: games / 2,
          wins: openerWins - aiWins,
          draws: draws - aiDraws,
          losses: replyWins - aiLosses,
        },
      },
    };
  })));
  return {
    schemaVersion: 1,
    simulatorVersion: 1,
    provenance: { fileSha256: { 'tools/rune-matchups.ts': 'same-fixture-source' } },
    request: {
      gamesPerCell: games,
      seeds: [baseSeed],
      castRules: ['one'],
      modeIds: MODES.map(({ id }) => id),
      openerRuneIds: runeIds,
      replyRuneIds: runeIds,
      factorialDesign: 'full',
    },
    policy: {
      placement: 'fixture', depth: 2, riskWeight: 0.9, opponentWeight: 1,
      cast: 'fixture', uses: Object.fromEntries(SPELLS.map(({ id, uses }) => [id, uses])),
    },
    seedDerivation: 'rune-matchups-v{version}#{baseSeed}#{castRule}#{mode}#{opener}#{reply}#game:{index}; domains #supply, #search-opener, #search-reply',
    roster: SPELLS.map(({ id, uses }) => ({ id, uses })),
    modes: MODES.map(({ id, mode, weight }) => ({ id, mode, weight })),
    plan: {
      mechanicalConfigurations: MODES.length * runeIds.length ** 2,
      cellRecords: cells.length,
      totalGames: cells.length * games,
      replicationCount: 1,
      branchSensitiveRunes: ['fate'],
    },
    fieldSemantics: {
      roles: ['opener', 'reply'],
      castTimingBins: 'ten equal placement-fraction bins',
    },
    cells,
  };
}

const reportA = rawReport('analysis-a');
const reportB = rawReport('analysis-b');
const analysis = analyzeRuneMatchupReports([reportA, reportB], { equilibriumIterations: 20_000 }) as any;

check(analysis.validation.complete === true && analysis.branches.length === 1,
  'two compatible one-rule reports produce one complete branch');
const branch = analysis.branches[0];
check(branch.effectiveCellCount === MODES.length * runeIds.length ** 2
  && branch.orientedCells.length === MODES.length * runeIds.length ** 2,
'complete tensor has 252 effective and oriented cells');
check(branch.replicationSeeds.join(',') === 'analysis-a,analysis-b',
  'same-treatment replications pool by independent base seed', branch.replicationSeeds);

const classic = branch.modes.find((mode: any) => mode.id === 'classic');
const first = sortedRunes[0], last = sortedRunes[sortedRunes.length - 1];
const firstAt = sortedRunes.indexOf(first), lastAt = sortedRunes.indexOf(last);
check(classic.oriented.values[firstAt][lastAt] === 0.43
  && classic.oriented.values[lastAt][firstAt] === 0.63,
'oriented O retains the two opener directions', classic.oriented);
check(classic.seatNeutral.values[firstAt][lastAt] === 0.4
  && classic.seatNeutral.values[lastAt][firstAt] === 0.6,
'seat-neutral Q cancels the synthetic 3pp opener edge', classic.seatNeutral);
check(classic.openerEffect.values[firstAt][lastAt] === 0.03,
  'opener-effect decomposition recovers the synthetic 3pp edge', classic.openerEffect);

const firstStrength = branch.weighted.strengths.find((item: any) => item.rune === first);
const lastStrength = branch.weighted.strengths.find((item: any) => item.rune === last);
check(firstStrength.uniformPopulationStrength === 0.45
  && lastStrength.uniformPopulationStrength === 0.55
  && branch.weighted.strengthSpread === 0.1,
'wheel-weighted uniform-population rune strengths are exact', { firstStrength, lastStrength });
check(branch.weighted.selectionGame.pointEstimatePureSaddles.length === 1
  && branch.weighted.selectionGame.pointEstimatePureSaddles[0].openerRune === last
  && branch.weighted.selectionGame.pointEstimatePureSaddles[0].replyRune === last,
'precommit selection game exposes the synthetic pure equilibrium', branch.weighted.selectionGame);
check(branch.weighted.selectionGame.pointEstimatePureDominance.rowChooser
  .filter((item: any) => item.rune !== last)
  .every((item: any) => item.strictDominators.includes(last)),
'precommit selection game reports pure-strategy dominance', branch.weighted.selectionGame.pointEstimatePureDominance);
const extremePair = branch.weighted.pairs.find((item: any) =>
  item.runes[0] === first && item.runes[1] === last);
check(extremePair.signedEdge === -0.1 && extremePair.modeWeightedAbsoluteEdge === 0.1
  && extremePair.modeWeightedAbsoluteEdgeMinusAbsoluteWheelEdge === 0,
'pair report separates signed strength from realized polarization', extremePair);

check(branch.trial.offerCount === 20 && branch.trial.orderedOfferChoiceContexts === 180
  && branch.trial.underlyingMechanicalCellCount === 36,
'Classic-backed Trial has 20 offers and reuses only 36 mechanical cells', branch.trial);
const referencedCells = new Set(branch.trial.offers.flatMap((offer: any) => offer.sourceCells));
check(referencedCells.size === 36 && branch.trial.offers.every((offer: any) => offer.sourceCells.length === 9),
  'offer contexts preserve their shared-cell dependencies', referencedCells);
check(branch.trial.offers.every((offer: any) => offer.pointEstimatePureSaddles.length === 1
  && offer.pointEstimatePureSaddles[0].mirror === true),
'separable fixture produces one mirror pure saddle per offer');
check(branch.trial.aggregate.pointEstimateGameTheory.uniquePureSaddleSelection.mirrorProbability === 1,
  'unique pure saddles produce an exact point-estimate aggregate profile',
  branch.trial.aggregate.pointEstimateGameTheory.uniquePureSaddleSelection);
check(branch.trial.aggregate.approximateMwDiagnostics.maximumPrimalDualGap < 0.02,
  'deterministic approximate equilibria expose a small measured exploitability gap',
  branch.trial.aggregate.approximateMwDiagnostics.maximumPrimalDualGap);

const reversed = analyzeRuneMatchupReports([reportB, reportA], { equilibriumIterations: 20_000 });
check(JSON.stringify(reversed) === JSON.stringify(analysis),
  'analysis JSON is independent of source-report ordering');

const rps = approximateZeroSum([
  [0.5, 0.4, 0.6],
  [0.6, 0.5, 0.4],
  [0.4, 0.6, 0.5],
], ['a', 'b', 'c'], 2_000);
check(rps.boundsMidpoint === 0.5 && rps.primalDualGap === 0
  && Math.abs(rps.independentTimeAverageProfileMirrorProbability - 1 / 3) < 1e-12,
'symmetric cyclic matrix retains its exact uniform approximate equilibrium', rps);

const corrupt = structuredClone(reportA);
corrupt.cells[0].openerWins++;
corrupt.cells[0].replyWins--;
throws(() => analyzeRuneMatchupReports([corrupt]), /outcomePoints2 does not reconcile/,
  'corrupt doubled outcome numerator is rejected');

const incomplete = structuredClone(reportA);
incomplete.cells.pop();
incomplete.plan.cellRecords--;
incomplete.plan.totalGames -= incomplete.request.gamesPerCell;
incomplete.plan.mechanicalConfigurations--;
throws(() => analyzeRuneMatchupReports([incomplete]), /requested design/,
  'a report cannot claim completeness with one requested cell missing');

throws(() => analyzeRuneMatchupReports([reportA, reportA]), /duplicate cellSeed/,
  'the same seeded replication cannot be merged twice');

console.log(JSON.stringify({ problems }, null, 2));
if (problems) process.exitCode = 1;
