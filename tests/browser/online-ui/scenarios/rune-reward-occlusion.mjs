import { installProgressionRoutes } from './group-transition-harness.mjs';

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
  /* THE RANK PILL IS THE PROFILE'S DOOR on the result screen; the row itself
     opens the LADDER. Invoked directly rather than tapped because a late
     profile repaint can replace the plate between pointerdown and up. */
  await page.$eval('#endPlates > button:first-child .gpill', (pill) => pill.click());
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
  await Promise.race([
    routes.acknowledgeStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'Recovered Profile reward was not acknowledged after its sheet landed',
    )), 5000)),
  ]);
  const beforeContinue = {
    action: await page.$eval('.rune-reward-sheet__continue', (button) => button.textContent?.trim()),
    acknowledgements: routes.acknowledgeCalls(),
  };
  await page.click('.rune-reward-sheet__continue');
  await page.waitForSelector('.rune-reward-sheet', { state: 'detached', timeout: 15000 });
  return {
    whileCovered,
    acknowledgementsWhileCovered,
    beforeContinue,
    acknowledgementsAfterContinue: routes.acknowledgeCalls(),
    guidePresent: await page.locator('#accRuneGuide').count(),
  };
}

/** A first-rune collection read can finish while face-off covers the result.
 * The verified reward must wait in memory, revalidate on return, and then
 * finish its durable equipment tutorial rather than disappearing underneath. */
export async function firstRuneFaceoffOcclusionProbe(page, routes) {
  /* The unseen row belongs to fixture match 1111…; the result now on screen is
     a later duel, so recovery cannot depend on same-match attribution. */
  const resultMatchId = '22222222-2222-4222-8222-222222222222';
  routes.makeRuneUnseen('fate');
  routes.deferNextRuneResponse();
  await installProgressionRoutes(page, null);
  await page.evaluate((report) => {
    window.__kb.S.played = true;
    window.__kbResult(report);
  }, { ...REPORT, matchId: resultMatchId });
  await Promise.all([
    page.waitForSelector('#ovEnd.on', { timeout: 15000 }),
    Promise.race([
      routes.runeRequestStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        'the delayed first-rune collection request never started',
      )), 5000)),
    ]),
  ]);
  await page.waitForFunction(() => !document.getElementById('ovEnd')?.inert);
  await page.waitForSelector('#endPlates > button:nth-child(2)', { timeout: 15000 });
  await page.$eval('#endPlates > button:nth-child(2)', (button) => button.click());
  await page.waitForSelector('.faceoff:not(.rune-reward-sheet) .focard', { timeout: 15000 });
  routes.releaseRuneResponse();
  await Promise.race([
    routes.runeRequestFinished,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'the delayed first-rune collection request did not finish',
    )), 5000)),
  ]);
  await page.waitForTimeout(100);
  const whileCovered = {
    faceoffOpen: !!await page.$('.faceoff:not(.rune-reward-sheet) .focard'),
    rewardSheetOpen: !!await page.$('.rune-reward-sheet'),
    acknowledgements: routes.acknowledgeCalls(),
  };
  await page.click('.faceoff:not(.rune-reward-sheet) .fograb');
  await page.waitForSelector('.rune-reward-sheet .focard', { timeout: 15000 });
  const resumed = await page.evaluate(() => ({
    title: document.querySelector('.rune-reward-sheet__title')?.textContent?.trim(),
    action: document.querySelector('.rune-reward-sheet__continue')?.textContent?.trim(),
  }));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#onAccount:not([hidden]) #accRuneGuide', { timeout: 15000 });
  const resultInertDuringGuide = await page.$eval('#ovEnd', (element) => element.inert);
  const acknowledgementsBeforeSeat = routes.acknowledgeCalls();
  await page.click('#accSeat');
  await page.waitForSelector('.faceoff #accSeatEquip', { timeout: 15000 });
  await Promise.race([
    routes.acknowledgeStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'the resumed first rune was not acknowledged after the equipment seat',
    )), 5000)),
  ]);
  return {
    whileCovered,
    resumed,
    resultInertDuringGuide,
    acknowledgementsBeforeSeat,
    acknowledgementsAfterSeat: routes.acknowledgeCalls(),
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
  /* "Matchmaking has not started" is a JOIN count, not a hidden panel. Entry
     now paints the searching queue as its wait — the reward sheet covers it —
     so the panel says nothing about whether this player is in a queue. */
  const beforeContinue = await page.evaluate(() => ({
    rewardOwnsTheView: !!document.querySelector('.rune-reward-sheet .focard'),
    resultOpen: document.getElementById('ovEnd')?.classList.contains('on'),
    reward: document.querySelector('.rune-reward-sheet__title')?.textContent?.trim(),
  }));
  const joinsBeforeContinue = routes.joinCalls();
  const acknowledgementsBeforeContinue = routes.acknowledgeCalls();
  const action = await page.$eval(
    '.rune-reward-sheet__continue',
    (button) => button.textContent?.trim(),
  );
  await page.click('.rune-reward-sheet__continue');
  await page.waitForSelector('#onAccount:not([hidden]) #accRuneGuide', { timeout: 15000 });
  const acknowledgementsBeforeSeat = routes.acknowledgeCalls();
  await page.click('#accSeat');
  await page.waitForSelector('.faceoff #accSeatEquip', { timeout: 15000 });
  await Promise.race([
    routes.acknowledgeStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'Next Duel first-rune recovery did not acknowledge after the equipment seat',
    )), 5000)),
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
    joinsBeforeContinue,
    joinsAfterContinue: routes.joinCalls(),
    acknowledgementsBeforeContinue,
    acknowledgementsBeforeSeat,
    acknowledgementsAfterContinue: routes.acknowledgeCalls(),
    action,
    accountVisible: await page.$eval('#onAccount', (element) => !element.hidden),
    equipmentSheet: await page.locator('.faceoff #accSeatEquip').count(),
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
  check(result.probeResult?.beforeContinue?.rewardOwnsTheView
      && !result.probeResult.beforeContinue.resultOpen
      && result.probeResult.beforeContinue.reward === 'FATE'
      && result.probeResult.joinsBeforeContinue === 0
      && result.probeResult.joinsAfterContinue === 0
      && result.probeResult.acknowledgementsBeforeContinue === 0
      && result.probeResult.acknowledgementsBeforeSeat === 0
      && result.probeResult.acknowledgementsAfterContinue === 1
      && result.probeResult.action === 'Equip rune'
      && result.probeResult.accountVisible
      && result.probeResult.equipmentSheet === 1
      && result.probeResult.staleResultStayedClosed,
    'Next Duel skipped the delayed first-rune equipment tutorial',
    result.probeResult);
  check(result.errs.length === 0, 'page errors during Next Duel reward recovery', result.errs);
}
