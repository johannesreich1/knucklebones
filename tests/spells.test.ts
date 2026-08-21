// Gate for the spell layer's RULES (core/spells) — pure, no browser.
// Three things are guarded here: that a spell's effect is exactly what it
// claims, that the registry stays well-formed as spells are added (unique
// ids, a real number of uses, a legality function that actually refuses
// something), and that the machine's shared policy (machineCast — the CPU
// and the balance harness both ask it) weighs casts the way the measured
// numbers assumed.
// Run: node --experimental-strip-types tests/spells.test.ts
import { SPEC, emptyBoard, boardTotal, applyMove, openStrikes, freshCharm,
         CLASSIC, ROWSWITCH, COLSHIELD,
         type GameState, type Mode, AI, ME } from '../src/core/rules.ts';
import { SPELLS, spellById, freshCharges, swingOf, bestTarget, machineCast,
         type CastCtx } from '../src/core/spells.ts';

const problems: string[] = [];
const check = (c: boolean, m: string, x?: unknown) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

/* ---- the registry itself ---- */
{
  const ids = SPELLS.map((s) => s.id);
  check(new Set(ids).size === ids.length, 'spell ids must be unique', ids);
  check(!ids.includes('swap'), 'COLUMN SWAP retired 2026-08-21 (70.5% one-sided) — it must not return', ids);
  for (const s of SPELLS) {
    check(s.uses >= 1, 'a spell with no uses can never be cast: ' + s.id, s.uses);
    check(!!s.name && !!s.blurb && !!s.detail && !!s.aim, 'spell missing its words: ' + s.id);
    check(s.target === 'column' || s.target === 'self', 'unknown target kind: ' + s.id, s.target);
  }
  check(spellById('nonsense') === null, 'unknown id is null, never a silent fallback');
  check(spellById(null) === null, 'null id is null');
  check(spellById('swap') === null, 'the retired swap must not resolve (persisted picks fall back to NONE)');
  // a hand holds the ONE spell that was picked, with its uses — nothing else
  for (const s of SPELLS) {
    const hand = freshCharges(s.id);
    check(hand[s.id] === s.uses, 'a hand must deal the picked spell its uses: ' + s.id, hand);
    check(Object.keys(hand).length === 1, 'a hand holds exactly what was brought: ' + s.id, hand);
  }
  // NONE, and anything this build does not recognise, deal an EMPTY hand — the
  // one thing the runtime asks before showing a rail or allowing a cast
  for (const none of ['', 'nonsense', 'swap', null, undefined]) {
    check(Object.keys(freshCharges(none)).length === 0, 'must deal an empty hand: ' + JSON.stringify(none),
      freshCharges(none));
  }
}

/* every spell needs the cast context: a caller with no hand to offer (an
   ungated flow, a stray call) is refused before anything moves */
{
  const st: GameState = [[[2], [3], []], [[4], [], [5]]];
  for (const s of SPELLS) {
    check(!s.legal(st, ME, 0), 'a spell without a ctx must refuse: ' + s.id);
  }
}

const spell = (id: string) => SPELLS.find((s) => s.id === id)!;
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

/* ---- FATE: discard and draw ---- */
{
  const fate = spell('fate');
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
  const nudge = spell('nudge');
  const st: GameState = [emptyBoard(), emptyBoard()];
  for (const [before, after] of [[1, 2], [3, 4], [5, 6], [6, 1]] as const) {
    const ctx = mkCtx({ die: before });
    nudge.apply(st, ME, -1, ctx);
    check(ctx.got[0] === after, `nudge turns ${before} into ${after}`, ctx.got);
  }
}

