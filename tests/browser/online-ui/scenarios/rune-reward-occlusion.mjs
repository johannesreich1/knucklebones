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

export async function resultRewardProfileOcclusionProbe(page, routes) {
  routes.makeRuneUnseen('fate');
  await page.evaluate((report) => {
    window.__kb.S.played = true;
    window.__kbResult(report);
  }, REPORT);
  await page.waitForSelector('#ovEnd.on #endFeature:not([hidden])', { timeout: 15000 });

  /* Hold Profile's own collection read. That leaves no second reward surface
     which could legitimately acknowledge while we prove the result card is
     covered and must stay unseen. */
  routes.deferNextRuneResponse();
  /* Invoke immediately on the currently dealt plate: its late profile repaint
     can replace the button between pointerdown/up, which is unrelated to the
     reward-navigation race this probe owns. */
  await page.$eval('#endPlates > button:first-child', (button) => button.click());
  await Promise.all([
    page.waitForSelector('#ovOnline.on #onLoading:not([hidden])', { timeout: 15000 }),
    Promise.race([
      routes.runeRequestStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        'Profile did not start its held rune collection refresh',
      )), 5000)),
    ]),
  ]);
  await page.waitForTimeout(2200);
  const whileCovered = await page.evaluate(() => {
    const feature = document.getElementById('endFeature');
    const rect = feature.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      onlineVisible: document.getElementById('ovOnline')?.classList.contains('on'),
      profileLoading: document.getElementById('onLoading')?.hidden === false,
      resultStillMounted: document.getElementById('ovEnd')?.classList.contains('on'),
      rewardOwnsHit: !!hit && feature.contains(hit),
    };
  });
  const acknowledgementsWhileCovered = routes.acknowledgeCalls();

  routes.releaseRuneResponse();
  await Promise.race([
    routes.runeRequestFinished,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'Profile rune collection refresh did not finish',
    )), 5000)),
  ]);
  await page.waitForSelector('.rune-reward-sheet .focard', { timeout: 15000 });
  await page.click('.rune-reward-sheet__continue');
  await Promise.race([
    routes.acknowledgeStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'Recovered Profile reward was not acknowledged by Continue',
    )), 5000)),
  ]);
  return {
    whileCovered,
    acknowledgementsWhileCovered,
    acknowledgementsAfterContinue: routes.acknowledgeCalls(),
  };
}

export async function resultRewardFaceoffOcclusionProbe(page, routes) {
  routes.makeRuneUnseen('fate');
  await page.evaluate((report) => window.__kbResult(report), REPORT);
  await page.waitForSelector('#ovEnd.on #endFeature:not([hidden])', { timeout: 15000 });
  await page.waitForSelector('#endPlates > button:nth-child(2)', { timeout: 15000 });
  await page.$eval('#endPlates > button:nth-child(2)', (button) => button.click());
  await page.waitForSelector('.faceoff:not(.rune-reward-sheet) .focard', { timeout: 15000 });
  await page.waitForTimeout(2200);
  const whileCovered = await page.evaluate(() => {
    const feature = document.getElementById('endFeature');
    const rect = feature.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      faceoffOpen: !!document.querySelector('.faceoff:not(.rune-reward-sheet) .focard'),
      rewardOwnsHit: !!hit && feature.contains(hit),
    };
  });
  const acknowledgementsWhileCovered = routes.acknowledgeCalls();

  await page.click('.faceoff:not(.rune-reward-sheet) .fograb');
  await page.waitForSelector('.faceoff:not(.rune-reward-sheet)', { state: 'detached', timeout: 15000 });
  await Promise.race([
    routes.acknowledgeStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'Result reward did not resume acknowledgement after face-off closed',
    )), 5000)),
  ]);
  return {
    whileCovered,
    acknowledgementsWhileCovered,
    acknowledgementsAfterClose: routes.acknowledgeCalls(),
  };
}

async function nextDuelRewardProbe(page, routes) {
  routes.makeRuneUnseen('fate');
  routes.deferNextRuneResponse();
  await page.evaluate((report) => {
    window.__kb.S.played = true;
    window.__kbResult(report);
  }, REPORT);
  await Promise.all([
    page.waitForSelector('#ovEnd.on', { timeout: 15000 }),
    Promise.race([
      routes.runeRequestStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        'Delayed result collection request never started before Next Duel',
      )), 5000)),
    ]),
  ]);
  await page.click('#btnAgain');
  await page.waitForSelector('.rune-reward-sheet .focard', { timeout: 15000 });
  const beforeContinue = await page.evaluate(() => ({
    queueHidden: document.getElementById('onQueue')?.hidden,
    resultOpen: document.getElementById('ovEnd')?.classList.contains('on'),
    reward: document.querySelector('.rune-reward-sheet__title')?.textContent?.trim(),
  }));
  const acknowledgementsBeforeContinue = routes.acknowledgeCalls();
  await page.click('.rune-reward-sheet__continue');
  await Promise.all([
    page.waitForSelector('#onQueue:not([hidden])', { timeout: 15000 }),
    Promise.race([
      routes.acknowledgeStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        'Next Duel reward Continue did not acknowledge before queueing',
      )), 5000)),
    ]),
  ]);
  routes.releaseRuneResponse();
  await Promise.race([
    routes.runeRequestFinished,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'Stale result collection request did not finish after release',
    )), 5000)),
  ]);
  await page.waitForTimeout(100);
  return {
    beforeContinue,
    acknowledgementsBeforeContinue,
    acknowledgementsAfterContinue: routes.acknowledgeCalls(),
    queueVisible: await page.$eval('#onQueue', (element) => !element.hidden),
    staleResultStayedClosed: await page.$eval('#ovEnd', (element) => !element.classList.contains('on')),
  };
}

export async function runNextDuelRewardScenario({ visit, out, check }) {
  const result = await visit({
    named: true,
    runes: ['fate'],
    skipStandardProbes: true,
    probe: nextDuelRewardProbe,
  });
  out.runeRewardNextDuel = result.probeResult;
  check(result.probeResult?.beforeContinue?.queueHidden
      && !result.probeResult.beforeContinue.resultOpen
      && result.probeResult.beforeContinue.reward === 'FATE'
      && result.probeResult.acknowledgementsBeforeContinue === 0
      && result.probeResult.acknowledgementsAfterContinue === 1
      && result.probeResult.queueVisible
      && result.probeResult.staleResultStayedClosed,
    'Next Duel started matchmaking before recovering its delayed rune reward',
    result.probeResult);
  check(result.errs.length === 0, 'page errors during Next Duel reward recovery', result.errs);
}
