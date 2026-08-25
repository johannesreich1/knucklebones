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

const bounded = (promise, message, timeout = 7000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeout)),
]);

const showWinningResult = (page) => page.evaluate((report) => {
  window.__kb.S.played = true;
  window.__kbResult(report);
}, REPORT);

async function resumeTryProbe(page, routes) {
  routes.makeRuneUnseen('fate');
  await showWinningResult(page);
  await page.waitForSelector('#ovEnd.on #endFeature:not([hidden])', { timeout: 15000 });
  await page.waitForSelector('#endPlates > button:nth-child(2)', { timeout: 15000 });
  routes.deferNextRuneResponse();
  await page.$eval('#endPlates > button:nth-child(2)', (button) => button.click());
  await page.waitForSelector('.faceoff:not(.rune-reward-sheet) .focard', { timeout: 15000 });
  const acknowledgementsWhileCovered = routes.acknowledgeCalls();
  await page.click('.faceoff:not(.rune-reward-sheet) .fograb');
  await bounded(routes.runeRequestStarted, 'result resume did not refresh its reward');
  const beforeTry = await page.evaluate(() => {
    const action = document.querySelector('#endFeature .endfeature-action');
    const rect = action?.getBoundingClientRect();
    const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2,
      rect.top + rect.height / 2) : null;
    return { action: action?.textContent, hit: hit?.className, mode: window.__kb.S.mode };
  });
  await page.click('#endFeature .endfeature-action');
  await page.waitForTimeout(500);
  const afterTry = await page.evaluate(() => ({
    mode: window.__kb.S.mode,
    charges: window.__kb.S.spellCharges.map((hand) => hand.fate ?? 0),
  }));
  routes.releaseRuneResponse();
  await bounded(routes.runeRequestFinished, 'held result-resume refresh did not finish');
  await bounded(routes.acknowledgeStarted, 'immediate TRY IT did not acknowledge the reward');
  return {
    acknowledgementsWhileCovered,
    acknowledgementsAfterTry: routes.acknowledgeCalls(),
    beforeTry,
    afterTry,
  };
}

async function inFlightAckProbe(page, routes) {
  routes.makeRuneUnseen('fate');
  routes.deferNextAcknowledge();
  await showWinningResult(page);
  await page.waitForSelector('#ovEnd.on #endFeature:not([hidden])', { timeout: 15000 });
  await bounded(routes.acknowledgeStarted, 'visible result reward never began its ACK');
  const readsBeforeNext = routes.runeCalls();
  await page.click('#btnAgain');
  await page.waitForTimeout(250);
  const pending = await page.evaluate(() => ({
    loading: document.getElementById('onLoading')?.hidden === false,
    queueHidden: document.getElementById('onQueue')?.hidden,
    duplicateReward: !!document.querySelector('.rune-reward-sheet'),
  }));
  const readsWhileAckPending = routes.runeCalls();
  routes.releaseAcknowledge();
  await bounded(routes.acknowledgeFinished, 'held reward ACK did not finish');
  await page.waitForTimeout(1000);
  const settled = await page.evaluate(() => ({
    queueVisible: document.getElementById('onQueue')?.hidden === false,
    loadingVisible: document.getElementById('onLoading')?.hidden === false,
    reward: document.querySelector('.rune-reward-sheet__title')?.textContent?.trim(),
    tutorial: document.getElementById('ovFirst')?.classList.contains('on'),
    played: window.__kb.S.played,
  }));
  return {
    pending,
    readsBeforeNext,
    readsWhileAckPending,
    acknowledgements: routes.acknowledgeCalls(),
    settled,
  };
}

async function hungAckProbe(page, routes) {
  routes.makeRuneUnseen('fate');
  routes.deferNextAcknowledge();
  await showWinningResult(page);
  await page.waitForSelector('#ovEnd.on #endFeature:not([hidden])', { timeout: 15000 });
  await bounded(routes.acknowledgeStarted, 'hung reward ACK never began');
  await page.click('#btnAgain');
  await page.waitForSelector('.rune-reward-sheet .focard', { timeout: 8000 });
  const recovered = await page.evaluate(() => ({
    title: document.querySelector('.rune-reward-sheet__title')?.textContent?.trim(),
    queueHidden: document.getElementById('onQueue')?.hidden,
  }));
  routes.releaseAcknowledge();
  await bounded(routes.acknowledgeFinished, 'aborted ACK fixture did not release');
  await page.click('.rune-reward-sheet__continue');
  await page.waitForSelector('#onQueue:not([hidden])', { timeout: 15000 });
  return { recovered, acknowledgements: routes.acknowledgeCalls() };
}

