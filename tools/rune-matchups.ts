// Asymmetric rune-vs-rune measurement — seeded, import-safe, pure game rules.
//
// The old spellsim remains the historical one-rune-vs-none/same-rune tool.
// This instrument owns the missing directed payoff tensor: one shared mode,
// one rune per role, a fixed opener, and an explicit FATE cast grammar.
//
// Run:
//   node --experimental-strip-types tools/rune-matchups.ts \
//     --games 3000 --seed 20260825-a --mode all \
//     --opener all --reply all --cast-rule both --output report.json
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AI, ME, BOUNTY, LIMITED, applyMove, cloneSt, emptyBoard, freshCharm, isFull, legalCols, totalOf,
  type GameState, type Mode, type Player,
} from '../src/core/rules.ts';
import { searchRoot } from '../src/core/ai.ts';
import { makeBag, diceStream, randStream } from '../src/core/dice.ts';
import { MODES, type ModeSpec } from '../src/core/modes.ts';
import {
  SPELLS, machineCast, swingOf, type CastCtx, type SpellSpec,
} from '../src/core/spells.ts';

export const SIMULATOR_VERSION = 1;
export type CastRule = 'one' | 'chain';
export type Role = 'opener' | 'reply';

export interface CellPlan {
  baseSeed: string;
  replication: number;
  castRule: CastRule;
  modeId: string;
  openerRune: string;
  replyRune: string;
}

export interface PlanOptions {
  seeds: string[];
  castRules: CastRule[];
  modes?: ModeSpec[];
  openerRunes?: Array<SpellSpec | null>;
  replyRunes?: Array<SpellSpec | null>;
  uses?: Record<string, number>;
  fullFactorial?: boolean;
}

export type SimulationEvent =
  | { kind: 'draw'; role: Role; player: Player; reason: 'turn' | 'fate'; die: number; bagLeft: number | null }
  | { kind: 'cast'; role: Role; player: Player; rune: string; turn: number; target: number;
      dieBefore: number; dieAfter: number; bagBefore: number | null; bagAfter: number | null;
      chargesBefore: number; chargesAfter: number; swing: number }
  | { kind: 'place'; role: Role; player: Player; turn: number; column: number; die: number; killed: number }
  | { kind: 'terminal'; reason: TerminalReason; turn: number };

export type TerminalReason =
  | 'board-full'
  | 'supply-empty'
  | 'board-full-and-supply-empty'
  | 'cast-full'
  | 'cast-full-and-supply-empty';

export interface CastRecord {
  turn: number;
  target: number;
  dieBefore: number;
  dieAfter: number;
  bagBefore: number | null;
  bagAfter: number | null;
  chargesBefore: number;
  chargesAfter: number;
  swing: number;
}

export type CastDecision = (
  st: GameState, who: Player, spell: SpellSpec, ctx: CastCtx, demand: number,
) => number | null;

export type PlacementDecision = (
  st: GameState, who: Player, die: number, mode: Mode, random: () => number,
) => number;

export interface GameOptions {
  gameSeed: string;
  mode: Mode;
  openerRune: SpellSpec | null;
  replyRune: SpellSpec | null;
  castRule: CastRule;
  openerPlayer?: Player;
  depth?: number;
  riskWeight?: number;
  opponentWeight?: number;
  demands?: Record<string, number>;
  uses?: Record<string, number>;
  maxPlacements?: number;
  initialState?: GameState;
  limitedBag?: number[];
  endlessDraw?: () => number;
  searchRandom?: [() => number, () => number];
  decideCast?: CastDecision;
  choosePlacement?: PlacementDecision;
  onEvent?: (event: SimulationEvent) => void;
}

export interface GameResult {
  openerPlayer: Player;
  openerScore: number;
  replyScore: number;
  placements: number;
  placementDecisions: number;
  kills: [number, number];
  bounty: [number, number];
  casts: [CastRecord[], CastRecord[]];
  legalCastOpportunities: [number, number];
  chargesLeft: [number, number];
  turnDraws: number;
  fateDraws: number;
  bagRemaining: number | null;
  terminalReason: TerminalReason;
}

