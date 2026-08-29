// Gate for the spell layer's RULES (core/spells) — pure, no browser.
// Three things are guarded here: that a spell's effect is exactly what it
// claims, that the registry stays well-formed as spells are added (unique
// ids, a real number of uses, a legality function that actually refuses
// something), and that the machine's shared policy (machineCast — the CPU
// and the balance harness both ask it) weighs casts the way the measured
// numbers assumed.
// Run: mise exec -- node --experimental-strip-types tests/spells.test.ts
import { SPEC, emptyBoard, boardTotal, applyMove, openStrikes, freshCharm,
         CLASSIC, ROWSWITCH, COLSHIELD,
         type GameState, type Mode, AI, ME } from '../src/core/rules.ts';
import { SPELLS, spellById, swingOf, bestTarget, machineCast,
         anvilTargetIndex, type CastCtx } from '../src/core/spells.ts';
import { checkSpellRegistryContract, checkSpellDeclarations } from './support/spell-registry-contract.ts';
import { emitReport } from './support/emit-report.mjs';

const problems: string[] = [];
const check = (c: boolean, m: string, x?: unknown) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

/* ---- registry and picker promises ---- */
checkSpellRegistryContract(check);
checkSpellDeclarations(check);

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
  for (const [before, after] of [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1]] as const) {
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
  // openStrikes mutated the charm; widen past the stale `true` narrowing.
  check((charm.sunder[AI] as boolean) === false, 'reading the plan consumed the sunder — one placement, one strike');
  check(openStrikes(st, AI, 1, 4, CLASSIC, charm).length === 1,
    'the next plan is narrow again', charm.sunder);
}

