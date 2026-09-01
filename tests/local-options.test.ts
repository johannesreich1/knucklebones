import assert from 'node:assert/strict';
import { CLASSIC, BOUNTY, LIMITED, ROWMULT, ROWSWITCH } from '../src/core/rules.ts';
import { RANDOM } from '../src/core/modes.ts';
import { RUNE_TRIAL_FORMAT } from '../src/core/ranked-outcomes.ts';
import { RANDOM_DUAL_SPELL, RANDOM_SPELL, SPELLS } from '../src/core/spells.ts';
import {
  RUNE_TRIAL_PICK,
  availableRuneSpecs,
  localPoolAccess,
  modePickAvailable,
  pickLocalOutcome,
  runePickAvailable,
  runeTrialAvailable,
} from '../src/local-options.ts';
import { resolveSpellDeal } from '../src/flow/spell-deal.ts';

const ids = SPELLS.map(({ id }) => id);
assert.deepEqual(availableRuneSpecs('cpu', []), []);
assert.deepEqual(availableRuneSpecs('duo', []).map(({ id }) => id), ids);
assert.equal(runePickAvailable('cpu', '', []), true);
assert.equal(runePickAvailable('cpu', ids[0], []), false);
assert.equal(runePickAvailable('cpu', RANDOM_SPELL, [ids[0]]), false);
assert.equal(runePickAvailable('cpu', RANDOM_DUAL_SPELL, ids.slice(0, 2)), true);
assert.equal(runeTrialAvailable('cpu', ids.slice(0, 2)), false);
assert.equal(runeTrialAvailable('cpu', ids.slice(0, 3)), true);

/* WHAT THE LADDER HAS GIVEN THIS DEVICE, and nothing else: the offline dial's
   ring, the RANDOM draw and the picker's locks all read this one roster. */
const three = ids.slice(0, 3);
const stone = localPoolAccess('cpu', three, 'stone');
const bone = localPoolAccess('cpu', three, 'bone');
const ivory = localPoolAccess('cpu', three, 'ivory');
/* An unconfirmed tier fails closed to STONE — a device that has never verified
   an account has earned nothing, exactly as its rune collection reads empty. */
assert.deepEqual(localPoolAccess('cpu', three, null), stone,
  'an unknown pool tier was treated as something other than STONE');

assert.equal(modePickAvailable(CLASSIC, stone), true);
assert.equal(modePickAvailable(LIMITED, stone), true,
  'a fresh unknown curve did not retain the old-server v1 STONE promise');
assert.equal(modePickAvailable(BOUNTY, stone), false,
  'the v1 STONE fallback lost its shipped mode locks');
assert.equal(modePickAvailable(ROWSWITCH, stone), false);
assert.equal(modePickAvailable(ROWMULT, bone), true);
assert.equal(modePickAvailable(BOUNTY, bone), true);
/* The promise to spin is always offered; only what it may land on narrows. */
assert.equal(modePickAvailable(RANDOM, stone), true);

/* Once the public v2 curve is confirmed, missing account-owned exact grants
   fail closed to clean v2 STONE. In particular, never resurrect v1 STONE's
   Limited promise after sign-out or during an entitlement refresh failure. */
const signedOutV2 = localPoolAccess('cpu', [], null, null, 2);
const missingV2Entitlements = localPoolAccess('cpu', three, 'ivory', null, 2);
for (const access of [signedOutV2, missingV2Entitlements]) {
  assert.equal(modePickAvailable(BOUNTY, access), true);
  assert.equal(modePickAvailable(LIMITED, access), false,
    'v2 without exact entitlements exposed legacy Limited');
  assert.equal(modePickAvailable(ROWMULT, access), false,
    'v2 without exact entitlements inferred a higher cached tier');
}

/* A confirmed v2 status owns per-outcome access. It can be non-tier-shaped
   after grandfathering, so neither locks nor RANDOM may infer it from tier. */