export interface RoleAggregate {
  casts: number;
  gamesWithCast: number;
  legalCastOpportunities: number;
  unusedCharges: number;
  chargesSpentHistogram: Record<string, number>;
  castTimingBins: number[];
  lateCasts: number;
  immediateSwingCount: number;
  immediateSwingSum: number;
  immediateSwingSquaredSum: number;
}

export interface CellResult extends CellPlan {
  cellSeed: string;
  games: number;
  openerWins: number;
  draws: number;
  replyWins: number;
  outcomePoints2: number;
  openerScoreSum: number;
  openerScoreSquaredSum: number;
  replyScoreSum: number;
  replyScoreSquaredSum: number;
  marginSum: number;
  marginSquaredSum: number;
  placementsSum: number;
  placementsSquaredSum: number;
  placementsMin: number;
  placementsMax: number;
  actionsSum: number;
  actionsSquaredSum: number;
  kills: [number, number];
  bounty: [number, number];
  turnDraws: number;
  fateDraws: number;
  totalSupplyDraws: number;
  terminalReasons: Record<TerminalReason, number>;
  roles: [RoleAggregate, RoleAggregate];
  internalOpener: {
    ai: { games: number; wins: number; draws: number; losses: number };
    me: { games: number; wins: number; draws: number; losses: number };
  };
}

export interface RunOptions extends PlanOptions {
  games: number;
  depth?: number;
  riskWeight?: number;
  opponentWeight?: number;
  demands?: Record<string, number>;
  provenance?: Record<string, unknown>;
  onCell?: (cell: CellResult, completed: number, total: number) => void;
}

const roleIndex = (role: Role): 0 | 1 => role === 'opener' ? 0 : 1;
const roleOf = (who: Player, opener: Player): Role => who === opener ? 'opener' : 'reply';
const otherPlayer = (who: Player): Player => (1 - who) as Player;

export function strictModes(ids: string[]): ModeSpec[] {
  if (ids.length === 1 && ids[0] === 'all') return [...MODES];
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate mode ids are not separate configurations.');
  return ids.map((id) => {
    const mode = MODES.find((candidate) => candidate.id === id);
    if (!mode) throw new Error(`Unknown mode id: ${id}`);
    return mode;
  });
}

export function strictRunes(ids: string[]): Array<SpellSpec | null> {
  if (ids.length === 1 && ids[0] === 'all') return [...SPELLS];
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate rune ids are not separate configurations.');
  return ids.map((id) => {
    if (id === 'none') return null;
    const rune = SPELLS.find((candidate) => candidate.id === id);
    if (!rune) throw new Error(`Unknown rune id: ${id}`);
    return rune;
  });
}

function runeId(rune: SpellSpec | null): string {
  return rune?.id ?? 'none';
}

function effectiveUses(rune: SpellSpec | null, uses: Record<string, number>): number {
  return rune ? uses[rune.id] ?? rune.uses : 0;
}

export function planCells(options: PlanOptions): CellPlan[] {
  if (!options.seeds.length) throw new Error('At least one --seed is required.');
  if (new Set(options.seeds).size !== options.seeds.length) throw new Error('Duplicate seeds are not independent replications.');
  const modes = options.modes ?? MODES;
  const openers = options.openerRunes ?? SPELLS;
  const replies = options.replyRunes ?? SPELLS;
  const uses = options.uses ?? {};
  const castRules = [...new Set(options.castRules)];
  if (!castRules.length) throw new Error('At least one cast rule is required.');
  const reducedBoth = castRules.length === 2 && castRules.includes('one') && castRules.includes('chain')
    && !options.fullFactorial;
  const cells: CellPlan[] = [];
  for (let replication = 0; replication < options.seeds.length; replication++) {
    for (const mode of modes) {
      for (const opener of openers) {
        for (const reply of replies) {
          const sensitive = effectiveUses(opener, uses) > 1 || effectiveUses(reply, uses) > 1;
          for (const castRule of castRules) {
            if (reducedBoth && castRule === 'chain' && !sensitive) continue;
            cells.push({
              baseSeed: options.seeds[replication], replication, castRule, modeId: mode.id,
              openerRune: runeId(opener), replyRune: runeId(reply),
            });
          }
        }
      }
    }
  }
  return cells;
}

