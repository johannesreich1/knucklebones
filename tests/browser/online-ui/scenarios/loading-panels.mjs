import {
  runCachedProfileResilienceScenarios,
  seedCompleteProfile,
} from './cached-profile-resilience.mjs';

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

  /* A complete local Profile is the screen. Only the positional standing is
     still a wait, and that wait occupies the rank value rather than covering
     facts the device can already paint. Hold standing independently from the
     other profile reads so a fast mock cannot conceal the boundary. */
  const cachedProfile = await visit({
    preauthenticated: true,
    gameCenterBridge: 'linked',
    identityDelay: 700,
    dataDelay: 900,
    deferStanding: true,
    inspectEntry: true,
    initScript: seedCompleteProfile,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      const beforeIdentity = await page.evaluate(() => {
        const panel = document.getElementById('onAccount');
        const rank = document.getElementById('btnRank');
        const rect = rank?.getBoundingClientRect();
        const hit = rect
          ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
          : null;
        return {
          panelInert: panel?.inert === true,
          rankDisabled: rank instanceof HTMLButtonElement && rank.disabled,
          rankOwnsHit: !!hit && !!rank?.contains(hit),
        };
      });
      await Promise.race([
        routes.standingStarted,
        new Promise((_, reject) => setTimeout(() => reject(new Error(
          'Profile never started its independently deferred standing read',
        )), 5000)),
      ]);
      /* The shared die has a 200 ms no-flash grace and a 250 ms reveal. The
         coherent refresh is still held by match history for 900 ms, so this
         samples a fully visible die while the local snapshot is unquestionably
         still the presentation underneath it. */
      await page.waitForTimeout(520);
      const before = await page.evaluate(() => {
        const visible = (element) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0
            && style.visibility === 'visible' && style.display !== 'none'
            && Number(style.opacity) > .9;
        };
        const tile = document.getElementById('btnRank')?.getBoundingClientRect();
        const loader = document.querySelector('#accRank .die.ldclock');
        const loaderRect = loader?.getBoundingClientRect();
        return {
          accountVisible: visible(document.getElementById('onAccount')),
          fullLoaderHidden: !visible(document.querySelector('#onLoading .ldwait')),
          name: document.getElementById('accName')?.textContent,
          points: document.getElementById('accPoints')?.textContent,
          peak: document.getElementById('accPeak')?.textContent,
          streak: document.getElementById('accStreak')?.textContent,
          opponent: document.querySelector('#accRecent .nm')?.textContent,
          rankBusy: document.getElementById('btnRank')?.getAttribute('aria-busy'),
          loaderVisible: visible(loader),
          loaderSize: loaderRect ? [loaderRect.width, loaderRect.height] : null,
          loaderNumeral: loader?.querySelector('.num')
            ? getComputedStyle(loader.querySelector('.num')).display : null,
          visibleLoaders: [...document.querySelectorAll('.die.ldclock')].filter(visible).length,
          tile: tile ? { x: tile.x, y: tile.y, width: tile.width, height: tile.height } : null,
        };
      });
      const beforeRankAccessible = await page.getByRole('button', {
        name: /rank.*loading.*open the ladder/i,
      }).count();
      routes.releaseStanding();
      await routes.standingFinished;
      await page.waitForFunction(() => document.getElementById('accRank')?.textContent === '#2');
      const after = await page.evaluate(() => {
        const tile = document.getElementById('btnRank')?.getBoundingClientRect();
        return {
          rank: document.getElementById('accRank')?.textContent,
          busy: document.getElementById('btnRank')?.hasAttribute('aria-busy'),
          loaderGone: !document.querySelector('#accRank .ldclock'),
          panelInert: document.getElementById('onAccount')?.inert === true,
          rankDisabled: document.getElementById('btnRank')?.disabled === true,
          tile: tile ? { x: tile.x, y: tile.y, width: tile.width, height: tile.height } : null,
        };
      });
      const afterRankAccessible = await page.getByRole('button', {
        name: /rank.*#2.*open the ladder/i,
      }).count();
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'languages', {
          configurable: true, get: () => ['de-DE'],
        });
        window.dispatchEvent(new Event('languagechange'));
      });
      await page.waitForFunction(() => document.documentElement.dataset.locale === 'de');
      const localizedRankAccessible = await page.getByRole('button', {
        name: /rang.*#2.*rangliste öffnen/i,
      }).count();
      await page.click('#btnOnlineBack');
      await page.waitForSelector('#ovStart.on', { timeout: 5000 });
      const home = await page.locator('#homeChip').innerText();
      return { beforeIdentity, before, beforeRankAccessible,
        after, afterRankAccessible, localizedRankAccessible, home };
    },
  });
  out.onlineLoading.cachedProfile = cachedProfile.probeResult;
  const cached = cachedProfile.probeResult;
  check(cachedProfile.standingCallsBeforeOnline === 0,
    'Home fetched standing before an online door was opened', cachedProfile.standingCallsBeforeOnline);
  check(cachedProfile.homeStyles?.before?.chip.includes('#17'),
    'Home did not paint its cached rank immediately', cachedProfile.homeStyles?.before);
  check(cachedProfile.entry?.frames > 0 && cachedProfile.entry.emptyFrames === 0
      && cachedProfile.entry.first?.visiblePanels?.join() === 'onAccount',
  'a complete cached Profile showed a full-view wait during entry', cachedProfile.entry);
  check(!cached?.beforeIdentity?.panelInert && cached.beforeIdentity.rankDisabled
      && !cached.beforeIdentity.rankOwnsHit,
    'cached Profile controls were live before their account was verified',
    cached?.beforeIdentity);
  check(cached?.before?.accountVisible && cached.before.fullLoaderHidden
      && cached.before.name === 'CachedPlayer' && cached.before.points === '321'
      && cached.before.peak === '500' && cached.before.streak === '9'
      && cached.before.opponent === 'CachedOpponent',
  'a complete cached Profile was not painted before its remote refresh', cached?.before);
  check(cached?.before?.rankBusy === 'true' && cached.before.loaderVisible
      && cached.before.loaderSize?.every((size) => Math.abs(size - 16) <= .5)
      && cached.before.loaderNumeral === 'none' && cached.before.visibleLoaders === 1,
  'rank did not own the one visible, pips-only inline loading die', cached?.before);
  check(cached?.beforeRankAccessible === 1 && cached.afterRankAccessible === 1
      && cached.localizedRankAccessible === 1,
    'the rank wait/value was absent from the button accessibility name', cached);
  check(cached?.after?.rank === '#2' && !cached.after.busy && cached.after.loaderGone
      && !cached.after.panelInert && !cached.after.rankDisabled,
    'fresh standing did not replace the inline rank wait', cached?.after);
  check(cached?.before?.tile && cached.after.tile
      && Math.abs(cached.before.tile.x - cached.after.tile.x) <= .5
      && Math.abs(cached.before.tile.y - cached.after.tile.y) <= .5
      && Math.abs(cached.before.tile.width - cached.after.tile.width) <= .5
      && Math.abs(cached.before.tile.height - cached.after.tile.height) <= .5,
  'the rank tile moved when its inline loader became the value', cached);
  check(cached?.home.includes('#2'),
    'Home did not adopt the fresh rank after Profile loaded it', cached?.home);
  check(cachedProfile.errs.length === 0,
    'page errors during cached Profile rank loading', cachedProfile.errs);

  /* First-rune discovery is independent of the complete cached Profile. If it
     is unavailable, Profile still verifies and unlocks ordinary controls;
     only the authority-owned rune seat stays closed while rank waits inline. */
  const unavailableEntryRunes = await visit({
    preauthenticated: true,
    failRuneOnCall: 'all',
    deferStanding: true,
    initScript: seedCompleteProfile,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      await Promise.race([
        routes.standingStarted,
        page.waitForTimeout(5000).then(() => { throw new Error(
          'Profile did not start standing after entry rune hydration failed'); }),
      ]);
      await page.waitForFunction(() => !document.getElementById('onAccount')
        ?.hasAttribute('data-account-pending'));
      const state = await page.evaluate(() => ({
        profileVisible: document.getElementById('onAccount')?.hidden === false,
        fullLoaderHidden: document.getElementById('onLoading')?.hidden === true,
        name: document.getElementById('accName')?.textContent,
        avatarEnabled: !document.getElementById('btnAvatar')?.disabled,
        claimEnabled: !document.getElementById('btnClaim')?.disabled,
        seatDisabled: document.getElementById('accSeat')?.disabled,
        rankBusy: document.getElementById('btnRank')?.getAttribute('aria-busy'),
        inlineRankLoader: !!document.querySelector('#accRank .die.ldclock'),
        visibleLoaders: [...document.querySelectorAll('.die.ldclock')]
          .filter((element) => element.getClientRects().length > 0).length,
      }));
      const runeCalls = routes.runeCalls();
      routes.releaseStanding();
      await routes.standingFinished;
      return { ...state, runeCalls };
    },
  });
  out.onlineLoading.unavailableEntryRunes = unavailableEntryRunes.probeResult;
  const unavailableEntry = unavailableEntryRunes.probeResult;
  check(unavailableEntry?.profileVisible && unavailableEntry.fullLoaderHidden
      && unavailableEntry.name === 'TestGuest001'
      && unavailableEntry.avatarEnabled && unavailableEntry.claimEnabled
      && unavailableEntry.seatDisabled && unavailableEntry.rankBusy === 'true'
      && unavailableEntry.inlineRankLoader && unavailableEntry.visibleLoaders === 1
      && unavailableEntry.runeCalls >= 2,
  'entry rune failure left a complete cached Profile locked or fully loading', unavailableEntry);
  check(unavailableEntryRunes.errs.length === 0,
    'page errors while Profile recovered from unavailable entry runes',
    unavailableEntryRunes.errs);

  await runCachedProfileResilienceScenarios(suite);

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
