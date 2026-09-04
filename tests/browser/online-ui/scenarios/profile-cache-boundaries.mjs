const ACCOUNT_A = '00000000-0000-4000-8000-00000000beef';
const ACCOUNT_B = '11111111-2222-4333-8444-555555555555';

export async function runProfileCacheBoundaryScenarios(suite, seedCompleteProfile) {
  const { visit, out, check } = suite;

  const firstFrame = await visit({
    preauthenticated: true,
    sessionAccountId: ACCOUNT_B,
    initScript: seedCompleteProfile,
    inspectEntry: true,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: (page) => page.evaluate(() => ({
      name: document.getElementById('onAccount')?.dataset.accountName?.trim(),
      fullAccount: JSON.parse(localStorage.getItem(
        'knucklebones.online.account-profile') ?? 'null')?.accountId,
    })),
  });
  out.onlineLoading.accountReplacementFirstFrame = firstFrame.entry;
  check(firstFrame.entry?.first?.visiblePanels?.join() === 'onLoading'
      && firstFrame.entry.emptyFrames === 0
      && firstFrame.probeResult?.name === 'TestGuest001'
      && firstFrame.probeResult.fullAccount === ACCOUNT_B,
  'Profile painted account A before verifying the persisted account B session',
  { entry: firstFrame.entry, final: firstFrame.probeResult });

  const coldFailure = await visit({
    preauthenticated: true,
    failStanding: true,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      await page.waitForFunction(() => document.getElementById('onAccount')?.dataset.accountName ===
        'TestGuest001' && !document.getElementById('onAccount')
        ?.hasAttribute('data-account-pending'));
      const first = await page.evaluate(() => JSON.parse(localStorage.getItem(
        'knucklebones.online.account-profile') ?? 'null'));
      routes.setProfileFactsUnavailable(true);
      await page.click('#btnOnlineBack');
      await page.waitForSelector('#ovStart.on', { timeout: 5000 });
      await page.click('#homeChip');
      await page.waitForFunction(() => document.getElementById('onAccount')?.dataset.accountName ===
        'TestGuest001' && !document.getElementById('onAccount')
        ?.hasAttribute('data-account-pending'));
      const reopened = await page.evaluate(() => {
        const visible = (element) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none'
            && style.visibility === 'visible' && Number(style.opacity) > .9;
        };
        return {
          profileVisible: visible(document.getElementById('onAccount')),
          fullLoaderVisible: visible(document.querySelector('#onLoading .ldwait')),
          points: document.getElementById('accPoints')?.textContent,
          rankBusy: document.getElementById('btnRank')?.getAttribute('aria-busy'),
          inlineLoaderVisible: visible(document.querySelector('#accRank .ldclock')),
          cached: JSON.parse(localStorage.getItem(
            'knucklebones.online.account-profile') ?? 'null'),
        };
      });
      return { first, ...reopened };
    },
  });
  out.onlineLoading.coldStandingFailure = coldFailure.probeResult;
  const cold = coldFailure.probeResult;
  check(cold?.first?.standingKnown === false && cold.profileVisible && !cold.fullLoaderVisible
      && cold.points === '465' && cold.rankBusy === 'true' && cold.inlineLoaderVisible
      && cold.cached?.standingKnown === false && cold.cached?.ladder?.points === 465,
  'cold failed standing did not become a reusable Profile with an inline rank wait', cold);

  const settledPoints = await visit({
    preauthenticated: true,
    deferStanding: true,
    standingPoints: 465,
    reportedStandingPoints: 1260,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      await routes.standingStarted;
      await page.waitForFunction(() => document.getElementById('accPoints')?.textContent === '465');
      /* Only NEON waits for the standing. The league the points already prove
         is painted with them, not the reset's STONE. */
      const readGroup = () => page.evaluate(() => ({
        label: document.getElementById('accGroup')?.textContent?.trim(),
        ringMaterial: document.getElementById('accRing')?.style.getPropertyValue('--lr-material'),
      }));
      const pendingGroup = await readGroup();
      routes.releaseStanding();
      await routes.standingFinished;
      await page.waitForFunction(() => document.getElementById('accPoints')?.textContent === '1,260');
      const settledGroup = await readGroup();
      const value = await page.evaluate(() => ({
        small: JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null'),
        full: JSON.parse(localStorage.getItem(
          'knucklebones.online.account-profile') ?? 'null'),
      }));
      await page.click('#btnOnlineBack');
      await page.waitForSelector('#ovStart.on', { timeout: 5000 });
      return { ...value, pendingGroup, settledGroup, home: await page.locator('#homeChip').innerText() };
    },
  });
  out.onlineLoading.settledProfilePoints = settledPoints.probeResult;
  const settled = settledPoints.probeResult;
  check(settled?.small?.rating === 1260 && settled.small.rank === 2
      && settled.full?.profile?.rating === 1260 && settled.full?.ladder?.points === 1260
      && settled.full?.standing?.points === 1260 && settled.home.includes('#2'),
  'fresh standing rank and points were split across Profile/Home cache generations', settled);
  check(settled?.pendingGroup?.label === 'BONE'
      && settled.pendingGroup.ringMaterial === 'var(--g-bone)'
      && settled.settledGroup?.label && settled.settledGroup.label !== 'BONE',
  'a fresh Profile waited for the standing before painting the league its points prove',
  { pending: settled?.pendingGroup, settled: settled?.settledGroup });

  const resultSwitch = await visit({
    preauthenticated: true,
    sessionAccountId: ACCOUNT_B,
    initScript: seedCompleteProfile,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      await page.evaluate((accountId) => localStorage.setItem(
        'knucklebones.online.profile', JSON.stringify({
          accountId, nickname: 'CachedAccountB', rating: 777,
          avatar: 'die:2:mg', rank: 31, apex: false,
        }),
      ), ACCOUNT_B);
      routes.setProfileNickname('AccountB');
      routes.deferNextAccountProfileResponse();
      await page.evaluate((ownerAccountId) => window.__kbResult({
        ownerAccountId, won: true, draw: false, forfeit: false,
        my: 48, their: 31, delta: 21, opp: 'NovaComet992',
        oppAvatar: 'die:3:mg', oppRating: 1072,
      }), ACCOUNT_A);
      await routes.accountProfileStarted;
      await page.waitForSelector('#ovEnd.on', { timeout: 5000 });
      const initial = await page.evaluate(() => {
        const mine = document.querySelector('#endPlates > :first-child');
        return { name: mine?.querySelector('.nm2')?.textContent?.trim(),
          rank: mine?.querySelector('.gpill')?.textContent?.trim() };
      });
      routes.releaseAccountProfileResponse();
      await routes.accountProfileFinished;
      await page.waitForFunction(() => JSON.parse(localStorage.getItem(
        'knucklebones.online.profile') ?? 'null')?.nickname === 'AccountB');
      await page.waitForTimeout(150);
      const final = await page.evaluate(() => {
        const mine = document.querySelector('#endPlates > :first-child');
        return {
          name: mine?.querySelector('.nm2')?.textContent?.trim(),
          rank: mine?.querySelector('.gpill')?.textContent?.trim(),
          cache: JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null'),
        };
      });
      return { initial, final };
    },
  });
  out.onlineLoading.resultAccountSwitch = resultSwitch.probeResult;
  check(resultSwitch.probeResult?.initial?.name !== 'CachedAccountB'
      && !resultSwitch.probeResult.initial?.rank?.includes('#31')
      && resultSwitch.probeResult.final.name !== 'AccountB'
      && resultSwitch.probeResult.final.name !== 'CachedAccountB'
      && !resultSwitch.probeResult.final.rank?.includes('#2')
      && resultSwitch.probeResult.final.cache?.accountId === ACCOUNT_B
      && resultSwitch.probeResult.final.cache?.nickname === 'AccountB'
      && resultSwitch.probeResult.final.cache?.rank === 31,
  'Result A adopted account B identity during delayed hydration', resultSwitch.probeResult);
}
