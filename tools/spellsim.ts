// Spell candidate measurement — self-play, seeded, pure Node. NOT a gate:
// this is the "measure, don't guess" tool behind the spell roster decision
// (see docs/STATUS.md §6). It answers three questions per spell:
//
//   1. POWER    — one-sided: a holder vs a bare twin. Win% is the headline.
//   2. TIMING   — symmetric (both hold, like a real spell game): when do
//                 casts actually happen? A pile-up in the last plies is the
//                 endgame-sniping degeneracy that killed COLUMN SWAP.
//   3. TEXTURE  — cast rate and realized swing: does the spell participate,
//                 and how hard does it hit when it does?
//
// Placement play is the offline Medium anchor (depth 2, risk .9) — the same
// yardstick botbench measures the bot ladder against. Casting is a per-spell
// heuristic policy (TUNE below); results are a FLOOR, not a ceiling — a
// smarter caster can only be stronger, so a spell that already measures hot
// here is hot, while a cold one might still be sharper in human hands.
//
// Run: node --experimental-strip-types tools/spellsim.ts
//      [--games N] [--depth D] [--spell id[,id]] [--seed N] [--tune id=T]
import {
  AI, ME, SPEC, emptyBoard, legalCols, applyMove, totalOf, isOver, isFull, isShielded,
  cloneSt, freshCharm, boardTotalMode, colScore,
  CLASSIC, ROWSWITCH, COLSHIELD, SINGLESTRIKE, BOUNTY, LIMITED,
  type GameState, type Player, type Mode, type CharmSt,
} from '../src/core/rules.ts';
import { searchRoot, setRiskW, setOppW } from '../src/core/ai.ts';
import { SPELLS, CANDIDATES, swingOf, bestTarget, type SpellSpec, type CastCtx } from '../src/core/spells.ts';
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

/* ---- casting policies: when is the rune worth its charge? ---- */
const TUNE: Record<string, number> = { fate: 2, nudge: 4, ward: 24, sunder: 12, pilfer: 10, swap: 16 };
const USES: Record<string, number> = {};          // --uses id=N overrides spec.uses for a run
for (const [flag, store] of [['--tune', TUNE], ['--uses', USES]] as const) {
  for (const t of process.argv.flatMap((a, i) => process.argv[i - 1] === flag ? [a] : [])) {
    const [k, v] = t.split('=');
    store[k] = +v;
  }
}

/* the immediate worth of placing this die as well as possible: the best
   swing in the score difference one placement can buy (charm-blind) */
function placeGain(st: GameState, who: Player, die: number, mode: Mode, charm?: CharmSt): number {
  const foe = (1 - who) as Player;
  const lead = (s: GameState) => boardTotalMode(s[who], mode) - boardTotalMode(s[foe], mode);
  let best = -Infinity;
  for (const c of legalCols(st[who])) {
    const ns = cloneSt(st);
    const scratch = charm && { wards: [charm.wards[0].slice(), charm.wards[1].slice()] as [number[], number[]],
                               sunder: [charm.sunder[0], charm.sunder[1]] as [boolean, boolean] };
    applyMove(ns, who, c, die, mode, scratch);
    const g = lead(ns) - lead(st);
    if (g > best) best = g;
  }
  return best;
}

/* a cast that settles the game must settle it in the caster's favour —
   the same guard aiSpellTurn ships for the offline CPU */
function safeToEnd(st: GameState, who: Player, spell: SpellSpec, col: number, ctx: CastCtx): boolean {
  const after = cloneSt(st);
  spell.apply(after, who, col, ctx);
  if (!isFull(after[ME]) && !isFull(after[AI])) return true;
  const foe = (1 - who) as Player;
  return boardTotalMode(after[who], ctx.mode) > boardTotalMode(after[foe], ctx.mode);
}

