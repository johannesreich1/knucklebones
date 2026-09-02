export async function runStandingAccountSwitchScenario(suite, seedCompleteProfile) {
  const { visit, out, check } = suite;
  const run = await visit({
    preauthenticated: true,
    deferStanding: true,
    initScript: seedCompleteProfile,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      await Promise.race([
        routes.standingStarted,
        new Promise((_, reject) => setTimeout(() => reject(new Error(
          'held A standing read never started',
        )), 5000)),
      ]);
      await page.waitForFunction(() => {
        const panel = document.getElementById('onAccount');
        const controls = ['btnAvatar', 'btnLadder', 'btnHistory', 'btnKeepAcc']
          .map((id) => document.getElementById(id));
        return panel?.hidden === false && !panel.hasAttribute('data-account-pending')
          && controls.every((control) => control instanceof HTMLButtonElement
            && !control.disabled);
      }, null, { timeout: 5000 });
      const beforeSwitch = await page.evaluate(() => ({
        name: document.getElementById('accName')?.textContent?.trim(),
        rankBusy: document.getElementById('btnRank')?.getAttribute('aria-busy'),
        actionsPending: document.getElementById('onAccount')
          ?.hasAttribute('data-account-pending'),
      }));
      const accountB = '11111111-2222-4333-8444-555555555555';
      routes.setProfileAccountId(accountB);
      const switched = await page.evaluate((nextAccountId) => {
        const authKey = Object.keys(localStorage)
          .find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (!authKey) return false;
        const stored = JSON.parse(localStorage.getItem(authKey));
        const session = stored?.currentSession ?? stored;
        if (!session?.user) return false;
        session.user.id = nextAccountId;
        localStorage.setItem(authKey, JSON.stringify(stored));

        /* Preserve a complete B cache while A's answer lands. That gives the
           stale response a concrete new-owner snapshot it must not mutate. */
        localStorage.setItem('knucklebones.online.profile', JSON.stringify({
          accountId: nextAccountId,
          nickname: 'AccountB',
          rating: 777,
          avatar: 'die:2:mg',
          rank: 31,
          apex: false,
        }));
        const cached = JSON.parse(localStorage.getItem(
          'knucklebones.online.account-profile') ?? 'null');
        localStorage.setItem('knucklebones.online.account-profile', JSON.stringify({
          ...cached,
          accountId: nextAccountId,
          profile: { ...cached.profile, id: nextAccountId, nickname: 'AccountB', rating: 777 },
          user: { ...cached.user, id: nextAccountId },
          standing: { ...cached.standing, points: 777, rank: 31, percentile: 16 },
        }));
        return true;
      }, accountB);
      routes.releaseStanding();
      await routes.standingFinished;
      await page.waitForTimeout(300);
      const afterSwitch = await page.evaluate(() => {
        const small = JSON.parse(localStorage.getItem(
          'knucklebones.online.profile') ?? 'null');
        const full = JSON.parse(localStorage.getItem(
          'knucklebones.online.account-profile') ?? 'null');
        const actionIds = ['btnAvatar', 'btnLadder', 'btnRank', 'btnHistory',
          'btnKeepAcc', 'btnHaveAcc', 'btnDeleteAcc'];
        return {
          accountVisible: document.getElementById('onAccount')?.hidden === false,
          loadingVisible: document.getElementById('onLoading')?.hidden === false,
          name: document.getElementById('accName')?.textContent?.trim(),
          actionsPending: document.getElementById('onAccount')
            ?.hasAttribute('data-account-pending'),
          actionsDisabled: actionIds.every((id) =>
            document.getElementById(id)?.disabled === true),
          home: document.getElementById('homeChip')?.textContent?.trim(),
          small: small ? { accountId: small.accountId, rank: small.rank } : null,
          full: full ? { accountId: full.accountId, rank: full.standing?.rank ?? null } : null,
        };
      });
      return { switched, beforeSwitch, afterSwitch };
    },
  });
  out.onlineLoading.standingAccountSwitch = run.probeResult;
  const result = run.probeResult;
  check(result?.switched && result.beforeSwitch?.name === 'TestGuest001'
      && result.beforeSwitch.rankBusy === 'true'
      && !result.beforeSwitch.actionsPending,
  'A Profile did not settle its non-rank actions before the standing race', result);
  check(!result?.afterSwitch?.accountVisible && result.afterSwitch.loadingVisible
      && !result.afterSwitch.name && result.afterSwitch.actionsPending
      && result.afterSwitch.actionsDisabled,
  'late A standing left A Profile or its actions exposed after switching to B', result);
  check(result?.afterSwitch?.small?.accountId
      === '11111111-2222-4333-8444-555555555555'
      && result.afterSwitch.small.rank === 31
      && result.afterSwitch.full?.accountId
      === '11111111-2222-4333-8444-555555555555'
      && result.afterSwitch.full.rank === 31
      && !result.afterSwitch.home?.includes('#2'),
  'late A standing contaminated B Home or Profile cache', result);
  check(run.errs.length === 0, 'page errors during late-standing account switch', run.errs);
}