export function deriveCellSeed(cell: CellPlan): string {
  return `rune-matchups-v${SIMULATOR_VERSION}#${cell.baseSeed}#${cell.castRule}`
    + `#${cell.modeId}#${cell.openerRune}#${cell.replyRune}`;
}

export function deriveGameSeed(cell: CellPlan, gameIndex: number): string {
  return `${deriveCellSeed(cell)}#game:${gameIndex}`;
}

const defaultCast: CastDecision = (st, who, spell, ctx, demand) =>
  machineCast(st, who, spell, ctx, demand);

function defaultPlacement(depth: number, riskWeight: number, opponentWeight: number): PlacementDecision {
  return (st, who, die, mode, random) => searchRoot(st, who, die, depth, {
    mode, random, riskWeight, opponentWeight,
  }).c;
}

export function playMatchupGame(options: GameOptions): GameResult {
  const opener = options.openerPlayer ?? AI;
  const reply = otherPlayer(opener);
  const st: GameState = options.initialState ? cloneSt(options.initialState) : [emptyBoard(), emptyBoard()];
  const charm = freshCharm();
  const banked: [number, number] = [0, 0];
  const kills: [number, number] = [0, 0];
  const runeByPlayer: [SpellSpec | null, SpellSpec | null] = opener === AI
    ? [options.openerRune, options.replyRune] : [options.replyRune, options.openerRune];
  const useOverrides = options.uses ?? {};
  const charges: [number, number] = [
    effectiveUses(runeByPlayer[AI], useOverrides), effectiveUses(runeByPlayer[ME], useOverrides),
  ];
  const castsByRole: [CastRecord[], CastRecord[]] = [[], []];
  const legalCastOpportunities: [number, number] = [0, 0];
  const bag = options.mode === LIMITED
    ? (options.limitedBag !== undefined ? options.limitedBag.slice() : makeBag(randStream(options.gameSeed + '#supply')))
    : null;
  const endlessDraw = options.endlessDraw ?? diceStream(options.gameSeed + '#supply');
  const searchRandom = options.searchRandom ?? [
    randStream(options.gameSeed + '#search-opener'), randStream(options.gameSeed + '#search-reply'),
  ];
  const decideCast = options.decideCast ?? defaultCast;
  const choosePlacement = options.choosePlacement ?? defaultPlacement(
    options.depth ?? 2, options.riskWeight ?? 0.9, options.opponentWeight ?? 1,
  );
  const emit = options.onEvent ?? (() => {});
  let turn = opener;
  let placements = 0;
  let placementDecisions = 0;
  let turnNumber = 0;
  let turnDraws = 0;
  let fateDraws = 0;
  let terminalReason: TerminalReason | null = null;

  const drawSupply = (reason: 'turn' | 'fate', who: Player): number => {
    let die: number;
    if (bag) {
      const next = bag.shift();
      if (next === undefined) throw new Error(`Supply exhausted before ${reason} draw: ${options.gameSeed}`);
      die = next;
    } else {
      die = endlessDraw();
    }
    if (!Number.isInteger(die) || die < 1 || die > 6) throw new Error(`Invalid die ${die}: ${options.gameSeed}`);
    if (reason === 'turn') turnDraws++; else fateDraws++;
    emit({ kind: 'draw', role: roleOf(who, opener), player: who, reason, die, bagLeft: bag?.length ?? null });
    return die;
  };

  while (!terminalReason) {
    if (placements >= (options.maxPlacements ?? 1200)) throw new Error(`Placement cap exceeded: ${options.gameSeed}`);
    let hand = drawSupply('turn', turn);
    const spell = runeByPlayer[turn];
    while (spell && charges[turn] > 0) {
      const ctx: CastCtx = {
        mode: options.mode,
        die: hand,
        bagLeft: bag?.length ?? null,
        charm,
        setDie: (die) => { hand = die; },
        draw: () => drawSupply('fate', turn),
      };
      const demand = options.demands?.[spell.id] ?? 16;
      const hasLegalTarget = spell.target === 'self' ? spell.legal(st, turn, -1, ctx)
        : st[turn].some((_, col) => spell.legal(st, turn, col, ctx));
      if (hasLegalTarget) legalCastOpportunities[roleIndex(roleOf(turn, opener))]++;
      const target = decideCast(st, turn, spell, ctx, demand);
      if (target === null) break;
      if (!spell.legal(st, turn, target, ctx)) throw new Error(`Cast policy returned illegal target: ${options.gameSeed}`);
      const beforeDie = hand;
      const beforeBag = bag?.length ?? null;
      const beforeCharges = charges[turn];
      const immediateSwing = swingOf(st, turn, spell, target, options.mode, ctx);
      spell.apply(st, turn, target, ctx);
      charges[turn]--;
      const record: CastRecord = {
        turn: turnNumber,
        target,
        dieBefore: beforeDie,
        dieAfter: hand,
        bagBefore: beforeBag,
        bagAfter: bag?.length ?? null,
        chargesBefore: beforeCharges,
        chargesAfter: charges[turn],
        swing: immediateSwing,
      };
      castsByRole[roleIndex(roleOf(turn, opener))].push(record);
      emit({
        kind: 'cast', role: roleOf(turn, opener), player: turn, rune: spell.id, turn: turnNumber,
        target, dieBefore: beforeDie, dieAfter: hand, bagBefore: beforeBag,
        bagAfter: bag?.length ?? null, chargesBefore: beforeCharges,
        chargesAfter: charges[turn], swing: immediateSwing,
      });
      if (isFull(st[AI]) || isFull(st[ME])) {
        terminalReason = bag?.length === 0 ? 'cast-full-and-supply-empty' : 'cast-full';
        emit({ kind: 'terminal', reason: terminalReason, turn: turnNumber });
        break;
      }
      if (options.castRule === 'one') break;
    }
    if (terminalReason) break;

    const role = roleOf(turn, opener);
    placementDecisions++;
    const column = choosePlacement(st, turn, hand, options.mode, searchRandom[roleIndex(role)]);
    if (!legalCols(st[turn]).includes(column)) throw new Error(`Placement policy returned illegal column: ${options.gameSeed}`);
    const killed = applyMove(st, turn, column, hand, options.mode, charm);
    kills[roleIndex(role)] += killed;
    if (options.mode === BOUNTY) banked[turn] += killed;
    placements++;
    emit({ kind: 'place', role, player: turn, turn: turnNumber, column, die: hand, killed });
    const boardFull = isFull(st[turn]);
    const supplyEmpty = bag?.length === 0;
    if (boardFull && supplyEmpty) terminalReason = 'board-full-and-supply-empty';
    else if (boardFull) terminalReason = 'board-full';
    else if (supplyEmpty) terminalReason = 'supply-empty';
    if (terminalReason) {
      emit({ kind: 'terminal', reason: terminalReason, turn: turnNumber });
      break;
    }
    turn = otherPlayer(turn);
    turnNumber++;
  }

  const score = (who: Player) => totalOf(st[who], options.mode === BOUNTY ? banked[who] : 0, options.mode);
  const roleCharges: [number, number] = opener === AI
    ? [charges[AI], charges[ME]] : [charges[ME], charges[AI]];
  const roleBounty: [number, number] = opener === AI
    ? [banked[AI], banked[ME]] : [banked[ME], banked[AI]];
  return {
    openerPlayer: opener,
    openerScore: score(opener),
    replyScore: score(reply),
    placements,
    placementDecisions,
    kills,
    bounty: roleBounty,
    casts: castsByRole,
    legalCastOpportunities,
    chargesLeft: roleCharges,
    turnDraws,
    fateDraws,
    bagRemaining: bag?.length ?? null,
    terminalReason,
  };
}

