/* MATCH HISTORY PAST ITS FIRST PAGE.
   This screen shipped capped at thirty rows and nobody noticed: #onHistoryList
   is overflow:visible in listview mode, so it never had a scrolling box and the
   list.onscroll that asked for page two never fired. There was no error and no
   spinner — it simply stopped. It stayed invisible because the harness stub
   answered three rows and ignored its cursor, so `3 < PAGE` marked the list
   finished on the first response and the paging branch was unreachable.
   These probes exist so that cannot happen quietly again. */

const settle = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

const seen = (page) => page.evaluate(() => {
  const list = document.querySelector('#onHistoryList');
  const slots = [...list.querySelectorAll('[data-slot]')].map((s) => Number(s.dataset.slot));
  return {
    mounted: slots.length,
    window: slots.length ? [Math.min(...slots), Math.max(...slots)] : null,
    rows: list.querySelectorAll('.history-row').length,
    scrollTop: document.querySelector('#ovOnline .pbody').scrollTop,
    names: [...list.querySelectorAll('.history-row .nm')].map((n) => n.textContent),
  };
});

export async function runHistoryCrawlScenarios(suite) {
  const { visit, out, check } = suite;

  const run = await visit({
    named: true,
    historyDepth: 90,          // 93 matches in the season: four pages of thirty
    viewport: { width: 390, height: 844 },
    skipStandardProbes: true,
    probe: async (page) => {
      let requests = 0;
      page.on('request', (r) => { if (r.url().includes('/rpc/match_history')) requests++; });
      await page.click('#btnHistory');
      await page.waitForSelector('#onHistory:not([hidden]) #onHistoryList .history-row',
        { timeout: 15000 });
      await settle(page);
      const opened = await seen(page);

      /* THE BUG. Crawl past row thirty. Before the fix this could not happen at
         all — the list simply ended, with no error to notice. */
      let last = opened;
      for (let i = 0; i < 10; i++) {
        await page.mouse.move(200, 500);
        await page.mouse.wheel(0, 900);
        await settle(page);
        await page.waitForTimeout(120);
        last = await seen(page);
      }
      const deep = last;

      /* The tally above the list is NOT a slot, so a repaint of the mounted
         rows cannot reach it. Change language mid-session and demand both moved
         — nothing else in the tree covers history for an in-session
         languagechange, because the localization suite builds a fresh context
         per locale. */
      const before = await page.evaluate(() => ({
        total: document.getElementById('onHistoryTotal')?.textContent?.trim(),
        first: document.querySelector('#onHistoryList .hres')?.textContent?.trim(),
      }));
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['de-DE'] });
        Object.defineProperty(navigator, 'language', { configurable: true, get: () => 'de-DE' });
        window.dispatchEvent(new Event('languagechange'));
      });
      await page.waitForFunction(() => document.querySelector('#onTitle')?.textContent !== 'HISTORY',
        { timeout: 5000 }).catch(() => {});
      await settle(page);
      const german = await page.evaluate(() => ({
        total: document.getElementById('onHistoryTotal')?.textContent?.trim(),
        first: document.querySelector('#onHistoryList .hres')?.textContent?.trim(),
        rows: document.querySelectorAll('#onHistoryList .history-row').length,
      }));
      return { opened, deep, german, before, requests };
    },
  });

  const r = run.probeResult;
  out.historyCrawl = r;

  check(r?.opened?.rows > 0, 'match history did not render its first page', r?.opened);
  check(r?.deep?.scrollTop > (r?.opened?.scrollTop ?? 0),
    'the wheel did not move the history page — every assertion below is vacuous',
    { opened: r?.opened?.scrollTop, deep: r?.deep?.scrollTop });
  /* The load-bearing one. Row 31 exists only if page two was fetched, which is
     precisely what was broken. */
  check((r?.deep?.window?.[1] ?? 0) >= 30,
    'MATCH HISTORY STOPPED AT ITS FIRST PAGE — the panel scrolls the paged body, '
    + 'not #onHistoryList, so a scroll handler on the list never fires',
    { window: r?.deep?.window, requests: r?.requests });
  check(r?.requests > 1,
    'only one history page was ever requested', { requests: r?.requests });
  check((r?.deep?.mounted ?? 999) < 93,
    'match history mounted the whole season instead of a window', r?.deep);
  check(r?.german?.rows > 0 && r.german.first !== r.before?.first,
    'the history rows did not repaint into the new language', { before: r?.before, german: r?.german });
  check(!!r?.german?.total && r.german.total !== r.before?.total,
    'THE WIN/LOSS TALLY FROZE IN THE OLD LANGUAGE — it heads the list but is not a '
    + 'slot, so repainting the mounted rows cannot reach it',
    { before: r?.before?.total, german: r?.german?.total });
  check(run.errs.length === 0, 'page errors while crawling match history', run.errs);
}
