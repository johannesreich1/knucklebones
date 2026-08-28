/* THE CRAWL. This scenario exists because of a shipped bug that a WebKit-only
   suite could not see: the ladder hand-compensated a prepend while the browser
   was ALSO scroll-anchoring the same insertion, so pulling toward the top of
   the board threw the reader roughly a page back down it. Native scroll
   anchoring is a Chromium behaviour (and, from Safari 27, a WebKit one), so the
   guard has to run in an engine that implements it.
   Every assertion below carries a VACUITY GUARD. A windowed list fails quietly
   — nothing moves, nothing loads — so "the number was zero" is only evidence if
   something actually happened first. */

const settle = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

/* A real wheel, not a scrollTop write: the write is the very thing under test,
   and it would not exercise the compositor path the bug lives on. NOTE this
   measures the wheel path, not iOS touch momentum — that stays a device
   acceptance item (docs/architecture/testing.md). */
async function wheel(page, dy) {
  await page.mouse.move(200, 500);
  await page.mouse.wheel(0, dy);
  await settle(page);
  return page.evaluate(() => document.querySelector('#ovOnline .pbody').scrollTop);
}

const geometry = (page) => page.evaluate(() => {
  const body = document.querySelector('#ovOnline .pbody');
  const list = document.querySelector('#onLadderList');
  const slots = [...list.querySelectorAll('[data-slot]')].map((s) => Number(s.dataset.slot));
  return {
    scrollTop: body.scrollTop,
    mounted: slots.length,
    window: slots.length ? [Math.min(...slots), Math.max(...slots)] : null,
    rows: list.querySelectorAll('.lrow').length,
  };
});

