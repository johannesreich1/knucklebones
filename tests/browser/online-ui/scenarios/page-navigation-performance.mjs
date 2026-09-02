// NAVIGATION COST, MEASURED. The owner's phone ran hot and the menus lagged
// after the first page transition landed; the causes were per-frame layout
// (a beam animating `left`), per-frame paint (`clip-path` on full-screen
// overlays that also blurred their backdrop) and a router that re-read
// computed styles every time it repainted itself. None of that is visible
// to a probe that only checks where a page ended up, so this one records
// what each navigation COSTS — frame times, long tasks, computed-style
// reads, and which properties the timelines animate — across the two
// routes the owner named: Ladder <-> Profile inside the shell, Home <-> Ladder across overlays.
//
// The numbers are relative (headless Chromium on a loaded gate host is not
// a phone) and are reported, not pinned. The facts that decide whether the
// heat can come back are pinned: no timeline animates a layout or paint
// property, no moving page re-blurs its backdrop, and the drifting blurred
// backdrop is paused while a page covers it.
import { waitForMotionIdle } from '../../support/page-motion-idle.mjs';

const TIMING_KEYS = ['offset', 'computedOffset', 'easing', 'composite'];

/* Installed before app code so the very first navigation is measured. */
const RECORD_NAVIGATION_COST = () => {
  const w = window;
  const state = w.__kbNavCost = {
    segment: null,
    segments: {},
    animated: new Set(),
    styleReads: 0,
  };
  const nativeAnimate = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    const animation = nativeAnimate.call(this, frames, options);
    queueMicrotask(() => {
      if (!/^kb-page-/.test(animation.id ?? '')) return;
      for (const frame of animation.effect?.getKeyframes() ?? []) {
        for (const key of Object.keys(frame)) state.animated.add(key);
      }
    });
    return animation;
  };
  const nativeComputedStyle = w.getComputedStyle;
  w.getComputedStyle = function (...args) {
    state.styleReads++;
    return nativeComputedStyle.apply(this, args);
  };
  const observer = new PerformanceObserver((list) => {
    const segment = state.segment && state.segments[state.segment];
    if (!segment) return;
    for (const entry of list.getEntries()) segment.longTaskMs += entry.duration;
  });
  try { observer.observe({ type: 'longtask', buffered: false }); } catch { /* unsupported */ }
  let last = performance.now();
  const frame = (now) => {
    const segment = state.segment && state.segments[state.segment];
    if (segment) segment.deltas.push(now - last);
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  w.__kbNavCostBegin = (name) => {
    state.segments[name] = { deltas: [], longTaskMs: 0, styleReadsAt: state.styleReads };
    state.segment = name;
    last = performance.now();
  };
  w.__kbNavCostEnd = () => {
    const segment = state.segment && state.segments[state.segment];
    if (segment) segment.styleReads = state.styleReads - segment.styleReadsAt;
    state.segment = null;
  };
};

const summarise = (segment) => {
  const sorted = [...segment.deltas].sort((a, b) => a - b);
  const at = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
  return {
    frames: sorted.length,
    p50: Math.round(at(.5) * 10) / 10,
    p95: Math.round(at(.95) * 10) / 10,
    max: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
    over33: sorted.filter((delta) => delta > 33).length,
    longTaskMs: Math.round(segment.longTaskMs),
    styleReads: segment.styleReads ?? null,
  };
};

async function measure(page, name, act, landed) {
  await page.evaluate((segment) => window.__kbNavCostBegin(segment), name);
  await act();
  try {
    await page.waitForFunction(landed, null, { timeout: 15000 });
    await waitForMotionIdle(page);
  } catch (error) {
    const where = await page.evaluate(() => ({
      home: document.getElementById('ovStart')?.classList.contains('on'),
      online: document.getElementById('ovOnline')?.classList.contains('on'),
      panels: [...document.querySelectorAll('#ovOnline .panel')]
        .filter((panel) => !panel.hidden).map((panel) => panel.id),
      me: !!document.querySelector('#onLadderList .lrow.me'),
      active: document.getElementById('kbroot')?.classList.contains('page-motion-active'),
    }));
    throw new Error(`${name} never landed: ${error.message} :: ${JSON.stringify(where)}`);
  }
  await page.evaluate(() => window.__kbNavCostEnd());
}

/* Freeze one same-shell run part-way and read what the compositor is being
   asked to do: which surfaces blur, what they are promised, whether the
   shell's slab and scrim are the pseudo-elements the controller animates. */