function emptyRoleAggregate(): RoleAggregate {
  return {
    casts: 0, gamesWithCast: 0, legalCastOpportunities: 0,
    unusedCharges: 0, chargesSpentHistogram: {},
    castTimingBins: Array.from({ length: 10 }, () => 0), lateCasts: 0,
    immediateSwingCount: 0, immediateSwingSum: 0, immediateSwingSquaredSum: 0,
  };
}

const emptyTerminalReasons = (): Record<TerminalReason, number> => ({
  'board-full': 0,
  'supply-empty': 0,
  'board-full-and-supply-empty': 0,
  'cast-full': 0,
  'cast-full-and-supply-empty': 0,
});

function runeStrict(id: string): SpellSpec | null {
  return strictRunes([id])[0];
}

function modeStrict(id: string): ModeSpec {
  return strictModes([id])[0];
}

export function runCell(
  cell: CellPlan,
  options: Pick<RunOptions, 'games' | 'depth' | 'riskWeight' | 'opponentWeight' | 'demands' | 'uses'>,
): CellResult {
  if (!Number.isInteger(options.games) || options.games < 1) throw new Error('Games per cell must be a positive integer.');
  const mode = modeStrict(cell.modeId);
  const openerRune = runeStrict(cell.openerRune);
  const replyRune = runeStrict(cell.replyRune);
  const roles: [RoleAggregate, RoleAggregate] = [emptyRoleAggregate(), emptyRoleAggregate()];
  const internalOpener = {
    ai: { games: 0, wins: 0, draws: 0, losses: 0 },
    me: { games: 0, wins: 0, draws: 0, losses: 0 },
  };
  const result: CellResult = {
    ...cell,
    cellSeed: deriveCellSeed(cell),
    games: options.games,
    openerWins: 0, draws: 0, replyWins: 0, outcomePoints2: 0,
    openerScoreSum: 0, openerScoreSquaredSum: 0, replyScoreSum: 0, replyScoreSquaredSum: 0,
    marginSum: 0, marginSquaredSum: 0,
    placementsSum: 0, placementsSquaredSum: 0, placementsMin: Infinity, placementsMax: 0,
    actionsSum: 0, actionsSquaredSum: 0,
    kills: [0, 0], bounty: [0, 0], turnDraws: 0, fateDraws: 0, totalSupplyDraws: 0,
    terminalReasons: emptyTerminalReasons(), roles, internalOpener,
  };

  for (let game = 0; game < options.games; game++) {
    const openerPlayer = (game % 2 ? ME : AI) as Player;
    const played = playMatchupGame({
      gameSeed: deriveGameSeed(cell, game), mode: mode.mode, openerRune, replyRune,
      castRule: cell.castRule, openerPlayer, depth: options.depth,
      riskWeight: options.riskWeight, opponentWeight: options.opponentWeight,
      demands: options.demands, uses: options.uses,
    });
    const seat = openerPlayer === AI ? internalOpener.ai : internalOpener.me;
    seat.games++;
    if (played.openerScore > played.replyScore) { result.openerWins++; seat.wins++; result.outcomePoints2 += 2; }
    else if (played.openerScore < played.replyScore) { result.replyWins++; seat.losses++; }
    else { result.draws++; seat.draws++; result.outcomePoints2++; }
    result.openerScoreSum += played.openerScore;
    result.openerScoreSquaredSum += played.openerScore ** 2;
    result.replyScoreSum += played.replyScore;
    result.replyScoreSquaredSum += played.replyScore ** 2;
    const margin = played.openerScore - played.replyScore;
    result.marginSum += margin;
    result.marginSquaredSum += margin ** 2;
    result.placementsSum += played.placements;
    result.placementsSquaredSum += played.placements ** 2;
    result.placementsMin = Math.min(result.placementsMin, played.placements);
    result.placementsMax = Math.max(result.placementsMax, played.placements);
    const actions = played.placements + played.casts[0].length + played.casts[1].length;
    result.actionsSum += actions;
    result.actionsSquaredSum += actions ** 2;
    result.kills[0] += played.kills[0]; result.kills[1] += played.kills[1];
    result.bounty[0] += played.bounty[0]; result.bounty[1] += played.bounty[1];
    result.turnDraws += played.turnDraws;
    result.fateDraws += played.fateDraws;
    result.totalSupplyDraws += played.turnDraws + played.fateDraws;
    result.terminalReasons[played.terminalReason]++;
    for (let role = 0 as 0 | 1; role < 2; role = (role + 1) as 0 | 1) {
      const records = played.casts[role];
      const aggregate = roles[role];
      aggregate.casts += records.length;
      if (records.length) aggregate.gamesWithCast++;
      aggregate.legalCastOpportunities += played.legalCastOpportunities[role];
      aggregate.unusedCharges += played.chargesLeft[role];
      aggregate.chargesSpentHistogram[String(records.length)] =
        (aggregate.chargesSpentHistogram[String(records.length)] ?? 0) + 1;
      for (const cast of records) {
        const frac = cast.turn / Math.max(played.placements, 1);
        aggregate.castTimingBins[Math.min(9, Math.floor(frac * 10))]++;
        if (frac >= 0.8) aggregate.lateCasts++;
        aggregate.immediateSwingCount++;
        aggregate.immediateSwingSum += cast.swing;
        aggregate.immediateSwingSquaredSum += cast.swing ** 2;
      }
    }
  }
  return result;
}

