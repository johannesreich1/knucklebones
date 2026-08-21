// Gate for the spell layer's RULES (core/spells) — pure, no browser.
// Two things are guarded here: that a spell's effect is exactly what it claims,
// and that the registry stays well-formed as spells are added (unique ids, a
// real number of uses, a legality function that actually refuses something).
// Run: node --experimental-strip-types tests/spells.test.ts
import { SPEC, emptyBoard, boardTotal, applyMove, freshCharm, CLASSIC, ROWSWITCH, COLSHIELD,
         type GameState, type Mode, AI, ME } from '../src/core/rules.ts';
import { SPELLS, CANDIDATES, spellById, freshCharges, swingOf, bestTarget,
         type CastCtx } from '../src/core/spells.ts';

const problems: string[] = [];
const check = (c: boolean, m: string, x?: unknown) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

/* ---- the registry itself (the shipped roster AND the measured bench) ---- */
{
  const ids = [...SPELLS, ...CANDIDATES].map((s) => s.id);
  check(new Set(ids).size === ids.length, 'spell ids must be unique', ids);
  for (const s of [...SPELLS, ...CANDIDATES]) {
    check(s.uses >= 1, 'a spell with no uses can never be cast: ' + s.id, s.uses);
    check(!!s.name && !!s.blurb && !!s.detail, 'spell missing its words: ' + s.id);
    check(s.target === 'column' || s.target === 'self', 'unknown target kind: ' + s.id, s.target);
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

/* ===================== THE CANDIDATES =====================
   Not yet dealt — the picker and the rail iterate SPELLS only — but their
   RULES are final enough to measure (tools/spellsim.ts), so they are pinned
   with the same care as the shipped roster. */

const cand = (id: string) => CANDIDATES.find((s) => s.id === id)!;
/* a real cast context, with a hand the test can watch */
function mkCtx(over: Partial<CastCtx> & { drawn?: number[] } = {}): CastCtx & { got: number[] } {
  const got: number[] = [];
  const drawn = over.drawn ?? [5];
  return {
    mode: over.mode ?? CLASSIC as Mode,
    die: over.die ?? 3,
    bagLeft: over.bagLeft !== undefined ? over.bagLeft : null,
    charm: over.charm ?? freshCharm(),
    setDie(v: number) { got.push(v); },
    draw: () => drawn.shift() ?? 0,
    got,
  };
}

/* every candidate answers "not castable" to a flow that offers no ctx — the
   guarantee that nothing player-facing can reach them before the roster ships */
{
  const st: GameState = [[[2], [3], []], [[4], [], [5]]];
  for (const s of CANDIDATES) {
    check(!s.legal(st, ME, 0), 'a candidate without a ctx must refuse: ' + s.id);
  }
}

/* ---- FATE: discard and draw ---- */
{
  const fate = cand('fate');
  const st: GameState = [emptyBoard(), emptyBoard()];
  const ctx = mkCtx({ die: 2, drawn: [6] });
  check(fate.legal(st, ME, -1, ctx), 'fate castable with an endless supply');
  fate.apply(st, ME, -1, ctx);
  check(ctx.got.length === 1 && ctx.got[0] === 6, 'the hand received exactly the drawn die', ctx.got);
  check(!fate.legal(st, ME, -1, mkCtx({ bagLeft: 0 })), 'an empty bag has nothing to draw — refused');
  check(fate.legal(st, ME, -1, mkCtx({ bagLeft: 3 })), 'a live bag can be drawn from');
}

/* ---- NUDGE: one pip up, 6 wraps to 1 ---- */
{
  const nudge = cand('nudge');
  const st: GameState = [emptyBoard(), emptyBoard()];
  for (const [before, after] of [[1, 2], [3, 4], [5, 6], [6, 1]] as const) {
    const ctx = mkCtx({ die: before });
    nudge.apply(st, ME, -1, ctx);
    check(ctx.got[0] === after, `nudge turns ${before} into ${after}`, ctx.got);
  }
}

/* ---- WARD: the mark, and what destruction does with it ---- */
{
  const ward = cand('ward');
  const ctx = mkCtx();
  const st: GameState = [[[], [], []], [[4, 4], [], []]];
  check(ward.legal(st, ME, 0, ctx), 'warding an own column is legal');
  ward.apply(st, ME, 0, ctx);
  check(ctx.charm.wards[ME][0] === 1, 'the mark landed on the caster side', ctx.charm.wards);
  check(!ward.legal(st, ME, 0, ctx), 'a second ward on the same column buys nothing — refused');
  check(!ward.legal(st, ME, 3, ctx), 'a column past the board is refused');

  // a strike that WOULD take dice fizzles, burns the ward, and kills nothing
  const killed = applyMove(st, AI, 0, 4, CLASSIC, ctx.charm);
  check(killed === 0, 'the warded strike destroys nothing (BOUNTY would bank nothing)', killed);
  check(String(st[ME][0]) === '4,4', 'the warded dice survive', st[ME][0]);
  check(ctx.charm.wards[ME][0] === 0, 'the ward burned out', ctx.charm.wards);
  // the next strike goes through — the ward was one strike, not a shield
  applyMove(st, AI, 0, 4, CLASSIC, ctx.charm);
  check(st[ME][0].length === 0, 'the second strike falls as normal', st[ME][0]);
}
{
  // a MISS costs the ward nothing
  const charm = freshCharm();
  charm.wards[ME][1] = 1;
  const st: GameState = [[[], [], []], [[], [2, 2], []]];
  applyMove(st, AI, 1, 5, CLASSIC, charm);          // a 5 into a column of 2s: no victims
  check(charm.wards[ME][1] === 1, 'a strike with no victims leaves the ward standing', charm.wards);
}

/* ---- SUNDER: the widened strike ---- */
{
  const sunder = cand('sunder');
  const ctx = mkCtx();
  const st: GameState = [[[], [], []], [[3, 5], [3, 3], [3]]];
  check(sunder.legal(st, AI, -1, ctx), 'sunder castable when unmarked');
  sunder.apply(st, AI, -1, ctx);
  check(ctx.charm.sunder[AI] === true, 'the mark is set on the caster');
  check(!sunder.legal(st, AI, -1, ctx), 'sunder cannot stack — refused while marked');

  const killed = applyMove(st, AI, 1, 3, CLASSIC, ctx.charm);
  check(killed === 4, 'the sundered 3 took every 3 on the board', killed);
  check(String(st[ME][0]) === '5' && st[ME][1].length === 0 && st[ME][2].length === 0,
    'each column resolved as its own strike', st[ME]);
  check(ctx.charm.sunder[AI] === false, 'one placement consumed the mark');
  // and the NEXT placement is a plain strike again
  const st2: GameState = [[[], [], []], [[6], [6], []]];
  applyMove(st2, AI, 0, 6, CLASSIC, ctx.charm);
  check(String(st2[ME][1]) === '6', 'the widened strike was one placement only', st2[ME]);
}
{
  // shields and wards answer per column, even under a sunder
  const charm = freshCharm();
  charm.sunder[AI] = true;
  charm.wards[ME][1] = 1;
  const st: GameState = [[[], [], []], [[2], [2, 2], [2, 6, 6]]];   // col 2 is full → shielded in COLSHIELD
  const killed = applyMove(st, AI, 0, 2, COLSHIELD, charm);
  check(killed === 1, 'only the open, unwarded column lost its dice', killed);
  check(st[ME][0].length === 0, 'the open column fell', st[ME][0]);
  check(String(st[ME][1]) === '2,2' && charm.wards[ME][1] === 0, 'the warded column absorbed and burned', st[ME][1]);
  check(String(st[ME][2]) === '2,6,6', 'the shielded column never answers', st[ME][2]);
}

/* ---- PILFER: one die crosses the centre line ---- */
{
  const pilfer = cand('pilfer');
  const ctx = mkCtx();
  const st: GameState = [[[2], [], []], [[6, 6], [], [1, 1, 1]]];
  check(pilfer.legal(st, AI, 0, ctx), 'a held enemy column with room facing is legal');
  pilfer.apply(st, AI, 0, ctx);
  check(String(st[AI][0]) === '2,6', 'the stolen die landed on top of the caster column', st[AI][0]);
  check(String(st[ME][0]) === '6', 'the enemy column lost exactly its top die', st[ME][0]);
  check(boardTotal(st[AI]) === 8, 'the arrival LANDS — nothing is struck by it', st[AI]);

  check(!pilfer.legal(st, AI, 1, ctx), 'an empty enemy column has nothing to steal');
  const full: GameState = [[[4, 4, 4], [], []], [[5], [], []]];
  check(!pilfer.legal(full, AI, 0, ctx), 'a full own column has no room to receive');
  // the shield's promise holds against spells too
  const shielded: GameState = [[[], [], []], [[3, 3, 3], [], []]];
  check(!pilfer.legal(shielded, AI, 0, mkCtx({ mode: COLSHIELD as Mode })),
    'a shielded column cannot be robbed');
  check(pilfer.legal(shielded, AI, 0, ctx), 'the same column is fair game outside COLSHIELD');
}

/* ---- the charm-blind path stays the pre-spell game ----
   A fresh charm with no marks must resolve every placement exactly as no
   charm at all — the guarantee that classic play never pays for the layer. */
{
  const a: GameState = [[[4, 2], [], [6]], [[4, 4], [1], [6, 6]]];
  const b: GameState = [[[4, 2], [], [6]], [[4, 4], [1], [6, 6]]];
  const ka = applyMove(a, AI, 0, 4, CLASSIC);
  const kb = applyMove(b, AI, 0, 4, CLASSIC, freshCharm());
  check(ka === kb && JSON.stringify(a) === JSON.stringify(b),
    'an unmarked charm changes nothing about a placement', { ka, kb });
}

console.log(JSON.stringify({ problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
