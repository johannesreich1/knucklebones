import assert from 'node:assert/strict';
import { RUNE_TRIAL_FORMAT } from '../src/core/ranked-outcomes.ts';
import { RANDOM_DUAL_SPELL, RANDOM_SPELL, SPELLS } from '../src/core/spells.ts';
import {
  RUNE_TRIAL_PICK,
  availableRuneSpecs,
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
assert.equal(modePickAvailable('cpu', RUNE_TRIAL_PICK, ids.slice(0, 2)), false);
assert.equal(modePickAvailable('duo', RUNE_TRIAL_PICK, []), true);
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

for (let index = 0; index < 500; index++) {
  assert.notEqual(pickLocalOutcome(`ordinary-${index}`, false).format, RUNE_TRIAL_FORMAT,
    'an ineligible local RANDOM draw landed on Rune Trial');
}
assert.ok(Array.from({ length: 500 }, (_, index) => pickLocalOutcome(`trial-${index}`, true))
  .some(({ format }) => format === RUNE_TRIAL_FORMAT),
  'eligible local RANDOM never admitted Rune Trial');

console.log(JSON.stringify({ problems: [] }));
