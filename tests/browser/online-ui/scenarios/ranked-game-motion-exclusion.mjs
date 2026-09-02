// RANKED ENTRY IS NOT PAGE NAVIGATION.
//
// The shared Neon Wipe owns pages with Back controls. A ranked search leaves
// its queue for the pre-game reveal and then the shared table; neither is a
// page, and the in-game information sheet is part of that same duel. Because
// the page-motion controller observes DOM state centrally, this boundary must
// be proved through the real Queue -> reveal -> game route rather than by
// checking an allow-list in source.

const RECORD_RANKED_NAVIGATION_MOTION = () => {
  const w = window;
  const managed = (animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id);
  const painted = (element) => {
    if (!element || element.hidden) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0;
  };
  const targetName = (animation) => {
    const target = animation.effect?.target;
    if (!(target instanceof Element)) return null;
    return target.id || target.getAttribute('class') || target.tagName.toLowerCase();
  };
  const state = w.__kbRankedNavigationMotion = {
    queueFrames: 0,
    revealFrames: 0,
    gameFrames: 0,
    sheetFrames: 0,
    queueExposureFrames: 0,
    revealExposureFrames: 0,
    gameExposureFrames: 0,
    sheetExposureFrames: 0,
    firstQueueExposure: null,
    firstRevealExposure: null,
    firstGameExposure: null,
    firstSheetExposure: null,
  };

  /* Keep the real queue painted for several frames while still resolving well
     inside the 280ms Home -> Online wipe. That makes the hand-off deterministic
     and exercises the exact overlap at which a page animation could otherwise
     leak onto the reveal. The route and match row remain trial-match.mjs's. */
  const nativeFetch = w.fetch.bind(w);
  w.fetch = async (...args) => {
    const input = args[0];
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (url.includes('/functions/v1/pvp-join')) {
      await new Promise((resolve) => setTimeout(resolve, 96));
    }
    return nativeFetch(...args);
  };

  const sample = () => {
    const queue = document.getElementById('ovOnline')?.classList.contains('on')
      && painted(document.getElementById('onQueue'));
    const reveal = document.getElementById('ovWheel')?.classList.contains('on')
      && painted(document.getElementById('ovWheel'));
    const sheets = [...document.querySelectorAll('.faceoff')].filter(painted);
    const game = !!w.__kbOnline?.();
    if (queue) state.queueFrames++;
    if (reveal) state.revealFrames++;
    if (game) state.gameFrames++;
    if (sheets.length) state.sheetFrames++;

    const animations = document.getAnimations({ subtree: true }).filter(managed);
    if (animations.length) {
      const reading = {
        ids: animations.map((animation) => animation.id).sort(),
        targets: animations.map(targetName),
        direction: document.getElementById('kbroot')?.dataset.pageMotionDirection ?? null,
      };
      if (queue) {
        state.queueExposureFrames++;
        state.firstQueueExposure ??= reading;
      }
      if (reveal) {
        state.revealExposureFrames++;
        state.firstRevealExposure ??= reading;
      }
      if (game) {
        state.gameExposureFrames++;
        state.firstGameExposure ??= reading;
      }
      if (sheets.length) {
        state.sheetExposureFrames++;
        state.firstSheetExposure ??= reading;
      }
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

export async function runRankedGameMotionExclusionScenarios({ visitChromium, out, check }) {
  const seen = await visitChromium({
    named: true,
    skipStandardProbes: true,
    door: 'match',
    /* A fresh STANDARD row takes the real queue through #ovWheel. Empty rune
       seats keep the fixture focused and are a valid ranked configuration. */
    trialMatch: {
      format: 'standard', rejoined: false, myRune: null, foeRune: null,
    },
    matchReadySelector: null,
    initScript: RECORD_RANKED_NAVIGATION_MOTION,
    probe: async (page) => {
      /* The shared in-game badge opens the real .faceoff sheet. It proves the
         duel's own modal layer remains outside page motion without inventing
         a test-only surface. */
      await page.waitForSelector('#rec .rchip[data-lib]', { state: 'visible', timeout: 5000 });
      await page.click('#rec .rchip[data-lib]');
      await page.waitForSelector('.faceoff .focard', { state: 'visible', timeout: 5000 });
      await page.waitForFunction(() => window.__kbRankedNavigationMotion.sheetFrames >= 3,
        null, { timeout: 5000 });
      return page.evaluate(() => ({ ...window.__kbRankedNavigationMotion }));
    },
  });
  const reading = seen.probeResult;
  out.rankedGameMotionExclusion = reading;

  check(!!reading && reading.queueFrames >= 2 && reading.revealFrames >= 2
      && reading.gameFrames >= 2 && reading.sheetFrames >= 2,
  'the ranked motion exclusion fixture did not paint Queue, reveal, game, and sheet', reading);
  check(!!reading && reading.queueExposureFrames >= 1
      && reading.firstQueueExposure?.ids.includes('kb-page-push-source')
      && reading.firstQueueExposure.ids.includes('kb-page-push-target'),
  'the ranked exclusion probe never overlapped the real Queue with Home-to-Online page motion',
  { frames: reading?.queueExposureFrames, first: reading?.firstQueueExposure });
  check(!!reading && reading.revealExposureFrames === 0,
    'RANKED REVEAL EXPOSED PAGE NAVIGATION MOTION over #ovWheel',
    { frames: reading?.revealExposureFrames, first: reading?.firstRevealExposure });
  check(!!reading && reading.gameExposureFrames === 0,
    'RANKED GAME EXPOSED PAGE NAVIGATION MOTION after the queue hand-off',
    { frames: reading?.gameExposureFrames, first: reading?.firstGameExposure });
  check(!!reading && reading.sheetExposureFrames === 0,
    'IN-GAME SHEET EXPOSED PAGE NAVIGATION MOTION over .faceoff',
    { frames: reading?.sheetExposureFrames, first: reading?.firstSheetExposure });
  check(seen.errs.length === 0, 'page errors during ranked motion exclusion', seen.errs);
}
