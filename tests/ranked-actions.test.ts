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
import { AI, BOUNTY, CLASSIC, LIMITED, ME } from '../src/core/rules.ts';
import { runRankedBotTurnCases } from './support/ranked-bot-turn-cases.ts';
import { emitReport } from './support/emit-report.mjs';

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

/* Ordinary ranked is allowed to carry one equipped rune, two, or none. NULL
   is a real empty hand, not corrupt replay state: the other seat can still cast
   its own rune and both seats can always make the mandatory placement. */
const oneSidedDeal: RankedRuneDeal = [null, 'nudge'];
const oneSidedInitial = rebuildRankedActions('one-sided-equipped', [], CLASSIC, oneSidedDeal);
check(oneSidedInitial !== null && Object.keys(oneSidedInitial.charges[AI]).length === 0
  && oneSidedInitial.charges[ME].nudge === 1,
  'a standard match with one unequipped seat was rejected or invented a hand', oneSidedInitial);
const oneSidedCast = appendRankedAction('one-sided-equipped', [], CLASSIC, oneSidedDeal, {
  kind: 'cast', rune_id: 'nudge', target_col: -1,
});
const oneSidedPlace = oneSidedCast && appendRankedAction(
  'one-sided-equipped', [oneSidedCast.row], CLASSIC, oneSidedDeal,
  { kind: 'place', placed_col: 0 },
);
check(oneSidedCast !== null && oneSidedPlace !== null,
  'the equipped seat could not cast and place against an empty hand', { oneSidedCast, oneSidedPlace });
if (oneSidedCast && oneSidedPlace) {
  check(appendRankedAction(
    'one-sided-equipped', [oneSidedCast.row, oneSidedPlace.row], CLASSIC, oneSidedDeal,
    { kind: 'cast', rune_id: 'nudge', target_col: -1 },
  ) === null, 'the unequipped opponent cast a rune it did not bring');
  const emptySeatPlace = appendRankedAction(
    'one-sided-equipped', [oneSidedCast.row, oneSidedPlace.row], CLASSIC, oneSidedDeal,
    { kind: 'place', placed_col: 1 },
  );
  check(emptySeatPlace !== null, 'the unequipped opponent could not place normally');
  if (emptySeatPlace) {
    eq(projectRankedActions(
      [oneSidedCast.row, oneSidedPlace.row, emptySeatPlace.row], CLASSIC, oneSidedDeal,
    ), emptySeatPlace.state, 'one-sided public equipped-rune projection diverged');
  }
}
const emptyDeal: RankedRuneDeal = [null, null];
const emptyInitial = rebuildRankedActions('empty-equipped', [], CLASSIC, emptyDeal);
check(emptyInitial !== null && Object.keys(emptyInitial.charges[AI]).length === 0
  && Object.keys(emptyInitial.charges[ME]).length === 0,
  'an action-protocol standard match with two empty hands was rejected', emptyInitial);

// Every ranked bot commit — opener, reply, league slip, exhausted LIMITED bag
// — is one shared builder's contract and is gated as one block.
runRankedBotTurnCases({ check, eq, seed, dealt: deal, opening: initial });

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

emitReport({ problems, errs }, problems.length || errs.length);
