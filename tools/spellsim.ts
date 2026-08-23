// Spell roster measurement — self-play, seeded, pure Node. NOT a gate:
// this is the "measure, don't guess" tool behind the spell roster decision
// (see docs/STATUS.md §6). It answers three questions per spell:
//
//   1. POWER    — one-sided: a holder vs a bare twin. Win% is the headline.
//   2. TIMING   — symmetric (both hold, like a real spell game): when do
//                 casts actually happen? A pile-up in the last plies is the
//                 endgame-sniping degeneracy that retired COLUMN SWAP
//                 (70.5% classic / 81.8% singlestrike, 2026-08-21).
//   3. TEXTURE  — cast rate and realized swing: does the spell participate,
//                 and how hard does it hit when it does?
//
// Placement play is the offline Medium anchor (depth 2, risk .9) — the same
// yardstick botbench measures the bot ladder against. Casting is
// core/spells machineCast — THE policy the offline CPU ships, so what is
// measured and what plays are never two policies. `--tune id=N` overrides
// the demand knob per spell (the CPU's DEMANDS are easy 30 / medium 16 /
// hard 10); results are a FLOOR — a smarter caster can only be stronger.
//
// Run: node --experimental-strip-types tools/spellsim.ts
//      [--games N] [--depth D] [--spell id[,id]] [--seed N]
//      [--tune id=DEMAND] [--uses id=N]
import {
  AI, ME, emptyBoard, applyMove, totalOf, isOver, isFull, freshCharm,
  CLASSIC, ROWSWITCH, COLSHIELD, SINGLESTRIKE, BOUNTY, LIMITED,
  type GameState, type Player, type Mode,
} from '../src/core/rules.ts';
import { searchRoot } from '../src/core/ai.ts';
import { SPELLS, machineCast, swingOf, type SpellSpec, type CastCtx } from '../src/core/spells.ts';
import { makeBag } from '../src/core/dice.ts';
import { DICE_FACES } from '../src/config.ts';

/* ---- deterministic runs: mulberry32 over Math.random (botbench pattern) ---- */
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const GAMES = +arg('games', '600');
const DEPTH = +arg('depth', '2');
const ONLY = arg('spell', '').split(',').filter(Boolean);
const seeded = (a: number) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Math.random = seeded(+arg('seed', '20260821'));
const rnd = (n: number) => Math.floor(Math.random() * n);

/* the demand each holder plays at — the CPU's Medium unless swept */
const TUNE: Record<string, number> = {};
const USES: Record<string, number> = {};          // --uses id=N overrides spec.uses
for (const [flag, store] of [['--tune', TUNE], ['--uses', USES]] as const) {
  for (const t of process.argv.flatMap((a, i) => process.argv[i - 1] === flag ? [a] : [])) {
    const [k, v] = t.split('=');
    store[k] = +v;
  }
}
const MEDIUM_DEMAND = 16;

/* ---- one game ---- */
interface GameResult { win: number; casts: { frac: number; swing: number }[][]; plies: number }

function playGame(spell: SpellSpec, holds: [boolean, boolean], mode: Mode, first: Player): GameResult {
  const st: GameState = [emptyBoard(), emptyBoard()];
  const charm = freshCharm();
  const banked = [0, 0];
  const bag = mode === LIMITED ? makeBag(Math.random) : null;
  const uses = USES[spell.id] ?? spell.uses;
  const charges: [number, number] = [holds[0] ? uses : 0, holds[1] ? uses : 0];
  const castsAt: { ply: number; swing: number }[][] = [[], []];
  let turn = first, plies = 0, over = false;

  while (!over) {
    let hand = bag ? bag.shift()! : 1 + rnd(DICE_FACES);
    if (charges[turn] > 0) {
      const ctx: CastCtx = {
        mode, die: hand, bagLeft: bag ? bag.length : null, charm,
        setDie: (v) => { hand = v; },
        draw: () => bag ? bag.shift()! : 1 + rnd(DICE_FACES),
      };
      const col = machineCast(st, turn, spell, ctx, TUNE[spell.id] ?? MEDIUM_DEMAND);
      if (col !== null) {
        const swing = swingOf(st, turn, spell, col, mode, ctx);
        spell.apply(st, turn, col, ctx);
        charges[turn]--;
        castsAt[turn].push({ ply: plies, swing });
        if (isFull(st[ME]) || isFull(st[AI])) { over = true; break; }
      }
    }
    const col = searchRoot(st, turn, hand, DEPTH, {
      mode, random: Math.random, riskWeight: 0.9, opponentWeight: 1,
    }).c;
    banked[turn] += applyMove(st, turn, col, hand, mode, charm);
    plies++;
    if (isOver(st[turn], bag ? bag.length : null)) break;
    turn = (1 - turn) as Player;
  }
  const a = totalOf(st[AI], mode === BOUNTY ? banked[AI] : 0, mode);
  const m = totalOf(st[ME], mode === BOUNTY ? banked[ME] : 0, mode);
  return {
    win: a > m ? 1 : a < m ? 0 : 0.5,
    casts: castsAt.map((seat) => seat.map((c) => ({ frac: c.ply / Math.max(plies, 1), swing: c.swing }))),
    plies,
  };
}