const v2Stone = localPoolAccess('cpu', three, 'stone', [
  'classic', 'singlestrike', 'colshield', 'bounty',
]);
assert.equal(modePickAvailable(BOUNTY, v2Stone), true,
  'confirmed v2 STONE did not consume its Bounty entitlement');
assert.equal(modePickAvailable(ROWSWITCH, v2Stone), false,
  'confirmed v2 STONE inferred a later mode from its tier');
const grandfathered = localPoolAccess('cpu', three, 'stone', [
  'limited', 'classic', 'bounty',
]);
assert.equal(modePickAvailable(BOUNTY, grandfathered), true);
assert.equal(modePickAvailable(LIMITED, grandfathered), true,
  'an explicitly grandfathered Limited entitlement was discarded');
assert.deepEqual(
  Array.from({ length: 300 }, (_, index) => pickLocalOutcome(`grandfathered-${index}`, grandfathered).id)
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort(),
  ['bounty', 'classic', 'limited'],
  'offline RANDOM inferred a tier roster instead of using explicit v2 entitlements',
);

/* Rune Ritual needs BOTH halves: the IVORY tier and three collected runes. */
assert.equal(modePickAvailable(RUNE_TRIAL_PICK, ivory), true);
assert.equal(modePickAvailable(RUNE_TRIAL_PICK, bone), false,
  'Rune Ritual was offered below IVORY');
assert.equal(modePickAvailable(RUNE_TRIAL_PICK, localPoolAccess('cpu', ids.slice(0, 2), 'ivory')),
  false, 'Rune Ritual was offered with too few collected runes');

/* Pass-and-play is the one local mode that exposes the whole game, the same
   exception availableRuneSpecs already makes for runes. */
const duo = localPoolAccess('duo', [], null);
assert.equal(modePickAvailable(BOUNTY, duo), true);
assert.equal(modePickAvailable(ROWSWITCH, duo), true,
  'full local two-player did not expose the complete successor catalog');
assert.equal(modePickAvailable(RUNE_TRIAL_PICK, duo), true);
for (const id of ['', ...ids, RANDOM_SPELL, RANDOM_DUAL_SPELL]) {
  assert.equal(runePickAvailable('duo', id, []), true, `duo unexpectedly locked ${id || 'NONE'}`);
}

const two = SPELLS.slice(1, 3);
assert.deepEqual(resolveSpellDeal(ids[0], () => 0, two), ['', ''],
  'a named rune outside the collected pool escaped validation');
assert.deepEqual(resolveSpellDeal(RANDOM_SPELL, () => 0, two), [two[0].id, two[0].id]);
const dual = resolveSpellDeal(RANDOM_DUAL_SPELL, () => 0, two);
assert.deepEqual(dual, [two[0].id, two[1].id]);
assert.notEqual(dual[0], dual[1]);
assert.deepEqual(resolveSpellDeal(RANDOM_DUAL_SPELL, () => 0, two.slice(0, 1)), ['', '']);

/* The draw may only ever answer with something the picker would have offered:
   ring and answer come from one roster, so they cannot drift apart. */
for (let index = 0; index < 500; index++) {
  const drawn = pickLocalOutcome(`stone-${index}`, stone);
  assert.notEqual(drawn.format, RUNE_TRIAL_FORMAT,
    'an ineligible local RANDOM draw landed on Rune Trial');
  assert.equal(modePickAvailable(drawn.mode, stone), true,
    `STONE's RANDOM drew ${drawn.id}, which its own picker locks`);
}
for (let index = 0; index < 500; index++) {
  assert.notEqual(pickLocalOutcome(`ordinary-${index}`, bone).format, RUNE_TRIAL_FORMAT,
    'an ineligible local RANDOM draw landed on Rune Trial');
}
assert.ok(Array.from({ length: 500 }, (_, index) => pickLocalOutcome(`trial-${index}`, ivory))
  .some(({ format }) => format === RUNE_TRIAL_FORMAT),
  'eligible local RANDOM never admitted Rune Trial');

console.log(JSON.stringify({ problems: [] }));