export async function runLadderScrollScenarios(suite) {
  const { visit, visitChromium, out, check } = suite;
  out.ladderScroll = {};

  for (const [engine, open] of [['webkit', visit], ['chromium', visitChromium]]) {
    const run = await open({
      named: true,
      ladderNearBottom: true,
      viewport: { width: 390, height: 844 },
      skipStandardProbes: true,
      probe: async (page) => {
        let requests = 0;
        page.on('request', (r) => { if (r.url().includes('/rpc/leaderboard')) requests++; });
        /* The default door is the profile; the ladder is one tap further in. */
        await page.click('#btnLadder');
        await page.waitForSelector('#onLadder:not([hidden]) #onLadderList .lrow.me',
          { timeout: 15000 });
        await settle(page);

        /* Scroll anchoring, read from the engine rather than from the source.
           CSS.supports is the load-bearing half: without it an 'auto' reading
           cannot be told apart from "this engine never heard of the property",
           which is exactly how paged-view.css lost its band once. */
        const anchor = await page.evaluate(() => ({
          supported: CSS.supports('overflow-anchor', 'none'),
          onLadder: getComputedStyle(document.querySelector('#ovOnline .pbody')).overflowAnchor,
          listview: document.getElementById('ovOnline').classList.contains('listview'),
        }));

        /* THE BUG ITSELF, measured over a SHORT pull. The reference row has to
           survive the crawl for its travel to mean anything, so this goes just
           far enough to make a page load above it — a long haul would trim it
           legitimately and the number would be about nothing. The reader's row
           must move exactly as far as the view did and not one pixel further;
           the shipped bug added about a page of unasked-for travel here. */
        const start = await geometry(page);
        const before = await page.evaluate(() => {
          const body = document.querySelector('#ovOnline .pbody');
          const edge = body.getBoundingClientRect().top + 40;
          const rows = [...document.querySelectorAll('#onLadderList .lrow')];
          const ref = rows.find((r) => r.getBoundingClientRect().top >= edge) ?? rows[0];
          window.__ref = ref;
          return { pos: ref.closest('[data-slot]').dataset.slot,
                   top: +ref.getBoundingClientRect().top.toFixed(2) };
        });
        let scrolled = start.scrollTop;
        const steps = [];
        for (let i = 0; i < 4; i++) {
          const was = scrolled;
          scrolled = await wheel(page, -260);
          await page.waitForTimeout(120);
          await settle(page);
          steps.push(await page.evaluate((s) => {
            const ref = window.__ref;
            const list = document.querySelector('#onLadderList');
            const body = document.querySelector('#ovOnline .pbody');
            const slots = [...list.querySelectorAll('[data-slot]')].map((x) => Number(x.dataset.slot));
            return { attached: ref.isConnected,
                     top: +ref.getBoundingClientRect().top.toFixed(2), was: s,
                     now: body.scrollTop,
                     slot: ref.closest('[data-slot]')?.dataset.slot,
                     contentTop: Math.round(ref.getBoundingClientRect().top
                       - list.getBoundingClientRect().top),
                     listTop: Math.round(list.getBoundingClientRect().top
                       - body.getBoundingClientRect().top + body.scrollTop),
                     padTop: Math.round(parseFloat(list.style.paddingTop) || 0),
                     padBottom: Math.round(parseFloat(list.style.paddingBottom) || 0),
                     sh: body.scrollHeight,
                     win: slots.length ? [Math.min(...slots), Math.max(...slots)] : null };
          }, was));
        }
        const after = await page.evaluate((was) => ({
          attached: window.__ref.isConnected,
          samePos: window.__ref.closest('[data-slot]')?.dataset.slot === was.pos,
          moved: +window.__ref.getBoundingClientRect().top.toFixed(2) - was.top,
        }), before);
        const shortEnd = scrolled;
        /* FRAME COST, REPORTED AND NOT ASSERTED. Chromium only (CPU throttling
           is a CDP feature), and deliberately thresholdless: this gate runs one
           worker on a two-core runner that practice-sheet-stability already
           documents as sometimes stopping painting altogether, so a wall-clock
           budget here would go red on contention alone. The number is recorded
           so a regression is visible in `out` without being able to flake the
           suite. */
        let frames = null;
        const cdp = page.context().browser()?.browserType().name() === 'chromium'
          ? await page.context().newCDPSession(page).catch(() => null) : null;
        if (cdp) {
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          await page.evaluate(() => {
            window.__f = { spliced: [], last: performance.now(), dirty: false };
            new MutationObserver(() => { window.__f.dirty = true; })
              .observe(document.querySelector('#onLadderList'), { childList: true });
            const tick = () => {
              const now = performance.now();
              const dt = now - window.__f.last;
              window.__f.last = now;
              if (window.__f.dirty) { window.__f.spliced.push(+dt.toFixed(1)); window.__f.dirty = false; }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          for (let i = 0; i < 6; i++) await wheel(page, -600);
          await page.waitForTimeout(300);
          frames = await page.evaluate(() => {
            const v = window.__f.spliced.slice().sort((a, b) => a - b);
            return v.length ? { n: v.length, median: v[v.length >> 1], max: v[v.length - 1] } : null;
          });
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        }
        const grewAbove = requests > 0;

        /* …and now the long haul, for the structural claims: a bounded window,
           and a way back that costs nothing because the rows are still held. */
        for (let i = 0; i < 8; i++) scrolled = await wheel(page, -700);
        await page.waitForTimeout(400);
        await settle(page);
        const top = await geometry(page);
        const upRequests = requests;
        for (let i = 0; i < 8; i++) await wheel(page, 700);
        await page.waitForTimeout(400);
        await settle(page);
        const home = await geometry(page);
        const backRequests = requests - upRequests;
        const meBack = await page.evaluate(() =>
          !!document.querySelector('#onLadderList .lrow.me'));
        return { anchor, before, start, after, steps, shortEnd, grewAbove, frames, top, home, scrolled,
                 upRequests, backRequests, meBack };
      },
    });
    const r = run.probeResult;
    out.ladderScroll[engine] = r;

    check(r?.start?.scrollTop > 0 && r?.steps?.length === 4
      && r.steps.some((step) => step.top !== r.before.top),
      `[${engine}] the wheel did not move this scroller — every assertion below is vacuous`, r);
    check(r?.after?.attached === true && r.after.samePos === true,
      `[${engine}] the reference row did not survive the short pull, so its travel means nothing`,
      { after: r?.after, steps: r?.steps });
    /* Travel is measured against the SCROLL: the row moves down the screen by
       exactly what the view moved up, and by nothing else. */
    const expected = (r?.start?.scrollTop ?? 0) - (r?.shortEnd ?? 0);
    check(expected > 400,
      `[${engine}] the short pull barely moved — the travel assertion below is vacuous`,
      { start: r?.start?.scrollTop, shortEnd: r?.shortEnd });
    /* The row travels with the scroll and not a pixel more. The tolerance is a
       dozen pixels over a thousand of travel because rows above the viewport
       swap an estimated height for a measured one as they mount, and this
       design deliberately CARRIES that difference rather than paying it with a
       scroll write. The bug this guards against moved the reader ~2,500px. */
    check(Math.abs((r?.after?.moved ?? 1e9) - expected) <= 12,
      `[${engine}] growing the ladder upward threw the reader`,
      { moved: r?.after?.moved, expected, steps: r?.steps });
    /* The same claim stated where it is sharpest: the row's position in CONTENT
       coordinates must not move at all while rows are spliced in above it. That
       is the anchor invariant, and it is what makes the crawl free. */
    const content = (r?.steps ?? []).map((step) => step.contentTop);
    check(content.length === 4
      && Math.max(...content) - Math.min(...content) <= 8,
      `[${engine}] splicing rows in above the viewport moved the content under the reader`,
      content);
    check(r?.top?.mounted > 0 && r.top.mounted <= 90,
      `[${engine}] the crawl mounted the board instead of a window`, r?.top);
    check(r?.backRequests === 0,
      `[${engine}] the way back refetched rows the reader had already seen`,
      { up: r?.upRequests, back: r?.backRequests });
    check(r?.meBack === true,
      `[${engine}] crawling up and back did not return to the player's row`, r?.home);
    check(r?.anchor?.listview === true,
      `[${engine}] the ladder is not in listview mode, so the anchoring rule cannot apply`,
      r?.anchor);
    if (r?.anchor?.supported) {
      check(r.anchor.onLadder === 'none',
        `[${engine}] THE LADDER SCROLLER NO LONGER DISABLES SCROLL ANCHORING — the browser will `
        + 'compensate every prepend a second time on top of the list’s own pad. '
        + 'Do not delete that rule as unused; this engine implements the feature.',
        r.anchor);
    }
    check(run.errs.length === 0, `[${engine}] page errors while crawling the ladder`, run.errs);
  }
}