/* ---- the experiments ---- */
const MODE_NAME: Record<number, string> = {
  [CLASSIC]: 'classic', [ROWSWITCH]: 'rowswitch', [COLSHIELD]: 'colshield',
  [SINGLESTRIKE]: 'singlestrike', [BOUNTY]: 'bounty', [LIMITED]: 'limited',
};

function oneSided(spell: SpellSpec, mode: Mode, n: number) {
  let w = 0, castsMade = 0, swingSum = 0;
  for (let g = 0; g < n; g++) {
    const holder = (g % 2) as Player;                       // seat alternates: first-move edge cancels
    const first = ((g >> 1) % 2) as Player;                 // and so does who moves first
    const r = playGame(spell, [holder === AI, holder === ME], mode, first);
    w += holder === AI ? r.win : 1 - r.win;
    castsMade += r.casts[holder].length;
    for (const c of r.casts[holder]) swingSum += c.swing;
  }
  return {
    winPct: +(100 * w / n).toFixed(1),
    castsPerGame: +(castsMade / n).toFixed(2),
    meanSwing: castsMade ? +(swingSum / castsMade).toFixed(1) : 0,
  };
}

function symmetric(spell: SpellSpec, mode: Mode, n: number) {
  const fracs: number[] = [];
  let games = 0, cast = 0;
  for (let g = 0; g < n; g++) {
    const r = playGame(spell, [true, true], mode, (g % 2) as Player);
    games++;
    const all = [...r.casts[0], ...r.casts[1]];
    if (all.length) cast++;
    for (const c of all) fracs.push(c.frac);
  }
  fracs.sort((a, b) => a - b);
  const q = (p: number) => fracs.length ? +(fracs[Math.min(fracs.length - 1, Math.floor(p * fracs.length))]).toFixed(2) : null;
  return {
    gamesWithCast: +(100 * cast / games).toFixed(1),
    castTiming: { q25: q(0.25), median: q(0.5), q75: q(0.75) },
    lateCastPct: fracs.length ? +(100 * fracs.filter((f) => f >= 0.8).length / fracs.length).toFixed(1) : 0,
  };
}

const roster = ONLY.length ? ONLY.map((id) => SPELLS.find((s) => s.id === id)!) : [...SPELLS];

/* classic for everyone, plus the mode each spell interacts with hardest */
const EXTRA: Record<string, Mode[]> = {
  ward: [COLSHIELD], pilfer: [COLSHIELD], sunder: [SINGLESTRIKE], fate: [LIMITED], nudge: [],
  // ANVIL only fires on a FULL column, which is exactly what COLSHIELD makes
  // untouchable — so that is the pairing that decides it. SINGLESTRIKE keeps
  // stacks alive longer, which means more full columns to forge.
  anvil: [COLSHIELD, SINGLESTRIKE],
};

const t0 = performance.now();
const report: Record<string, unknown> = { games: GAMES, depth: DEPTH, tune: TUNE, uses: USES };
for (const spell of roster) {
  const modes = [CLASSIC as Mode, ...(EXTRA[spell.id] ?? [])];
  const rows: Record<string, unknown> = {};
  for (const mode of modes) {
    rows[MODE_NAME[mode]] = { ...oneSided(spell, mode, GAMES), ...symmetric(spell, mode, GAMES) };
    console.error(`· ${spell.id} / ${MODE_NAME[mode]} done (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
  }
  report[spell.id] = rows;
}
console.log(JSON.stringify(report, null, 2));