export function runSimulation(options: RunOptions) {
  const cells = planCells(options);
  const results: CellResult[] = [];
  for (let index = 0; index < cells.length; index++) {
    const result = runCell(cells[index], options);
    results.push(result);
    options.onCell?.(result, index + 1, cells.length);
  }
  const uses = options.uses ?? {};
  const demands = options.demands ?? {};
  const uniqueConfigs = new Set(cells.map((cell) =>
    `${cell.castRule}:${cell.modeId}:${cell.openerRune}:${cell.replyRune}`));
  return {
    schemaVersion: 1,
    simulatorVersion: SIMULATOR_VERSION,
    provenance: options.provenance ?? {},
    request: {
      gamesPerCell: options.games,
      seeds: options.seeds,
      castRules: options.castRules,
      modeIds: (options.modes ?? MODES).map((mode) => mode.id),
      openerRuneIds: (options.openerRunes ?? SPELLS).map(runeId),
      replyRuneIds: (options.replyRunes ?? SPELLS).map(runeId),
      factorialDesign: options.castRules.includes('one') && options.castRules.includes('chain')
        && !options.fullFactorial ? 'multi-use-reduced' : 'full',
    },
    policy: {
      placement: 'searchRoot', depth: options.depth ?? 2,
      riskWeight: options.riskWeight ?? 0.9, opponentWeight: options.opponentWeight ?? 1,
      cast: 'machineCast', defaultDemand: 16, demandOverrides: demands,
      uses: Object.fromEntries(SPELLS.map((rune) => [rune.id, effectiveUses(rune, uses)])),
      opponentRuneAware: false, charmAwarePlacementSearch: false,
      bountyBankAwareSearch: false, limitedHorizonAwareSearch: false,
    },
    seedDerivation: 'rune-matchups-v{version}#{baseSeed}#{castRule}#{mode}#{opener}#{reply}#game:{index}; domains #supply, #search-opener, #search-reply',
    fieldSemantics: {
      roleArrayOrder: ['opener', 'reply'],
      roleOrderedFields: ['kills', 'bounty', 'roles'],
      legalCastOpportunities: 'cast-decision evaluations where the role has a charge and at least one legal target before consulting machineCast',
      castTimingBin: 'min(9, floor(10 * cast.turn / max(game.placements, 1))); bin k covers [k/10, (k+1)/10), with bin 9 also receiving 1.0',
      lateCastThreshold: 'cast.turn / max(game.placements, 1) >= 0.8',
    },
    roster: SPELLS.map((rune) => ({ id: rune.id, uses: effectiveUses(rune, uses) })),
    modes: (options.modes ?? MODES).map(({ id, mode, weight }) => ({ id, mode, weight })),
    plan: {
      mechanicalConfigurations: uniqueConfigs.size,
      cellRecords: cells.length,
      totalGames: cells.length * options.games,
      replicationCount: options.seeds.length,
      branchSensitiveRunes: SPELLS.filter((rune) => effectiveUses(rune, uses) > 1).map((rune) => rune.id),
    },
    cells: results,
  };
}

