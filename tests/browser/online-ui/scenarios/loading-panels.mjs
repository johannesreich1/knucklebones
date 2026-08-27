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
        const body = document.querySelector('#ovOnline .pbody');
        if (!body) throw new Error('ladder page scroller missing before pagination race');
        body.scrollTop = body.scrollHeight;
        body.dispatchEvent(new Event('scroll'));
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
      await page.waitForSelector('#onLadder:not([hidden])', { timeout: 15000 });
      await page.waitForFunction(() => document.querySelectorAll('#onLadderList .lrow').length === 2);
      const names = () => page.locator('#onLadderList .lrow .nm').allTextContents();
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

  /* Ladder is a retained panel inside one reused overlay. Hold the first
     identity request so the browser must paint the pre-identity state — for a
     returning player that is the queue's searching panel, not the loading
     die — instead of letting a fast local mock conceal it in the same frame. */
  const rankedAfterLadder = await visit({
    door: 'board',
    skipStandardProbes: true,
    probe: async (page, routes) => {
      await page.evaluate(() => { window.__kb.S.played = true; });
      routes.deferNextSignupResponse();
      await page.click('#btnOnlineBack');
      await page.waitForSelector('#ovStart.on', { timeout: 15000 });
      await page.evaluate(() => {
        window.__rankedEntryFrame = null;
        document.getElementById('btnOnline')?.addEventListener('pointerup', () => {
          requestAnimationFrame(() => {
            const overlay = document.getElementById('ovOnline');
            const board = document.getElementById('onLadder');
            const style = overlay ? getComputedStyle(overlay) : null;
            window.__rankedEntryFrame = {
              onlineOn: overlay?.classList.contains('on') ?? false,
              title: document.getElementById('onTitle')?.textContent ?? null,
              visiblePanels: [...document.querySelectorAll('#ovOnline .panel')]
                .filter((panel) => !panel.hidden && panel.getClientRects().length > 0)
                .map((panel) => panel.id),
              boardHidden: board?.hidden ?? null,
              boardRects: board?.getClientRects().length ?? null,
              opacity: Number(style?.opacity ?? 0),
              visibility: style?.visibility ?? null,
              eagerLoading: document.getElementById('ovLoad')?.classList.contains('on') ?? false,
            };
          });
        }, { capture: true, once: true });
      });
      await page.click('#btnOnline');
      await Promise.race([
        routes.signupRequestStarted,
        new Promise((_, reject) => setTimeout(() => reject(new Error(
          'ranked entry never started its deferred identity request',
        )), 5000)),
      ]);
      await page.waitForFunction(() => window.__rankedEntryFrame !== null);
      const frame = await page.evaluate(() => window.__rankedEntryFrame);
      routes.releaseSignupResponse();
      await routes.signupRequestFinished;
      await page.waitForSelector('#onQueue:not([hidden])', { timeout: 15000 });
      await page.click('#btnQueueCancel');
      return frame;
    },
  });
  out.onlineLoading.rankedAfterLadder = rankedAfterLadder.probeResult;
  check(rankedAfterLadder.probeResult?.onlineOn
      && rankedAfterLadder.probeResult.title === 'MATCHMAKING'
      && rankedAfterLadder.probeResult.visiblePanels?.join() === 'onQueue'
      && rankedAfterLadder.probeResult.boardHidden
      && rankedAfterLadder.probeResult.boardRects === 0
      && !rankedAfterLadder.probeResult.eagerLoading,
    'Ranked entry repainted the retained Ladder while identity was pending',
    rankedAfterLadder.probeResult);
  check(rankedAfterLadder.errs.length === 0,
    'page errors while Ranked replaced a retained Ladder', rankedAfterLadder.errs);

  /* A first-game decision is a route boundary, not a second sheet layer. Force
     that boundary with a live face-off and verify the prompt owns the hit. */
  const firstGameAboveSheet = await visit({
    door: 'board',
    skipStandardProbes: true,
    probe: async (page) => {
      await page.click('#onLadderList .lrow:not(.me)');
      await page.waitForSelector('.faceoff [aria-modal="true"]', { timeout: 15000 });
      await page.evaluate(() => {
        window.__kb.S.played = false;
        window.__kb.S.tutDone = false;
        const play = document.getElementById('btnPlay');
        const rect = play?.getBoundingClientRect();
        const at = rect ? {
          bubbles: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        } : { bubbles: true };
        play?.dispatchEvent(new PointerEvent('pointerdown', at));
        play?.dispatchEvent(new PointerEvent('pointerup', at));
      });
      await page.waitForSelector('#ovFirst.on', { timeout: 15000 });
      return page.evaluate(() => {
        const card = document.querySelector('#ovFirst .askcard');
        const rect = card?.getBoundingClientRect();
        const hit = rect ? document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        ) : null;
        return {
          sheetAbsent: !document.querySelector('.faceoff'),
          promptOwnsHit: !!hit && !!card?.contains(hit),
          phase: window.__kb.S.phase,
        };
      });
    },
  });
  out.onlineLoading.firstGameAboveSheet = firstGameAboveSheet.probeResult;
  check(firstGameAboveSheet.probeResult?.sheetAbsent
      && firstGameAboveSheet.probeResult.promptOwnsHit
      && firstGameAboveSheet.probeResult.phase === 'menu',
    'the first-game prompt remained underneath a comparison sheet',
    firstGameAboveSheet.probeResult);
  check(firstGameAboveSheet.errs.length === 0,
    'page errors while the first-game prompt replaced a comparison sheet',
    firstGameAboveSheet.errs);
}
