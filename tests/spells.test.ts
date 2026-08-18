// Gate for the spell layer's RULES (core/spells) — pure, no browser.
// Two things are guarded here: that a spell's effect is exactly what it claims,
// and that the registry stays well-formed as spells are added (unique ids, a
// real number of uses, a legality function that actually refuses something).
// Run: node --experimental-strip-types tests/spells.test.ts
import { SPEC, emptyBoard, boardTotal, CLASSIC, ROWSWITCH, type GameState, AI, ME } from '../src/core/rules.ts';
import { SPELLS, spellById, freshCharges, swingOf, bestTarget } from '../src/core/spells.ts';

const problems: string[] = [];
const check = (c: boolean, m: string, x?: unknown) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

/* ---- the registry itself ---- */
{
  const ids = SPELLS.map((s) => s.id);
  check(new Set(ids).size === ids.length, 'spell ids must be unique', ids);
  for (const s of SPELLS) {
    check(s.uses >= 1, 'a spell with no uses can never be cast: ' + s.id, s.uses);
    check(!!s.name && !!s.blurb && !!s.detail, 'spell missing its words: ' + s.id);
    check(s.target === 'column', 'unknown target kind: ' + s.id, s.target);
  }
  check(spellById('nonsense') === null, 'unknown id is null, never a silent fallback');
  check(spellById(null) === null, 'null id is null');
  // a hand holds the ONE spell that was picked, with its uses — nothing else
  for (const s of SPELLS) {
    const hand = freshCharges(s.id);
    check(hand[s.id] === s.uses, 'a hand must deal the picked spell its uses: ' + s.id, hand);
    check(Object.keys(hand).length === 1, 'a hand holds exactly what was brought: ' + s.id, hand);
  }
  // NONE, and anything this build does not recognise, deal an EMPTY hand — the
  // one thing the runtime asks before showing a rail or allowing a cast
  for (const none of ['', 'nonsense', null, undefined]) {
    check(Object.keys(freshCharges(none)).length === 0, 'must deal an empty hand: ' + JSON.stringify(none),
      freshCharges(none));
  }
}

/* ---- COLUMN SWAP: the effect ---- */
const swap = spellById('swap')!;
check(!!swap, 'the swap spell exists');

{
  // ME holds a fat column (three 6s = 54), AI a thin one (a single 2)
  const st: GameState = [[[2], [], []], [[6, 6, 6], [1], []]];
  check(boardTotal(st[ME]) === 55 && boardTotal(st[AI]) === 2, 'baseline totals',
    { me: boardTotal(st[ME]), ai: boardTotal(st[AI]) });
  check(swap.legal(st, ME, 0), 'swapping unequal columns is legal');
  swap.apply(st, ME, 0);
  check(JSON.stringify(st[ME][0]) === '[2]', 'caster received the enemy column', st[ME][0]);
  check(JSON.stringify(st[AI][0]) === '[6,6,6]', 'enemy received the caster column', st[AI][0]);
  // the multiplier travels with the dice — the stack is worth 54 on either side
  check(boardTotal(st[ME]) === 3 && boardTotal(st[AI]) === 54,
    'scores follow the dice across the swap', { me: boardTotal(st[ME]), ai: boardTotal(st[AI]) });
  // untouched columns stay untouched
  check(JSON.stringify(st[ME][1]) === '[1]' && JSON.stringify(st[AI][1]) === '[]',
    'only the named column moved', [st[ME][1], st[AI][1]]);
}

{
  // it is its own inverse: casting twice on the same column restores the board
  const st: GameState = [[[3, 3], [4], [5]], [[1], [2, 2, 2], []]];
  const before = JSON.stringify(st);
  swap.apply(st, ME, 1);
  check(JSON.stringify(st) !== before, 'a swap changes something');
  swap.apply(st, ME, 1);
  check(JSON.stringify(st) === before, 'swapping back restores the board');
  // and it does not matter WHO casts it — the pair is symmetrical
  const a: GameState = [[[3, 3], [], []], [[1], [], []]];
  const b: GameState = [[[3, 3], [], []], [[1], [], []]];
  swap.apply(a, ME, 0); swap.apply(b, AI, 0);
  check(JSON.stringify(a) === JSON.stringify(b), 'either caster produces the same swap', [a, b]);
}

