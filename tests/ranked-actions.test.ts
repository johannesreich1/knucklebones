// Pure protocol-v2 replay gate. The server owns the seeded replay; the browser
// validates the same public transitions without learning that seed.
// Run: mise exec -- node --experimental-strip-types tests/ranked-actions.test.ts
import { diceStream } from '../src/core/dice.ts';
import {
  appendRankedAction,
  projectRankedActions,
  rankedActionTotal,
  rebuildRankedActions,
  type RankedActionRow,
  type RankedRuneDeal,
} from '../src/core/ranked-actions.ts';
import { appendRankedBotTurn } from '../src/core/ranked-bot-turn.ts';
import { AI, BOUNTY, CLASSIC, LIMITED, ME, legalCols } from '../src/core/rules.ts';

const problems: string[] = [];
const errs: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};
const eq = (got: unknown, want: unknown, message: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(`${message} :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};

const seed = 'ranked-actions-gate';
const deal: RankedRuneDeal = ['ward', 'nudge'];
const initial = rebuildRankedActions(seed, [], CLASSIC, deal);
check(initial !== null && initial.turn === ME && initial.actionCount === 0
  && initial.moveCount === 0 && initial.nextDie !== null,
  'empty authoritative replay did not expose the opening turn and die', initial);
if (!initial || initial.nextDie === null) throw new Error('ranked action fixture did not initialize');

const nudge = appendRankedAction(seed, [], CLASSIC, deal, {
  kind: 'cast', rune_id: 'nudge', target_col: -1,
});
check(nudge !== null, 'the opening player could not cast their dealt NUDGE');
if (!nudge) throw new Error('NUDGE fixture did not append');
eq(nudge.row, {
  idx: 0,
  move_idx: null,
  who: ME,
  kind: 'cast',
  rune_id: 'nudge',
  target_col: -1,
  placed_col: null,
  die_before: initial.nextDie,
  die_after: initial.nextDie % 6 + 1,
}, 'NUDGE action row did not commit the exact die transition');
check(nudge.state.charges[ME].nudge === 0 && nudge.state.castThisTurn
  && nudge.state.turn === ME && nudge.state.moveCount === 0,
  'cast replay lost charges or incorrectly ended the turn', nudge.state);
eq(projectRankedActions([nudge.row], CLASSIC, deal), nudge.state,
  'public projection disagrees with seeded NUDGE replay');
check(appendRankedAction(seed, [nudge.row], CLASSIC, deal, {
  kind: 'cast', rune_id: 'nudge', target_col: -1,
}) === null, 'one-cast-per-turn or exhausted NUDGE charge was not enforced');

const placed = appendRankedAction(seed, [nudge.row], CLASSIC, deal, {
  kind: 'place', placed_col: 0,
});
check(placed !== null, 'placement after a cast did not append');
if (!placed) throw new Error('placement fixture did not append');
check(placed.row.idx === 1 && placed.row.move_idx === 0 && placed.row.who === ME
  && placed.state.turn === AI && placed.state.actionCount === 2
  && placed.state.moveCount === 1 && !placed.state.castThisTurn,
  'placement did not advance independent action/move versions or reset cast state', placed);

const ward = appendRankedAction(seed, [nudge.row, placed.row], CLASSIC, deal, {
  kind: 'cast', rune_id: 'ward', target_col: 0,
});
check(ward !== null && ward.state.charm.wards[AI][0] === 1,
  'opponent WARD cast did not persist its public charm state', ward);
if (!ward) throw new Error('WARD fixture did not append');
const wardPlace = appendRankedAction(seed, [nudge.row, placed.row, ward.row], CLASSIC, deal, {
  kind: 'place', placed_col: 0,
});
check(wardPlace !== null, 'placement after WARD did not append');
if (!wardPlace) throw new Error('WARD placement fixture did not append');
const classicRows = [nudge.row, placed.row, ward.row, wardPlace.row];
eq(projectRankedActions([...classicRows].reverse(), CLASSIC, deal), wardPlace.state,
  'public projection depends on query order or loses boards/charms/charges');
eq(rankedActionTotal(wardPlace.state, AI, CLASSIC),
  rankedActionTotal(projectRankedActions(classicRows, CLASSIC, deal)!, AI, CLASSIC),
  'public and authoritative WARD-aware scoring diverged');

const badTransition: RankedActionRow = {
  ...nudge.row,
  die_after: nudge.row.die_after === 6 ? 1 : nudge.row.die_after! + 1,
};
check(projectRankedActions([badTransition], CLASSIC, deal) === null,
  'public replay accepted a forged deterministic spell transition');
check(rebuildRankedActions(seed, [{ ...nudge.row, who: AI }], CLASSIC, deal) === null,
  'authoritative replay accepted the wrong actor');
check(projectRankedActions([{ ...nudge.row, idx: 1 }], CLASSIC, deal) === null,
  'public replay accepted a non-contiguous action index');
check(projectRankedActions([], CLASSIC, deal) === null,
  'an empty public log guessed the private opening die');
eq(projectRankedActions([], CLASSIC, deal, initial.nextDie), initial,
  'empty public projection did not accept the explicitly revealed opening die');

// The same bot turn builder drives the immediate lower-rated bot opener and
// replies after human placements. It must finish one complete opening turn
// from replay truth, whether or not its rune policy elects to cast first.
const botOpening = appendRankedBotTurn({
  seed,
  rows: [],
  state: initial,
  mode: CLASSIC,
  dealt: deal,
  rating: 800,
  random: () => 0,
});
check(botOpening !== null && botOpening.actions.at(-1)?.kind === 'place'
  && botOpening.state.moveCount === 1 && botOpening.state.turn === AI
  && botOpening.state.actionCount === botOpening.actions.length,
  'ranked bot opener did not commit one complete turn before handing input to p2', botOpening);
if (botOpening) {
  eq(rebuildRankedActions(seed, botOpening.actions, CLASSIC, deal), botOpening.state,
    'ranked bot opener diverged from the shared authoritative replay');
}
check(appendRankedBotTurn({
  seed,
  rows: [],
  state: { ...initial, actionCount: 1 },
  mode: CLASSIC,
  dealt: deal,
  rating: 800,
  random: () => 0,
}) === null, 'ranked bot opener accepted a state/version mismatch');

// A ranked bot's league slip also passes its Rune cast window. The low draw
// proves the handicap; the high draw proves it did not disable spells. This
// built replay reaches an AI/p2 FATE turn where the production planner casts.
const castSlipSeed = 'cast-fixture-0';
const castSlipDeal: RankedRuneDeal = ['fate', 'ward'];
const castSlipRows: RankedActionRow[] = [];
let castSlipState = rebuildRankedActions(castSlipSeed, castSlipRows, CLASSIC, castSlipDeal);
if (!castSlipState) throw new Error('cast-slip fixture did not initialize');
for (const placed_col of [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1]) {
  const appended = appendRankedAction(
    castSlipSeed, castSlipRows, CLASSIC, castSlipDeal, { kind: 'place', placed_col },
  );
  if (!appended) throw new Error('cast-slip fixture placement did not append');
  castSlipRows.push(appended.row);
  castSlipState = appended.state;
}
check(castSlipState.turn === AI && castSlipState.nextDie === 1,
  'cast-slip fixture did not reach the intended bot FATE turn', castSlipState);
const skippedCast = appendRankedBotTurn({
  seed: castSlipSeed,
  rows: castSlipRows,
  state: castSlipState,
  mode: CLASSIC,
  dealt: castSlipDeal,
  rating: 800,
  random: () => 0,
});
let castDraw = 0;
const keptCast = appendRankedBotTurn({
  seed: castSlipSeed,
  rows: castSlipRows,
  state: castSlipState,
  mode: CLASSIC,
  dealt: castSlipDeal,
  rating: 800,
  random: () => castDraw++ === 0 ? 0.99 : 0.5,
});
check(skippedCast?.actions.length === 1 && skippedCast.actions[0].kind === 'place'
  && skippedCast.state.charges[AI].fate === 2,
  'a bot cast through its league slip instead of passing the Rune window', skippedCast);
check(keptCast?.actions.some(({ kind, rune_id }) => kind === 'cast' && rune_id === 'fate')
  && keptCast.state.charges[AI].fate === 1,
  'the Rune handicap disabled casting instead of making it probabilistic', keptCast);

const openerCastSeed = 'cast-slip-fixture-1-fate-0';
const openerCastDeal: RankedRuneDeal = ['nudge', 'fate'];
const openerCastRows: RankedActionRow[] = [];
let openerCastState = rebuildRankedActions(
  openerCastSeed, openerCastRows, CLASSIC, openerCastDeal,
);
if (!openerCastState) throw new Error('opener cast-slip fixture did not initialize');
const openerPattern = [1, 1, 0];
for (let step = 0; step < 10; step++) {
  const legal = legalCols(openerCastState.st[openerCastState.turn]);
  const appended = appendRankedAction(
    openerCastSeed, openerCastRows, CLASSIC, openerCastDeal,
    { kind: 'place', placed_col: legal[openerPattern[step % openerPattern.length] % legal.length] },
  );
  if (!appended) throw new Error('opener cast-slip fixture placement did not append');
  openerCastRows.push(appended.row);
  openerCastState = appended.state;
}
check(openerCastState.turn === ME && openerCastState.nextDie === 1,
  'opener cast-slip fixture did not reach the intended bot FATE turn', openerCastState);
const skippedOpenerCast = appendRankedBotTurn({
  seed: openerCastSeed,
  rows: openerCastRows,
  state: openerCastState,
  mode: CLASSIC,
  dealt: openerCastDeal,
  rating: 800,
  random: () => 0,
});
let openerCastDraw = 0;
const keptOpenerCast = appendRankedBotTurn({
  seed: openerCastSeed,
  rows: openerCastRows,
  state: openerCastState,
  mode: CLASSIC,
  dealt: openerCastDeal,
  rating: 800,
  random: () => openerCastDraw++ === 0 ? 0.99 : 0.5,
});
check(skippedOpenerCast?.actions.length === 1
  && skippedOpenerCast.actions[0].kind === 'place'
  && skippedOpenerCast.state.charges[ME].fate === 2,
  'a bot opener cast through its league slip instead of passing the Rune window',
  skippedOpenerCast);
check(keptOpenerCast?.actions.some(
  ({ kind, rune_id }) => kind === 'cast' && rune_id === 'fate',
) && keptOpenerCast.state.charges[ME].fate === 1,
  'the opener Rune handicap disabled casting instead of making it probabilistic',
  keptOpenerCast);

// The die already in hand counts as drawn. On the final LIMITED turn FATE
// must see an empty bag, decline its redraw, and let the bot place that die.
const limitedBotSeed = 'audit-31';
const limitedBotDeal: RankedRuneDeal = ['fate', 'ward'];
const limitedBotRows: RankedActionRow[] = [];
let limitedBotState = rebuildRankedActions(limitedBotSeed, limitedBotRows, LIMITED, limitedBotDeal);
if (!limitedBotState) throw new Error('LIMITED bot fixture did not initialize');
for (let step = 0; step < 23; step++) {
  const legal = legalCols(limitedBotState.st[limitedBotState.turn]);
  const appended = appendRankedAction(limitedBotSeed, limitedBotRows, LIMITED, limitedBotDeal, {
    kind: 'place', placed_col: legal[(31 + step * 7) % legal.length],
  });
  if (!appended) throw new Error(`LIMITED bot fixture stopped at placement ${step}`);
  limitedBotRows.push(appended.row);
  limitedBotState = appended.state;
}
check(limitedBotState.drawCount === 24 && limitedBotState.nextDie === 1
  && limitedBotState.turn === AI,
  'LIMITED bot fixture did not reach FATE holding the final live die', limitedBotState);
const finalLimitedTurn = appendRankedBotTurn({
  seed: limitedBotSeed,
  rows: limitedBotRows,
  state: limitedBotState,
  mode: LIMITED,
  dealt: limitedBotDeal,
  rating: 800,
  random: () => 0,
});
check(finalLimitedTurn !== null && finalLimitedTurn.actions.length === 1
  && finalLimitedTurn.actions[0].kind === 'place' && finalLimitedTurn.state.over,
  'ranked bot tried to cast FATE after the LIMITED bag was exhausted', finalLimitedTurn);

// FATE is the one transition the public log cannot independently predict.
// The browser may consume the committed value; the server still rejects any
// value that differs from its private seeded draw.
const limitedDeal: RankedRuneDeal = ['ward', 'fate'];
const fate = appendRankedAction('limited-fate-gate', [], LIMITED, limitedDeal, {
  kind: 'cast', rune_id: 'fate', target_col: -1,
});
check(fate !== null && fate.state.drawCount === 2,
  'LIMITED FATE did not consume the shared finite supply', fate);
if (!fate) throw new Error('FATE fixture did not append');
eq(projectRankedActions([fate.row], LIMITED, limitedDeal), fate.state,
  'public LIMITED/FATE projection lost supply or die state');
const forgedFate = {
  ...fate.row,
  die_after: fate.row.die_after === 6 ? 1 : fate.row.die_after! + 1,
};
check(rebuildRankedActions('limited-fate-gate', [forgedFate], LIMITED, limitedDeal) === null,
  'authoritative seeded replay accepted a forged FATE draw');

// Find a deterministic opening pair that matches. The second placement must
// destroy the first and bank exactly one BOUNTY point in both projections.
let bountySeed = '';
for (let index = 0; index < 1000 && !bountySeed; index++) {
  const candidate = `ranked-bounty-${index}`;
  const draw = diceStream(candidate);
  if (draw() === draw()) bountySeed = candidate;
}
check(!!bountySeed, 'could not find a deterministic matching BOUNTY fixture');
const bountyDeal: RankedRuneDeal = ['ward', 'nudge'];
const bountyP1 = appendRankedAction(bountySeed, [], BOUNTY, bountyDeal, {
  kind: 'place', placed_col: 0,
});
const bountyP2 = bountyP1 && appendRankedAction(bountySeed, [bountyP1.row], BOUNTY, bountyDeal, {
  kind: 'place', placed_col: 0,
});
check(bountyP2 !== null && bountyP2.state.bounty[AI] === 1,
  'authoritative replay did not bank the destroyed die in BOUNTY', bountyP2);
if (bountyP1 && bountyP2) {
  eq(projectRankedActions([bountyP1.row, bountyP2.row], BOUNTY, bountyDeal), bountyP2.state,
    'public replay lost BOUNTY accounting');
}

// ANVIL reveals its weakest-die previews when armed, so the aim itself is a
// durable public commitment. Build a full column, then prove that neither a
// direct cast nor placement can bypass the reservation across a replay.
let anvilSeed = '';
let anvilRows: RankedActionRow[] = [];
const anvilDeal: RankedRuneDeal = ['ward', 'anvil'];
for (let attempt = 0; attempt < 1000 && !anvilSeed; attempt++) {
  const candidate = `ranked-anvil-${attempt}`;
  const built: RankedActionRow[] = [];
  let state = rebuildRankedActions(candidate, built, CLASSIC, anvilDeal);
  for (let move = 0; state && !state.over && move < 6; move++) {
    const appended = appendRankedAction(candidate, built, CLASSIC, anvilDeal, {
      kind: 'place', placed_col: state.turn === ME ? 0 : 2,
    });
    if (!appended) { state = null; break; }
    built.push(appended.row);
    state = appended.state;
  }
  const weakest = state ? Math.min(...state.st[ME][0]) : 0;
  if (state?.turn === ME && state.st[ME][0].length === 3 && state.nextDie !== weakest) {
    anvilSeed = candidate;
    anvilRows = built;
  }
}
check(!!anvilSeed, 'could not build a deterministic legal ANVIL aim fixture');
check(appendRankedAction(anvilSeed, anvilRows, CLASSIC, anvilDeal, {
  kind: 'cast', rune_id: 'anvil', target_col: 0,
}) === null, 'ANVIL cast bypassed its authoritative aim reservation');
const aimed = appendRankedAction(anvilSeed, anvilRows, CLASSIC, anvilDeal, {
  kind: 'aim', rune_id: 'anvil',
});
check(aimed !== null && aimed.row.kind === 'aim'
  && aimed.row.die_after === aimed.row.die_before
  && aimed.state.pendingAim === 'anvil' && aimed.state.castThisTurn
  && aimed.state.charges[ME].anvil === 0,
  'ANVIL aim did not reserve its charge while preserving turn and die', aimed);
if (aimed) {
  const aimedRows = [...anvilRows, aimed.row];
  eq(projectRankedActions(aimedRows, CLASSIC, anvilDeal), aimed.state,
    'public replay lost the pending ANVIL reservation');
  check(appendRankedAction(anvilSeed, aimedRows, CLASSIC, anvilDeal, {
    kind: 'place', placed_col: 1,
  }) === null, 'placement bypassed a pending committed ANVIL aim');
  const resolved = appendRankedAction(anvilSeed, aimedRows, CLASSIC, anvilDeal, {
    kind: 'cast', rune_id: 'anvil', target_col: 0,
  });
  check(resolved !== null && resolved.state.pendingAim === null
    && resolved.state.charges[ME].anvil === 0 && resolved.state.turn === ME,
    'matching ANVIL cast did not clear the reservation without double-spending', resolved);
  if (resolved) {
    eq(projectRankedActions([...aimedRows, resolved.row], CLASSIC, anvilDeal), resolved.state,
      'public aim-to-cast replay diverged from authoritative ANVIL state');
  }
  check(projectRankedActions([...anvilRows, { ...aimed.row, die_after: null }],
    CLASSIC, anvilDeal) === null, 'public replay accepted an aim that changed the die');
}

console.log(JSON.stringify({ problems, errs }, null, 2));
process.exit(problems.length || errs.length ? 1 : 0);
