const REPORT = {
  won: true,
  draw: false,
  forfeit: false,
  my: 48,
  their: 31,
  delta: 21,
  opp: 'NovaComet992',
  oppAvatar: 'die:3:mg',
  oppRating: 1072,
};

async function profileRuneProbe(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const slots = [...document.querySelectorAll('#accRuneGrid .accrune')].map((slot) => ({
      label: slot.getAttribute('aria-label'),
      disabled: slot.getAttribute('aria-disabled'),
      collected: slot.classList.contains('collected'),
      locked: slot.classList.contains('locked'),
      visible: visible(slot),
      opacity: getComputedStyle(slot).opacity,
    }));
    return {
      count: document.getElementById('accRuneCount')?.textContent?.trim(),
      gridLabel: document.getElementById('accRuneGrid')?.getAttribute('aria-label'),
      slots,
    };
  });
}

async function resultRewardRaceProbe(page, routes) {
  routes.deferNextRuneResponse();
  await page.evaluate((report) => window.__kbResult(report), REPORT);
  await Promise.all([
    page.waitForSelector('#ovEnd.on', { timeout: 15000 }),
    Promise.race([
      routes.runeRequestStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        'the delayed result collection request never started',
      )), 5000)),
    ]),
  ]);
  const pending = await page.evaluate(() => {
    const overlay = document.getElementById('ovEnd');
    const box = overlay?.getBoundingClientRect();
    const visible = (selector) => {
      const element = document.querySelector(selector);
      const bounds = element?.getBoundingClientRect();
      return !!bounds && bounds.width > 0 && bounds.height > 0;
    };
    return {
      resultVisible: !!overlay?.classList.contains('on') && !!box && box.width > 0 && box.height > 0,
      title: document.getElementById('endTitle')?.textContent?.trim(),
      score: `${document.getElementById('endYou')?.textContent}:${document.getElementById('endCpu')?.textContent}`,
      featureHidden: document.getElementById('endFeature')?.hidden,
      nextVisible: visible('#btnAgain'),
      homeVisible: visible('#btnEndQuiet'),
    };
  });

  await page.click('#btnEndQuiet');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  routes.releaseRuneResponse();
  await Promise.race([
    routes.runeRequestFinished,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'the released result collection request never finished',
    )), 5000)),
  ]);
  await page.waitForTimeout(100);
  const afterNavigation = await page.evaluate(() => ({
    resultOpen: document.getElementById('ovEnd')?.classList.contains('on'),
    homeOpen: document.getElementById('ovStart')?.classList.contains('on'),
    featureHidden: document.getElementById('endFeature')?.hidden,
    featureText: document.getElementById('endFeature')?.textContent?.trim(),
  }));

  await page.evaluate((report) => window.__kbResult(report), REPORT);
  await page.waitForSelector('#ovEnd.on #endFeature:not([hidden])', { timeout: 15000 });
  const freshReward = await page.evaluate(() => ({
    title: document.querySelector('#endFeature .endfeature-copy b')?.textContent?.trim(),
    kicker: document.querySelector('#endFeature .endfeature-copy small')?.textContent?.trim(),
    action: document.querySelector('#endFeature .endfeature-action')?.textContent?.trim(),
    featureVisible: document.getElementById('endFeature')?.hidden === false,
  }));
  await Promise.race([
    routes.acknowledgeStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'the visible rune reward was not acknowledged',
    )), 5000)),
  ]);
  return {
    pending,
    afterNavigation,
    freshReward,
    acknowledgeCalls: routes.acknowledgeCalls(),
  };
}

export async function runRuneTrialUiScenarios({ visit, out, check }) {
  const profile = await visit({
    named: true,
    runes: ['fate', 'ward'],
    skipStandardProbes: true,
    probe: profileRuneProbe,
  });
  out.runeCollectionProfile = profile.probeResult;
  const slots = profile.probeResult?.slots ?? [];
  check(slots.length === 6
      && slots.every(({ visible, label }) => visible && !!label)
      && slots.filter(({ collected, disabled }) => collected && disabled === null).length === 2
      && slots.filter(({ locked, disabled }) => locked && disabled === 'true').length === 4
      && profile.probeResult?.count === '2 / 6'
      && profile.probeResult?.gridLabel?.includes('2'),
    'profile did not render six visible rune collection slots with owned/locked state',
    profile.probeResult);
  check(profile.errs.length === 0, 'page errors while rendering the rune collection profile', profile.errs);

  const result = await visit({
    named: true,
    runes: ['fate'],
    skipStandardProbes: true,
    probe: resultRewardRaceProbe,
  });
  out.runeRewardRace = result.probeResult;
  check(result.probeResult?.pending?.resultVisible
      && result.probeResult.pending.title === 'VICTORY'
      && result.probeResult.pending.score === '48:31'
      && result.probeResult.pending.featureHidden
      && result.probeResult.pending.nextVisible
      && result.probeResult.pending.homeVisible,
    'ranked result withheld its base screen while rune reward collection was pending',
    result.probeResult?.pending);
  check(result.probeResult?.afterNavigation?.homeOpen
      && !result.probeResult.afterNavigation.resultOpen
      && result.probeResult.afterNavigation.featureHidden
      && result.probeResult.afterNavigation.featureText === '',
    'a stale rune reward response repainted the result after Home won navigation',
    result.probeResult?.afterNavigation);
  check(result.probeResult?.freshReward?.featureVisible
      && result.probeResult.freshReward.kicker === 'NEW RUNE'
      && result.probeResult.freshReward.title === 'FATE'
      && result.probeResult.freshReward.action === 'TRY IT'
      && result.probeResult.acknowledgeCalls === 1,
    'a current unseen reward did not reveal and acknowledge its TRY IT card exactly once',
    result.probeResult);
  check(result.errs.length === 0, 'page errors during the delayed rune reward transition', result.errs);
}
