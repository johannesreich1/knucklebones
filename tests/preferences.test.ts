import assert from 'node:assert/strict';
import { parseUserPreferences } from '../src/preferences.ts';

const valid = {
  sound: false,
  numerals: true,
  p1Hue: 'blue',
  p2Hue: 'gold',
  colorblind: true,
  reducedMotion: null,
};

assert.deepEqual(parseUserPreferences(valid), valid);
assert.equal(parseUserPreferences({ ...valid, sound: 'off' }), null);
assert.equal(parseUserPreferences({ ...valid, p1Hue: 'pink' }), null);
assert.equal(parseUserPreferences({ ...valid, p2Hue: 'blue' }), null);
assert.equal(parseUserPreferences({ ...valid, reducedMotion: 'device' }), null);

console.log(JSON.stringify({ problems: [] }));