async function sampleMovingSurfaces(page) {
  await page.waitForFunction(() => document.getElementById('kbroot')
    ?.classList.contains('page-motion-active'), null, { timeout: 1000 });
  return page.evaluate(async () => {
    const managed = document.getAnimations({ subtree: true })
      .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id));
    for (const animation of managed) {
      animation.pause();
      animation.currentTime = Number(animation.effect?.getComputedTiming().duration ?? 0) * .3;
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const backdrop = (style) => style.backdropFilter || style.webkitBackdropFilter || '';
    const surfaces = [...document.querySelectorAll('.page-motion-source,.page-motion-target')];
    const stage = document.querySelector('.page-motion-within');
    const title = document.getElementById('onTitle');
    const reading = {
      ids: managed.map((animation) => animation.id).sort(),
      surfaces: surfaces.map((element) => ({
        id: element.id || element.className,
        backdrop: backdrop(getComputedStyle(element)),
        willChange: getComputedStyle(element).willChange,
      })),
      slabTransform: stage ? getComputedStyle(stage, '::before').transform : null,
      scrimOpacity: stage ? Number(getComputedStyle(stage, '::after').opacity) : null,
      titleOpacity: title ? Number(getComputedStyle(title).opacity) : null,
      drift: getComputedStyle(document.getElementById('bg'), '::before').animationPlayState,
    };
    for (const animation of managed) animation.play();
    return reading;
  });
}

export async function runPageNavigationPerformanceScenarios(suite) {
  const { visitChromium, out, check } = suite;
  /* The Profile door with a ranked standing: the same fixture the motion
     probes use to reach a Ladder that seats the player, so every route the
     owner named is real — Profile <-> Ladder inside the shell, then
     Profile -> Home and Home -> Ladder across overlays. */
  const run = await visitChromium({
    named: true,
    ladderNearBottom: true,
    viewport: { width: 390, height: 844 },
    dataDelay: 0,
    skipStandardProbes: true,
    returnAfterProbe: true,
    initScript: RECORD_NAVIGATION_COST,
    probe: async (page) => {
      await waitForMotionIdle(page);
      await measure(page, 'profileToLadder',
        () => page.click('#btnLadder'),
        () => document.getElementById('onLadder')?.hidden === false
          && !!document.querySelector('#onLadderList .lrow.me'));
      let moving = null;
      await measure(page, 'ladderToProfile',
        async () => {
          await page.click('#onLadderList .lrow.me');
          moving = await sampleMovingSurfaces(page);
        },
        () => document.getElementById('onAccount')?.hidden === false);
      /* the Ladder owns Profile's way back when it opened Profile itself */
      await measure(page, 'backToLadder',
        () => page.click('#btnOnlineBack'),
        () => document.getElementById('onLadder')?.hidden === false);
      await measure(page, 'ladderToHome',
        () => page.click('#btnOnlineBack'),
        () => document.getElementById('ovStart')?.classList.contains('on')
          && !document.getElementById('ovOnline')?.classList.contains('on'));
      await measure(page, 'homeToLadder',
        () => page.click('#btnBoardHome'),
        () => document.getElementById('onLadder')?.hidden === false);
      const cost = await page.evaluate(() => ({
        segments: structuredClone(window.__kbNavCost.segments),
        animated: [...window.__kbNavCost.animated].sort(),
      }));
      return { moving, cost };
    },
  });
  const reading = run.probeResult;
  const segments = Object.fromEntries(Object.entries(reading?.cost.segments ?? {})
    .map(([name, segment]) => [name, summarise(segment)]));
  const animated = (reading?.cost.animated ?? []).filter((key) => !TIMING_KEYS.includes(key));
  out.pageNavigationPerformance = { segments, animated, moving: reading?.moving };

  check(Object.keys(segments).length === 5
      && Object.values(segments).every((segment) => segment.frames >= 8),
  'the navigation cost probe did not record five measured navigations', segments);
  /* THE HEAT, PINNED. `left` is layout every frame; `clipPath` is paint every
     frame on a full-screen surface. Both were the wipe. */
  check(animated.length > 0 && !animated.includes('left') && !animated.includes('clipPath'),
    'a page timeline animates a layout or paint property', animated);
  const moving = reading?.moving;
  check(moving?.surfaces.length === 2
      && moving.surfaces.every((surface) => surface.backdrop === 'none'
        && surface.willChange === 'transform, opacity')
      && moving.slabTransform && moving.slabTransform !== 'none'
      && moving.scrimOpacity > 0 && moving.scrimOpacity < .45
      && moving.titleOpacity < 1
      && moving.drift === 'paused',
  'a moving page re-blurs its backdrop, the shell slab/scrim/title are not travelling, or the backdrop drifts under it',
  moving);
  check(run.errs.length === 0, 'page errors during the navigation cost probe', run.errs);
}
