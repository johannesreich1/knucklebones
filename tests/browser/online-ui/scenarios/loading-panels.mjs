export async function runOnlineLoadingPanelScenarios(suite) {
  const { visit, out, check } = suite;

  const profile = await visit({ inspectLoading: true });
  const ladder = await visit({ door: 'board', inspectLoading: true });
  out.onlineLoading = { profile: profile.loading, ladder: ladder.loading };

  for (const [name, run, title, finalPanel] of [
    ['profile', profile, 'PROFILE', 'account'],
    ['ladder', ladder, 'LADDER', null],
  ]) {
    const loading = run.loading;
    check(loading?.visible === true,
      `${name} does not show the shared loading die after its grace`, loading);
    check(Math.abs(loading?.xError ?? 999) <= 1 && Math.abs(loading?.yError ?? 999) <= 24,
      `${name} loading die is not centred in the visible view`, loading);
    check(loading?.targetHidden === true && loading?.visiblePanels?.length === 0,
      `${name} reveals partial content behind its loading die`, loading);
    check(loading?.entry?.frames > 0 && loading.entry.emptyFrames === 0
      && loading.entry.first?.visiblePanels.includes('onLoading'),
    `${name} exposed an empty lazy online shell during entry`, loading);
    check(loading?.title === title,
      `${name} loading state lost the destination title`, loading);
    if (finalPanel) {
      check(run.seen.panel === finalPanel && run.seen.accName === 'TestGuest001',
        'profile did not reveal one complete final view', run.seen);
    } else {
      check(run.seen.rows.length === 2,
        'ladder did not replace its centred wait with the final rows', run.seen);
    }
    check(run.errs.length === 0, `page errors during the ${name} loading transition`, run.errs);
  }

  const paginationRace = await visit({
    door: 'board',
    paginationRace: true,
    skipStandardProbes: true,
    probe: async (page, routes) => {
      await page.evaluate(() => {
        const list = document.querySelector('#onBoardList');
        if (!list) throw new Error('ladder list missing before pagination race');
        list.scrollTop = list.scrollHeight;
        list.dispatchEvent(new Event('scroll'));
      });
      await Promise.race([
        routes.paginationStarted,
        new Promise((_, reject) => setTimeout(() => reject(new Error(
          'run A never started its deferred ladder page',
        )), 5000)),
      ]);
      await page.click('#btnOnlineBack');
      await page.waitForSelector('#ovStart.on', { timeout: 15000 });
      await page.click('#homeChip');
      await page.waitForSelector('#onAccount:not([hidden])', { timeout: 15000 });
      await page.click('#btnLadder');
      await page.waitForSelector('#onBoard:not([hidden])', { timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('#onBoardList .lrow').length === 2);
      const names = () => page.locator('#onBoardList .lrow .nm').allTextContents();
      const before = await names();
      const staleResponse = page.waitForResponse((response) =>
        response.headers()['x-kb-fixture'] === 'stale-run-a');
      routes.releasePagination();
      const response = await staleResponse;
      await response.finished();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() =>
        requestAnimationFrame(resolve))));
      return { before, after: await names() };
    },
  });
  out.onlineLoading.paginationRace = paginationRace.probeResult;
  check(
    paginationRace.probeResult?.before?.join() === 'NovaComet992,TestGuest001'
      && paginationRace.probeResult?.after?.join() === 'NovaComet992,TestGuest001',
    'a deferred page from ladder run A contaminated reopened run B',
    paginationRace.probeResult,
  );
  check(paginationRace.errs.length === 0,
    'page errors during the deferred ladder pagination race', paginationRace.errs);
}