/* ---- WARD: the mark, and what destruction does with it ---- */
{
  const ward = spell('ward');
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
  const sunder = spell('sunder');
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

/* ---- openStrikes: the plan both drivers read (headless applyMove, and the
   animated flow) — and the only consumer of an armed sunder ---- */
{
  const st: GameState = [[[], [], []], [[4], [4, 4], []]];
  const narrow = openStrikes(st, AI, 1, 4, CLASSIC);
  check(narrow.length === 1 && narrow[0].col === 1 && String(narrow[0].victims) === '0,1',
    'without a charm the plan is the facing column alone', narrow);
  const charm = freshCharm();
  charm.sunder[AI] = true;
  charm.wards[ME][0] = 1;
  const wide = openStrikes(st, AI, 1, 4, CLASSIC, charm);
  check(wide.length === 2 && wide[0].warded && !wide[1].warded,
    'the sundered plan covers every matching column, wards flagged per column', wide);
  check(charm.sunder[AI] === false, 'reading the plan consumed the sunder — one placement, one strike');
  check(openStrikes(st, AI, 1, 4, CLASSIC, charm).length === 1,
    'the next plan is narrow again', charm.sunder);
}

/* ---- PILFER: one die crosses the centre line ---- */
{
  const pilfer = spell('pilfer');
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

/* ---- what a cast is WORTH: the question the machine's policy asks ---- */
{
  const pilfer = spell('pilfer');
  const ctx = mkCtx();
  // AI holds a single 2 facing the human's pair of 6s: the steal is worth
  // both ends — the 6 it gains (24→6 breaks their pair, 2→8 starts nothing
  // big) — measured in the DIFFERENCE: (8−6)−(2−24) = 24.
  const st: GameState = [[[2], [], []], [[6, 6], [], []]];
  check(swingOf(st, AI, pilfer, 0, CLASSIC, ctx) === 24, 'swing counts both ends of the theft',
    swingOf(st, AI, pilfer, 0, CLASSIC, ctx));
  // swingOf must not disturb the board OR the hand it is asked about
  const before = JSON.stringify(st);
  swingOf(st, AI, pilfer, 0, CLASSIC, ctx);
  check(JSON.stringify(st) === before, 'weighing a cast must not play it');
  check(ctx.got.length === 0, 'weighing a cast must not touch the hand', ctx.got);

  const best = bestTarget(st, AI, pilfer, CLASSIC, ctx);
  check(best?.col === 0 && best.swing === 24, 'the best target is the big one', best);
  check(bestTarget([[[], [], []], [[], [], []]] as GameState, AI, pilfer, CLASSIC, ctx) === null,
    'no legal target must be null, not column 0');
  // ties go to the lower column, so the machine is deterministic
  const tied: GameState = [[[], [], []], [[5], [5], []]];
  check(bestTarget(tied, AI, pilfer, CLASSIC, ctx)?.col === 0, 'ties take the lower column',
    bestTarget(tied, AI, pilfer, CLASSIC, ctx));
  // and the weighing follows the MODE: columns multiply in classic, not in
  // ROW SWITCH, so the same theft is worth something different
  check(swingOf(st, AI, pilfer, 0, ROWSWITCH, ctx) !== swingOf(st, AI, pilfer, 0, CLASSIC, ctx),
    'the swing must be mode-aware', {
      classic: swingOf(st, AI, pilfer, 0, CLASSIC, ctx), row: swingOf(st, AI, pilfer, 0, ROWSWITCH, ctx) });
}

/* ---- machineCast: THE machine decision (the CPU ships it, the harness
   measured it) ---- */
{
  const pilfer = spell('pilfer');
  // a fat steal clears Medium's demand; a trivial one is declined
  const fat: GameState = [[[2], [], []], [[6, 6], [1], []]];
  check(machineCast(fat, AI, pilfer, mkCtx(), 16) === 0, 'the machine takes a free steal',
    machineCast(fat, AI, pilfer, mkCtx(), 16));
  const thin: GameState = [[[2], [], []], [[1], [], []]];
  check(machineCast(thin, AI, pilfer, mkCtx(), 16) === null, 'the machine declines a trivial steal');

  // FATE: a poor die against a board where a 6 would multiply is thrown back;
  // the 6 itself is kept
  const fate = spell('fate');
  const board: GameState = [[[], [], []], [[6, 6], [], []]];
  check(machineCast(board, ME, fate, mkCtx({ die: 2 }), 16) === -1,
    'a die far below the board mean is redrawn');
  check(machineCast(board, ME, fate, mkCtx({ die: 6 }), 16) === null,
    'the die the board wants is kept');

  /* the last-slot rule and the never-settle-from-behind guard, in one board:
     the caster has ONE slot left, so any gain clears the demand — but the
     steal would fill the grid and settle the match AGAINST the caster, so
     the machine must hold the charge. */
  const behind: GameState = [[[1, 1, 1], [1, 1, 1], [1, 1]], [[6, 6, 6], [], [2]]];
  check(machineCast(behind, AI, pilfer, mkCtx(), 16) === null,
    'a cast that settles the game from behind is refused');
  // the same board with nothing to lose to: the last-slot steal is free value
  const ahead: GameState = [[[1, 1, 1], [1, 1, 1], [1, 1]], [[], [], [2]]];
  check(machineCast(ahead, AI, pilfer, mkCtx(), 16) === 2,
    'with one slot left, any gain beats holding the charge',
    machineCast(ahead, AI, pilfer, mkCtx(), 16));
}

/* ---- a cast can fill a grid: the flow must ask both boards, not the mover's ----
   This is the shape flow/spells guards with isFull(ME) || isFull(AI). Pinned
   here so the reason survives even if that call site is refactored. */
{
  const st: GameState = [[[1, 2, 3], [1, 2, 3], [1, 2]], [[], [], [4, 5]]];
  spell('pilfer').apply(st, AI, 2, mkCtx());
  const filled = st[AI].reduce((n, c) => n + c.length, 0);
  check(filled === SPEC.cols * SPEC.rows, 'a steal CAN fill the caster grid', filled);
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