async function verifiedEmptyProbe(page, routes) {
  return {
    accountVisible: await page.$eval('#onAccount', (panel) => !panel.hidden),
    rewardOpen: !!await page.$('.rune-reward-sheet'),
    acknowledgements: routes.acknowledgeCalls(),
    runeReads: routes.runeCalls(),
  };
}

async function profileExitProbe(page) {
  await showWinningResult(page);
  await page.waitForSelector('#ovEnd.on #endPlates > button:first-child', { timeout: 15000 });
  await page.$eval('#endPlates > button:first-child', (button) => button.click());
  await page.waitForSelector('#ovOnline.on #onAccount:not([hidden])', { timeout: 15000 });
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovEnd.on', { timeout: 15000 });
  await page.click('#btnAgain');
  await page.waitForSelector('#onQueue:not([hidden])', { timeout: 15000 });
  await page.$eval('#btnOnlineBack', (button) => button.click());
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  return {
    homeVisible: await page.$eval('#ovStart', (panel) => panel.classList.contains('on')),
    onlineVisible: await page.$eval('#ovOnline', (panel) => panel.classList.contains('on')),
  };
}

export async function runRuneRewardRaceScenarios({ visit, out, check }) {
  const resume = await visit({ named: true, runes: ['fate'], skipStandardProbes: true,
    probe: resumeTryProbe });
  out.runeRewardImmediateTry = resume.probeResult;
  check(resume.probeResult?.acknowledgementsWhileCovered === 0
      && resume.probeResult.acknowledgementsAfterTry === 1
      && resume.probeResult.afterTry?.mode === 'cpu'
      && resume.probeResult.afterTry.charges.every((charge) => charge === 2),
    'TRY IT during reward resume refresh left the durable row unseen', resume.probeResult);

  const inFlight = await visit({ named: true, runes: ['fate'], skipStandardProbes: true,
    probe: inFlightAckProbe });
  out.runeRewardInFlightAck = inFlight.probeResult;
  check(inFlight.probeResult?.pending?.loading && inFlight.probeResult.pending.queueHidden
      && !inFlight.probeResult.pending.duplicateReward
      && inFlight.probeResult.readsBeforeNext === inFlight.probeResult.readsWhileAckPending
      && inFlight.probeResult.acknowledgements === 1
      && inFlight.probeResult.settled?.queueVisible,
    'Next Duel raced an in-flight reward ACK and re-presented it', inFlight.probeResult);

  const hung = await visit({ named: true, runes: ['fate'], skipStandardProbes: true,
    probe: hungAckProbe });
  out.runeRewardHungAck = hung.probeResult;
  check(hung.probeResult?.recovered?.title === 'FATE'
      && hung.probeResult.recovered.queueHidden && hung.probeResult.acknowledgements === 2,
    'a hung reward ACK froze navigation or lost durable recovery', hung.probeResult);

  const empty = await visit({ named: true, runes: ['fate'], unseenRunes: ['fate'],
    markRunesSeenAfterFirstRead: true, skipStandardProbes: true, probe: verifiedEmptyProbe });
  out.runeRewardFreshEmpty = empty.probeResult;
  check(empty.probeResult?.accountVisible && !empty.probeResult.rewardOpen
      && empty.probeResult.acknowledgements === 0 && empty.probeResult.runeReads >= 2,
    'an older unseen entry read overrode a newer verified-empty Profile read', empty.probeResult);

  const exit = await visit({ named: true, runes: ['fate'], skipStandardProbes: true,
    probe: profileExitProbe });
  out.runeRewardProfileExit = exit.probeResult;
  check(exit.probeResult?.homeVisible && !exit.probeResult.onlineVisible,
    'Profile return left Next Duel with a stale online exit handler', exit.probeResult);

  for (const run of [resume, inFlight, hung, empty, exit]) {
    check(run.errs.length === 0, 'page errors during rune reward race coverage', run.errs);
  }
}