/* ---- PILFER: one die crosses the centre line ---- */
{
  const pilfer = spell('pilfer');
  const ctx = mkCtx();
  const st: GameState = [[[2], [], []], [[6, 6], [], [1, 1, 1]]];
  check(pilfer.legal(st, AI, 0, ctx), 'a held enemy column with room facing is legal');
  check(pilfer.previewDieIndex?.(st, AI, 0, ctx) === 1,
    'PILFER previews the exact outer enemy die it will steal');
  check(pilfer.previewDieIndex?.(st, AI, 1, ctx) === null,
    'PILFER does not mark a die in an empty enemy column');
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

/* ---- ANVIL: the weakest die in a FILLED column is recast where it lies ---- */
{
  const anvil = spell('anvil');
  const ctx = mkCtx({ die: 6 });
  // [6,6,1] is the board state the spell exists for: full, stuck at 25, and
  // unreachable by placing because there is nowhere left to place
  const st: GameState = [[[6, 6, 1], [2, 2], []], [[], [], []]];
  check(boardTotal(st[AI]) === 25 + 8, 'the stuck column scores its 25 before the forge', boardTotal(st[AI]));
  check(anvil.legal(st, AI, 0, ctx), 'a full column holding a weaker face is forgeable');
  anvil.apply(st, AI, 0, ctx);
  check(String(st[AI][0]) === '6,6,6', 'the LOWEST die took the face in hand', st[AI][0]);
  check(st[AI][0].length === 3, 'the column keeps its height — nothing moved', st[AI][0]);
  check(String(st[ME][0]) === '', 'the enemy board is never reached', st[ME]);
  check(ctx.got.length === 0, 'the die in hand is untouched — it still has to be placed', ctx.got);

  // ONLY a column you can no longer place into
  check(!anvil.legal(st, AI, 1, ctx), 'a column with room left is not forgeable — place into it instead');
  check(!anvil.legal(st, AI, 2, mkCtx({ die: 6 })), 'an empty column has nothing to forge');
  // a cast that would change nothing is illegal, not a wasted charge (§2)
  check(!anvil.legal([[[4, 4, 4], [], []], [[], [], []]] as GameState, AI, 0, mkCtx({ die: 4 })),
    'forging a face onto itself changes nothing, so it is refused');
  // ties go to the die closest to the centre line (lowest index)
  const tie: GameState = [[[1, 5, 1], [], []], [[], [], []]];
  spell('anvil').apply(tie, AI, 0, mkCtx({ die: 3 }));
  check(String(tie[AI][0]) === '3,5,1', 'tied lowest faces resolve to the centre-closest die', tie[AI][0]);
  // a shielded column is still YOUR column: the mode protects it from
  // destruction, and a forge destroys nothing
  check(anvil.legal([[[6, 6, 1], [], []], [[], [], []]] as GameState, AI, 0,
    mkCtx({ die: 6, mode: COLSHIELD as Mode })), 'COLSHIELD guards against strikes, not against your own forge');

  // The reported real-match shape: the 2 is the weakest and must be offered
  // whenever the hand differs from it. A 2 in hand is the intentional no-op.
  const pair: GameState = [[[2, 3, 3], [], []], [[], [], []]];
  check(anvilTargetIndex(pair[AI][0]) === 0, '[2,3,3] selects the centre-nearest 2');
  check(anvil.legal(pair, AI, 0, mkCtx({ die: 3 })), '[2,3,3] is forgeable with a 3 in hand');
  anvil.apply(pair, AI, 0, mkCtx({ die: 3 }));
  check(String(pair[AI][0]) === '3,3,3', '[2,3,3] recasts its 2 into the held 3', pair[AI][0]);
  check(!anvil.legal([[[2, 3, 3], [], []], [[], [], []]] as GameState, AI, 0, mkCtx({ die: 2 })),
    '[2,3,3] with a 2 in hand is refused because it would not change');
}
{
  // the machine's halved demand: ANVIL's swing is ONE-SIDED (it only ever adds
  // to its own board) where PILFER's is counted twice, so the threshold is
  // scaled inside cpuCast — measured 57.3 unscaled vs 60.2 halved
  const anvil = spell('anvil');
  const fat: GameState = [[[6, 6, 1], [], []], [[], [], []]];
  check(machineCast(fat, AI, anvil, mkCtx({ die: 6 }), 16) === 0,
    'a 1 into a third 6 is +83 and always worth the charge', machineCast(fat, AI, anvil, mkCtx({ die: 6 }), 16));
  const thin: GameState = [[[1, 2, 3], [], []], [[], [], []]];
  check(machineCast(thin, AI, anvil, mkCtx({ die: 2 }), 16) === null,
    'a forge that buys almost nothing is declined');
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

/* ---- A SHIELDED COLUMN CANNOT SHRINK, which is now load-bearing ----
   ui/game/seals.ts draws ONE seal around adjacent shielded columns, and
   that merge is only honest because a run can only ever GROW: if a shielded
   column could lose a die mid-game the enclosure would have to come apart,
   and nothing draws that. The permanence is not a property of the seal — it
   is core strike and unwarded theft resolution, and this is what asserts both
   are still there. */
{
  const full: GameState = [[[6, 6, 6], [2], []], [[1], [], []]];
  const pilfer = spellById('pilfer')!;
  const shielded = mkCtx({ mode: COLSHIELD as Mode });
  check(!pilfer.legal(full, ME, 0, shielded),
    'PILFER MAY NOT ROB A SHIELDED COLUMN — the merged seal assumes a run never shrinks',
    { col: full[AI][0] });
  // the control: the same call is legal where the column is NOT shielded, so a
  // refusal that came from a broken probe rather than from the rule would show
  check(pilfer.legal(full, ME, 0, mkCtx({ mode: CLASSIC as Mode })),
    'the probe itself is broken: PILFER refused a classic column too', { col: full[AI][0] });
  // and no strike may take from one either
  check(openStrikes(full, ME, 0, 6, COLSHIELD).length === 0,
    'A STRIKE TOOK DICE FROM A SHIELDED COLUMN', { col: full[AI][0] });
  check(openStrikes(full, ME, 0, 6, CLASSIC).length > 0,
    'the strike probe is broken: it found nothing in classic either', { col: full[AI][0] });
}

emitReport({ problems, errs: [] }, problems.length);