/* returns the target column to cast at (−1 for self), or null: hold the charge */
function castPolicy(spell: SpellSpec, st: GameState, who: Player, ctx: CastCtx): number | null {
  const T = TUNE[spell.id] ?? 12;
  const mode = ctx.mode;
  if (spell.id === 'fate') {
    if (!spell.legal(st, who, -1, ctx)) return null;
    let mean = 0;
    for (let f = 1; f <= DICE_FACES; f++) mean += placeGain(st, who, f, mode) / DICE_FACES;
    return placeGain(st, who, ctx.die, mode) < mean - T ? -1 : null;
  }
  if (spell.id === 'nudge') {
    if (!spell.legal(st, who, -1, ctx)) return null;
    const up = ctx.die % DICE_FACES + 1;
    return placeGain(st, who, up, mode) - placeGain(st, who, ctx.die, mode) >= T ? -1 : null;
  }
  if (spell.id === 'ward') {
    // guard the fattest column an enemy placement can still reach
    const foe = (1 - who) as Player;
    let bestC = -1, bestV = 0;
    for (let c = 0; c < SPEC.cols; c++) {
      if (!spell.legal(st, who, c, ctx)) continue;
      if (isShielded(st[who][c], mode)) continue;              // already safe
      if (st[foe][c].length >= SPEC.rows) continue;            // no strike can come
      const v = colScore(st[who][c]);
      if (v > bestV) { bestV = v; bestC = c; }
    }
    return bestV >= T ? bestC : null;
  }
  if (spell.id === 'sunder') {
    if (!spell.legal(st, who, -1, ctx)) return null;
    const scratch = freshCharm();
    scratch.sunder[who] = true;
    const wide = placeGain(st, who, ctx.die, mode, scratch);
    return wide - placeGain(st, who, ctx.die, mode) >= T ? -1 : null;
  }
  // board-targeting spells (pilfer, and the swap baseline): best swing vs demand,
  // with the last-slot rule — a charge that would die with the game is free
  const pick = bestTarget(st, who, spell, mode, ctx);
  if (!pick) return null;
  const room = st[who].reduce((n, c) => n + (SPEC.rows - c.length), 0);
  const demand = room <= 1 ? 1 : T;
  if (pick.swing < demand) return null;
  return safeToEnd(st, who, spell, pick.col, ctx) ? pick.col : null;
}

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
      const col = castPolicy(spell, st, turn, ctx);
      if (col !== null && spell.legal(st, turn, col, ctx)) {
        const swing = swingOf(st, turn, spell, col, mode, ctx);
        spell.apply(st, turn, col, ctx);
        charges[turn]--;
        castsAt[turn].push({ ply: plies, swing });
        if (isFull(st[ME]) || isFull(st[AI])) { over = true; break; }
      }
    }
    setRiskW(0.9); setOppW(1);
    const col = searchRoot(st, turn, hand, DEPTH, mode).c;
    banked[turn] += applyMove(st, turn, col, hand, mode, charm);
    plies++;
    if (isOver(st[turn], bag ? bag.length : null)) break;
    turn = (1 - turn) as Player;
  }
  const a = totalOf(st[AI], mode === BOUNTY ? banked[AI] : 0, mode);
  const m = totalOf(st[ME], mode === BOUNTY ? banked[ME] : 0, mode);
  // win from the HOLDER's perspective in one-sided runs; seat 0 (AI) otherwise
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

const bySpell = (id: string) => [...SPELLS, ...CANDIDATES].find((s) => s.id === id)!;
const roster = ONLY.length ? ONLY.map(bySpell) : [bySpell('swap'), ...CANDIDATES];

/* classic for everyone, plus the mode each spell interacts with hardest */
const EXTRA: Record<string, Mode[]> = {
  swap: [SINGLESTRIKE], ward: [COLSHIELD], pilfer: [COLSHIELD],
  sunder: [SINGLESTRIKE], fate: [LIMITED], nudge: [],
};

const t0 = performance.now();
const report: Record<string, unknown> = { games: GAMES, depth: DEPTH, tune: TUNE };
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
