// The ranked result keeps progression-v2's rating components visible and
// sends a weekly replay back through the weekly entry lane. This pure owner
// pins the metadata-to-copy seam without constructing the full result screen.
// Run: mise exec -- node --experimental-strip-types tests/result-progression-copy.test.ts
import assert from 'node:assert/strict';
import { setLanguageOverride } from '../src/i18n/index.ts';
import type { HistoryRow } from '../src/online/api/ladder-api.ts';
import type { FinishReport } from '../src/online/play/play-types.ts';
import {
  resultDeltaBreakdown,
  resultReplayAction,
} from '../src/online/screens/result-progression-copy.ts';

const report = (overrides: Partial<FinishReport> = {}): FinishReport => ({
  won: true,
  draw: false,
  forfeit: false,
  my: 48,
  their: 31,
  delta: 64,
  baseDelta: 60,
  finishDelta: 4,
  scoringVersion: 2,
  entryKind: 'ordinary',
  opp: 'Opponent',
  oppAvatar: null,
  oppRating: 900,
  ...overrides,
});

setLanguageOverride('en');
assert.equal(resultDeltaBreakdown(report()), 'Base +60 · finish +4');
assert.equal(resultDeltaBreakdown(report({
  won: false,
  my: 31,
  their: 48,
  delta: -64,
  baseDelta: -60,
  finishDelta: -4,
})), 'Base -60 · finish -4', 'a loss dropped the signs from its v2 components');

/* V1 and incomplete metadata fail closed to the historical single delta. A
   partially projected v2 row must not paint a made-up zero component. */
assert.equal(resultDeltaBreakdown(report({ scoringVersion: 1 })), '');
assert.equal(resultDeltaBreakdown(report({ baseDelta: null })), '');
assert.equal(resultDeltaBreakdown(report({ finishDelta: null })), '');
assert.equal(resultDeltaBreakdown(report({ scoringVersion: undefined })), '');

setLanguageOverride('de');
assert.equal(resultDeltaBreakdown(report()), 'Basis +60 · Abstand +4',
  'the visible breakdown was not derived from the active locale');

setLanguageOverride('en');
let replays = 0;
const run = (): void => { replays++; };
const weekly = resultReplayAction(report({ entryKind: 'weekly' }), run);
assert.deepEqual({ label: weekly.label, icon: weekly.icon }, {
  label: 'Play weekly again',
  icon: 'play',
});
assert.equal(weekly.run, run, 'the weekly action replaced the result-screen departure guard');
weekly.run();
assert.equal(replays, 1, 'the weekly replay action did not run its supplied route');

assert.equal(resultReplayAction(report(), () => {}).label, 'Next duel');
assert.equal(resultReplayAction(report({ entryKind: undefined }), () => {}).label, 'Next duel',
  'a legacy result was incorrectly promoted into the weekly lane');

setLanguageOverride(null, ['en-US']);

/* History paints the same server-snapshotted components beside the stored
   total. Import after locale assertions because the screen installs a DOM
   repaint listener; paintHistoryRow itself only needs the supplied row slot. */
const { paintHistoryRow } = await import('../src/online/screens/history-screen.ts');
const element = { className: '', innerHTML: '' } as HTMLElement;
const historyRow = (overrides: Partial<HistoryRow> = {}): HistoryRow => ({
  id: '10000000-0000-4000-8000-000000000001',
  when: '',
  opponent: 'Opponent',
  mode: 'classic',
  mine: 48,
  theirs: 31,
  delta: 64,
  baseDelta: 60,
  finishDelta: 4,
  scoringVersion: 2,
  result: 'win',
  ...overrides,
});
paintHistoryRow(element, historyRow());
assert.match(element.innerHTML, /<small>Base \+60 · finish \+4<\/small>/u,
  'history hid the v2 score components beside the stored total');
assert.match(element.innerHTML, /aria-label="Base \+60 · finish \+4"/u,
  'history exposed the breakdown visually but not accessibly');

paintHistoryRow(element, historyRow({ scoringVersion: 1 }));
assert.doesNotMatch(element.innerHTML, /<small>|aria-label=/u,
  'a legacy history row invented a v2 score breakdown');

console.log(JSON.stringify({ problems: [] }));