/* ---- COLUMN SWAP: legality is the only failure path ---- */
{
  const st: GameState = [[[4], [], []], [[4], [], []]];
  check(!swap.legal(st, ME, 0), 'identical columns are not a legal target (the charge would buy nothing)');
  check(!swap.legal(st, ME, 1), 'two empty columns are not a legal target');
  check(!swap.legal(st, ME, -1), 'a negative column is refused');
  check(!swap.legal(st, ME, SPEC.cols), 'a column past the board is refused');
  check(!swap.legal(st, ME, 1.5 as number), 'a fractional column is refused');
  st[ME][1] = [5];
  check(swap.legal(st, ME, 1), 'one side holding dice makes it legal');
}

/* ---- what a cast is WORTH: the question the CPU's policy asks ---- */
{
  // AI (0) holds a single 2 in column 0; ME (1) holds three 6s there (54).
  // Swapping column 0 as the AI: it ends up +52 (54 gained, its own 2 given
  // away) and the human ends up −52. The swing is measured in the DIFFERENCE,
  // so both ends count: 104. (Not 108 — the caster's own dice travel too.)
  const st: GameState = [[[2], [], []], [[6, 6, 6], [1], []]];
  check(swingOf(st, AI, swap, 0, CLASSIC) === 104, 'swing counts both ends of the trade',
    swingOf(st, AI, swap, 0, CLASSIC));
  // and from the other side the very same trade is exactly as bad
  check(swingOf(st, ME, swap, 0, CLASSIC) === -104, 'the swing is symmetric',
    swingOf(st, ME, swap, 0, CLASSIC));
  // swingOf must not disturb the board it is asked about
  const before = JSON.stringify(st);
  swingOf(st, AI, swap, 0, CLASSIC);
  check(JSON.stringify(st) === before, 'weighing a cast must not play it');

  const best = bestTarget(st, AI, swap, CLASSIC);
  check(best?.col === 0 && best.swing === 104, 'the best target is the big one', best);
  // a board where nothing is legal (every facing pair identical) has no target
  check(bestTarget([[[4], [], []], [[4], [], []]] as GameState, AI, swap, CLASSIC) === null,
    'no legal target must be null, not column 0');
  // ties go to the lower column, so the machine is deterministic
  const tied: GameState = [[[3], [3], []], [[5], [5], []]];
  check(bestTarget(tied, AI, swap, CLASSIC)?.col === 0, 'ties take the lower column',
    bestTarget(tied, AI, swap, CLASSIC));
  // and the weighing follows the MODE: under ROW SWITCH columns score nothing
  // on their own, so the same trade is worth something different
  check(swingOf(st, AI, swap, 0, ROWSWITCH) !== swingOf(st, AI, swap, 0, CLASSIC),
    'the swing must be mode-aware', {
      classic: swingOf(st, AI, swap, 0, CLASSIC), row: swingOf(st, AI, swap, 0, ROWSWITCH) });
}

/* ---- a swap can fill a grid: the flow must ask both boards, not the mover's ----
   This is the shape flow/spells guards with isFull(ME) || isFull(AI). Pinned
   here so the reason survives even if that call site is refactored. */
{
  const st: GameState = [emptyBoard(), emptyBoard()];
  st[ME][0] = [1, 2, 3]; st[ME][1] = [1, 2, 3]; st[ME][2] = [1, 2];   // 8 dice, one gap
  st[AI][2] = [4, 5, 6];                                              // their column 2 is full
  swap.apply(st, ME, 2);
  const filled = st[ME].reduce((n, c) => n + c.length, 0);
  check(filled === SPEC.cols * SPEC.rows, 'a swap CAN fill the caster grid', filled);
  check(st[AI][2].length === 2, 'and hand the shorter stack back', st[AI][2]);
}

console.log(JSON.stringify({ problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
