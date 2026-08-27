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
  /* Entry now holds this wait in the searching queue rather than behind the
     shell die, so neither panel says whether matchmaking began. The join count
     does, and it is what "raced the ACK" actually means. */
  const pending = {
    ...await page.evaluate(() => ({
      loading: document.getElementById('onLoading')?.hidden === false,
      searching: document.getElementById('onQueue')?.hidden === false,
      duplicateReward: !!document.querySelector('.rune-reward-sheet'),
    })),
    joins: routes.joinCalls(),
  };
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
  const recovered = {
    ...await page.evaluate(() => ({
      title: document.querySelector('.rune-reward-sheet__title')?.textContent?.trim(),
    })),
    // the searching panel is the entry's wait; the join is what must not start
    joins: routes.joinCalls(),
  };
  routes.releaseAcknowledge();
  await bounded(routes.acknowledgeFinished, 'aborted ACK fixture did not release');
  await page.click('.rune-reward-sheet__continue');
  await page.waitForSelector('#onQueue:not([hidden])', { timeout: 15000 });
  return { recovered, acknowledgements: routes.acknowledgeCalls() };
}

async function failedAckRetryProbe(page, routes) {
  routes.makeRuneUnseen('fate');
  routes.failNextAcknowledge();
  const firstAck = routes.deferNextAcknowledge();
  await showWinningResult(page);
  await page.waitForSelector('#ovEnd.on #endFeature:not([hidden])', { timeout: 15000 });
  await bounded(firstAck.started, 'failed ACK1 never started');
  await page.$eval('#endPlates > button:nth-child(2)', (button) => button.click());
  await page.waitForSelector('.faceoff:not(.rune-reward-sheet) .focard', { timeout: 15000 });
  await page.click('.faceoff:not(.rune-reward-sheet) .fograb');
  await page.waitForSelector('#ovEnd.on #endFeature:not([hidden])', { timeout: 15000 });
  /* The cover canceled the watcher, so TRY IT takes the fallback branch while
     its original ACK is still the de-duplicated in-flight promise. */
  const secondAck = routes.deferNextAcknowledge();
  await page.click('#endFeature .endfeature-action');
  await page.waitForFunction(() => window.__kb.S.mode === 'cpu', null, { timeout: 15000 });
  await page.evaluate(async () => {
    const game = window.__kb;
    game.S.gen++;
    game.S.boards[1] = [[6, 6, 6], [6, 6, 6], [6, 6]];
    game.S.boards[0] = [[1], [1], [1]];
    game.S.turn = 1;
    game.S.bottom = 1;
    game.S.phase = 'choose';
    game.S.busy = false;
    game.S.die = 6;
    game.renderAll(false);
    game.applySides();
    game.setStageDie(6, 1);
    await game.place(1, 2);
  });
  await page.waitForSelector('#ovEnd.on', { timeout: 15000 });
  const readsBeforeReturn = routes.runeCalls();
  await page.click('#btnAgain');
  await page.waitForTimeout(100);
  const readsWhileFirstHeld = routes.runeCalls();
  firstAck.release();
  await bounded(firstAck.finished, 'failed ACK1 fixture did not finish');
  await bounded(secondAck.started, 'explicit TRY IT did not start ACK2');
  await page.waitForTimeout(100);
  const readsWhileRetryHeld = routes.runeCalls();
  secondAck.release();
  await bounded(secondAck.finished, 'held ACK2 fixture did not finish');
  const deadline = Date.now() + 7000;
  while (routes.runeCalls() === readsBeforeReturn && Date.now() < deadline) {
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(100);
  return {
    readsBeforeReturn,
    readsWhileFirstHeld,
    readsWhileRetryHeld,
    readsAfterRetry: routes.runeCalls(),
    acknowledgements: routes.acknowledgeCalls(),
    rewardVisible: await page.$eval('#endFeature', (feature) => !feature.hidden),
    rewardSheetOpen: !!await page.$('.rune-reward-sheet'),
  };
}

async function verifiedEmptyProbe(page, routes) {
  return {
    accountVisible: await page.$eval('#onAccount', (panel) => !panel.hidden),
    rewardOpen: !!await page.$('.rune-reward-sheet'),
    acknowledgements: routes.acknowledgeCalls(),
    runeReads: routes.runeCalls(),
  };
}

async function accountSwitchAfterRuneProbe(page, routes) {
  const accountB = '11111111-2222-4333-8444-555555555555';
  routes.makeRuneUnseen('fate');
  await showWinningResult(page);
  await page.waitForSelector('#ovEnd.on #endFeature:not([hidden])', { timeout: 15000 });
  routes.deferNextAccountProfileResponse();
  const readsBeforeProfile = routes.runeCalls();
  await page.$eval('#endPlates > button:first-child', (button) => button.click());
  await bounded(routes.accountProfileStarted, 'held A profile read never started');
  const deadline = Date.now() + 7000;
  while (routes.runeCalls() === readsBeforeProfile && Date.now() < deadline) {
    await page.waitForTimeout(25);
  }
  const switched = await page.evaluate((nextAccountId) => {
    const key = Object.keys(localStorage)
      .find((candidate) => candidate.startsWith('sb-') && candidate.endsWith('-auth-token'));
    if (!key) return false;
    const stored = JSON.parse(localStorage.getItem(key));
    const session = stored?.currentSession ?? stored;
    if (!session?.user) return false;
    session.user.id = nextAccountId;
    localStorage.setItem(key, JSON.stringify(stored));
    return true;
  }, accountB);
  routes.releaseAccountProfileResponse();
  await bounded(routes.accountProfileFinished, 'held A profile read did not finish');
  await page.waitForTimeout(300);
  return page.evaluate(({ didSwitch, accountA }) => {
    const cache = JSON.parse(localStorage.getItem('knucklebones.runes.v1') ?? 'null');
    return {
      switched: didSwitch,
      accountVisible: document.getElementById('onAccount')?.hidden === false,
      loadingVisible: document.getElementById('onLoading')?.hidden === false,
      name: document.getElementById('accName')?.textContent?.trim(),
      cachedAccount: cache?.accountId ?? null,
      staleCache: cache?.accountId === accountA.toLowerCase(),
      rewardSheetOpen: !!document.querySelector('.rune-reward-sheet'),
    };
  }, { didSwitch: switched, accountA: '00000000-0000-4000-8000-00000000beef' });
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
  check(inFlight.probeResult?.pending?.searching && !inFlight.probeResult.pending.loading
      && inFlight.probeResult.pending.joins === 0
      && !inFlight.probeResult.pending.duplicateReward
      && inFlight.probeResult.readsBeforeNext === inFlight.probeResult.readsWhileAckPending
      && inFlight.probeResult.acknowledgements === 1
      && inFlight.probeResult.settled?.queueVisible,
    'Next Duel raced an in-flight reward ACK and re-presented it', inFlight.probeResult);

  const hung = await visit({ named: true, runes: ['fate'], skipStandardProbes: true,
    probe: hungAckProbe });
  out.runeRewardHungAck = hung.probeResult;
  check(hung.probeResult?.recovered?.title === 'FATE'
      && hung.probeResult.recovered.joins === 0 && hung.probeResult.acknowledgements === 2,
    'a hung reward ACK froze navigation or lost durable recovery', hung.probeResult);

  const retry = await visit({ named: true, runes: ['fate'], skipStandardProbes: true,
    probe: failedAckRetryProbe });
  out.runeRewardFailedAckRetry = retry.probeResult;
  check(retry.probeResult?.readsBeforeReturn === retry.probeResult.readsWhileFirstHeld
      && retry.probeResult.readsBeforeReturn === retry.probeResult.readsWhileRetryHeld
      && retry.probeResult.readsAfterRetry > retry.probeResult.readsBeforeReturn
      && retry.probeResult.acknowledgements === 2
      && !retry.probeResult.rewardVisible && !retry.probeResult.rewardSheetOpen,
    'return refresh read between failed ACK1 and held ACK2', retry.probeResult);

  const empty = await visit({ named: true, runes: ['fate'], unseenRunes: ['fate'],
    markRunesSeenAfterFirstRead: true, skipStandardProbes: true, probe: verifiedEmptyProbe });
  out.runeRewardFreshEmpty = empty.probeResult;
  check(empty.probeResult?.accountVisible && !empty.probeResult.rewardOpen
      && empty.probeResult.acknowledgements === 0 && empty.probeResult.runeReads >= 2,
    'an older unseen entry read overrode a newer verified-empty Profile read', empty.probeResult);

  const switched = await visit({ named: true, runes: ['fate'], skipStandardProbes: true,
    probe: accountSwitchAfterRuneProbe });
  out.runeRewardAccountSwitch = switched.probeResult;
  check(switched.probeResult?.switched && !switched.probeResult.accountVisible
      && switched.probeResult.loadingVisible && !switched.probeResult.name
      && !switched.probeResult.staleCache && !switched.probeResult.rewardSheetOpen,
    'account A runes/profile painted after the active session changed to B', switched.probeResult);

  const exit = await visit({ named: true, runes: ['fate'], skipStandardProbes: true,
    probe: profileExitProbe });
  out.runeRewardProfileExit = exit.probeResult;
  check(exit.probeResult?.homeVisible && !exit.probeResult.onlineVisible,
    'Profile return left Next Duel with a stale online exit handler', exit.probeResult);

  for (const [name, run] of Object.entries({ resume, inFlight, hung, retry, empty, switched, exit })) {
    check(run.errs.length === 0, `page errors during ${name} reward-race coverage`, run.errs);
  }
}