const VALUE_FLAGS = new Set([
  '--seed', '--cast-rule', '--mode', '--opener', '--reply', '--games', '--depth',
  '--risk-weight', '--opponent-weight', '--tune', '--uses', '--output',
]);
const REPEATABLE_VALUE_FLAGS = new Set(['--seed', '--tune', '--uses']);
const BOOLEAN_FLAGS = new Set(['--full-factorial', '--quiet', '--help']);

export function validateCliArgv(argv: string[]): void {
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (BOOLEAN_FLAGS.has(flag)) {
      if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
      seen.add(flag);
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) {
      throw new Error(flag.startsWith('-') ? `Unknown option: ${flag}` : `Unexpected argument: ${flag}`);
    }
    if (seen.has(flag) && !REPEATABLE_VALUE_FLAGS.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    index++;
  }
}

function values(flag: string): string[] {
  return process.argv.flatMap((value, index) => process.argv[index - 1] === flag ? [value] : []);
}

function value(flag: string, fallback?: string): string | undefined {
  const found = values(flag);
  return found.length ? found[found.length - 1] : fallback;
}

function positiveInt(flag: string, fallback: number): number {
  const parsed = +(value(flag, String(fallback)) ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function numberValue(flag: string, fallback: number): number {
  const parsed = +(value(flag, String(fallback)) ?? fallback);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a finite number.`);
  return parsed;
}

function ids(flag: string, fallback: string): string[] {
  return (value(flag, fallback) ?? fallback).split(',').filter(Boolean);
}

function assignments(flag: string, integer = false): Record<string, number> {
  const out: Record<string, number> = {};
  for (const assignment of values(flag)) {
    const [id, raw] = assignment.split('=');
    const rune = SPELLS.find((candidate) => candidate.id === id);
    const n = +raw;
    if (!rune || !Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
      throw new Error(`Invalid ${flag} assignment: ${assignment}`);
    }
    out[id] = n;
  }
  return out;
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function collectProvenance(): Record<string, unknown> {
  const files = [
    'tools/rune-matchups.ts', 'src/core/rules.ts', 'src/core/spells.ts',
    'src/core/spell-policy.ts', 'src/core/ai.ts', 'src/core/dice.ts', 'src/core/modes.ts',
    'src/config.ts',
  ];
  let gitHead = 'unavailable', dirty = true;
  try {
    gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
  } catch { /* provenance remains explicit rather than aborting the simulation */ }
  return {
    node: process.version,
    gitHead,
    dirty,
    fileSha256: Object.fromEntries(files.map((file) => [file, sha256(file)])),
  };
}

function help(): string {
  return `Usage: node --experimental-strip-types tools/rune-matchups.ts [options]

Required:
  --seed ID                 repeat for independent replications
  --cast-rule one|chain|both

Selection:
  --mode all|id,id          default all
  --opener all|id,id|none   default all
  --reply all|id,id|none    default all

Measurement:
  --games N                 games per directed cell, default 3000
  --depth N                 placement search depth, default 2
  --tune rune=N             repeatable cast demand override
  --uses rune=N             repeatable charge override
  --full-factorial          duplicate invariant cells under both cast rules
  --output PATH             write JSON here; otherwise stdout
  --quiet                   suppress progress on stderr`;
}

async function main() {
  validateCliArgv(process.argv.slice(2));
  if (process.argv.includes('--help')) { console.log(help()); return; }
  const seeds = values('--seed');
  const castArg = value('--cast-rule');
  if (!castArg || !['one', 'chain', 'both'].includes(castArg)) throw new Error('--cast-rule must be one, chain, or both.');
  const castRules: CastRule[] = castArg === 'both' ? ['one', 'chain'] : [castArg as CastRule];
  const quiet = process.argv.includes('--quiet');
  const report = runSimulation({
    games: positiveInt('--games', 3000),
    seeds,
    castRules,
    modes: strictModes(ids('--mode', 'all')),
    openerRunes: strictRunes(ids('--opener', 'all')),
    replyRunes: strictRunes(ids('--reply', 'all')),
    depth: positiveInt('--depth', 2),
    riskWeight: numberValue('--risk-weight', 0.9),
    opponentWeight: numberValue('--opponent-weight', 1),
    demands: assignments('--tune'),
    uses: assignments('--uses', true),
    fullFactorial: process.argv.includes('--full-factorial'),
    provenance: collectProvenance(),
    onCell: (cell, completed, total) => {
      if (!quiet) console.error(`· ${completed}/${total} ${cell.baseSeed} ${cell.castRule} ${cell.modeId} ${cell.openerRune}→${cell.replyRune}`);
    },
  });
  const json = JSON.stringify(report, null, 2) + '\n';
  const output = value('--output');
  if (output) {
    const target = path.resolve(output);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, json);
  } else {
    process.stdout.write(json);
  }
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
