// ROW SWITCH must show row scores from the first ranked-table frame.
//
// Reported from a device 2026-09-01: the opening table briefly showed column
// score bars to the left, then corrected itself after play began. Ranked entry
// used to choose S.scoring and build empty boards, but the root's row-mode
// presentation was only painted later by updateScores() during authoritative
// replay. A slightly slower first read made that incorrect in-between state a
// real frame the player could see.
//
// This records computed pixels during that deliberate read gap. Asserting
// rowmode/rowswitch classes would not prove which score bars were visible.
const WATCH_OPENING = () => {
  window.__kbRowSwitchOpening = { frames: 0, wrongFrames: 0, first: null };
  const watch = window.__kbRowSwitchOpening;
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const sample = () => {
    const k = window.__kb;
    if (k && window.__kbOnline?.() && k.S.scoring === 1
      && k.S.boards.flat(2).length === 0) {
      const frame = {
        rowRailVisible: visible(document.querySelector('#botRows')),
        columnChipVisible: visible(document.querySelector('#botCols .chip')),
      };
      watch.frames++;
      watch.first ??= frame;
      if (!frame.rowRailVisible || frame.columnChipVisible) watch.wrongFrames++;
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

export async function runRowSwitchOpeningScenarios({ visit, out, check }) {
  const result = await visit({
    named: true,
    skipStandardProbes: true,
    door: 'match',
    matchReadySelector: null,
    initScript: WATCH_OPENING,
    trialMatch: {
      format: 'standard',
      modifier: 'rowswitch',
      myRune: null,
      foeRune: null,
      projectionDelay: 600,
    },
    probe: (page) => page.evaluate(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden'
          && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      return {
        ...window.__kbRowSwitchOpening,
        final: {
          boardDice: window.__kb.S.boards.flat(2).length,
          rowRailVisible: visible(document.querySelector('#botRows')),
          columnChipVisible: visible(document.querySelector('#botCols .chip')),
        },
      };
    }),
  });
  out.rowSwitchOpening = result.probeResult;
  const seen = out.rowSwitchOpening;

  check(!!seen && seen.frames > 0,
    'ROW SWITCH entry never exposed an untouched opening frame to the probe', seen);
  check(!!seen && seen.wrongFrames === 0
    && seen.first?.rowRailVisible && !seen.first?.columnChipVisible,
  'ROW SWITCH SHOWED COLUMN SCORE BARS BEFORE THE FIRST DIE — its row rail was '
    + 'painted only after the delayed authoritative read', seen);
  check(!!seen && seen.final.boardDice === 0
    && seen.final.rowRailVisible && !seen.final.columnChipVisible,
  'ROW SWITCH did not settle on the correct empty-board score furniture', seen);
}
