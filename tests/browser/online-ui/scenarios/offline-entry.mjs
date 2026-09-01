/* A MOMENTARY CONNECTION LOSS IS NOT A LOGOUT.
 *
 * The player report was concrete: after a successful ranked duel, tapping
 * Next duel while briefly offline eventually exposed Sign in; restarting the
 * app brought the profile straight back. These probes take a real guest entry
 * far enough to persist its Supabase session, switch only the DEVICE'S
 * `navigator.onLine` signal, and try both ranked doors the player named:
 * Home -> Online and result -> Next duel.
 *
 * The visible contract is the regression. Both doors must stop on the shared
 * offline sheet, keep Auth out of sight, leave the queue clock stopped, and
 * reuse the same stored session when Retry succeeds. */

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

const installConnectionSignal = () => {
  globalThis.__kbConnectionOnline = true;
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => globalThis.__kbConnectionOnline,
  });
};

async function waitForOfflineOutcome(page) {
  await page.waitForFunction(() => {
    const online = document.getElementById('ovOnline');
    return document.getElementById('ovAsk')?.classList.contains('on')
      || document.querySelector('.authsheet')?.classList.contains('on')
      || (!!online?.classList.contains('on')
        && !document.getElementById('onQueue')?.hidden);
  }, null, { timeout: 7000 }).catch(() => undefined);
  await page.waitForTimeout(80);
}

const readOutcome = (page, routes) => page.evaluate((signupCalls) => {
  const ask = document.getElementById('ovAsk');
  const online = document.getElementById('ovOnline');
  const askVisible = !!ask?.classList.contains('on');
  const dialog = ask?.querySelector('[role="dialog"]');
  const rect = dialog?.getBoundingClientRect();
  const hit = rect
    ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    : null;
  return {
    askVisible,
    painted: !!rect && rect.width > 0 && rect.height > 0
      && Number(getComputedStyle(dialog).opacity) > 0,
    centreHit: !!hit && !!ask?.contains(hit),
    modal: dialog?.getAttribute('aria-modal') ?? null,
    title: askVisible ? document.getElementById('askHead')?.textContent?.trim() : null,
    body: askVisible ? document.getElementById('askBody')?.textContent?.trim() : null,
    retry: askVisible ? document.getElementById('btnAskYes')?.textContent?.trim() : null,
    close: askVisible ? document.getElementById('btnAskNo')?.textContent?.trim() : null,
    authVisible: document.querySelector('.authsheet')?.classList.contains('on') ?? false,
    queueVisible: !!online?.classList.contains('on')
      && document.getElementById('onQueue')?.hidden === false,
    queueTime: document.getElementById('qTime')?.textContent ?? null,
    homeOn: document.getElementById('ovStart')?.classList.contains('on') ?? false,
    signupCalls,
  };
}, routes.signupCalls());

async function retryOnline(page) {
  await page.evaluate(() => { globalThis.__kbConnectionOnline = true; });
  if (await page.locator('#ovAsk.on').count()) await page.click('#btnAskYes');
  await page.waitForSelector('#ovOnline.on #onQueue:not([hidden])', { timeout: 7000 })
    .catch(() => undefined);
  await page.waitForTimeout(150);
}

async function cancelQueue(page, routes, stage) {
  const blocker = await page.evaluate(() => {
    const ask = document.getElementById('ovAsk');
    return ask?.classList.contains('on') ? {
      title: document.getElementById('askHead')?.textContent?.trim() ?? '',
      body: document.getElementById('askBody')?.textContent?.trim() ?? '',
    } : null;
  });
  if (blocker) throw new Error(`unexpected connection sheet before ${stage}: ${JSON.stringify({
    blocker,
    joinCalls: routes.joinCalls(),
    signupCalls: routes.signupCalls(),
    gameCenterModes: routes.gameCenterModes(),
    identity: routes.identityState(),
  })}`);
  await page.click('#btnQueueCancel');
}

async function offlineDoorsProbe(page, routes) {
  const initialSignupCalls = routes.signupCalls();

  await cancelQueue(page, routes, 'Home offline entry');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  await page.evaluate(() => { globalThis.__kbConnectionOnline = false; });
  await page.click('#btnOnline');
  await waitForOfflineOutcome(page);
  const homeEntry = await readOutcome(page, routes);
  await retryOnline(page);
  const homeRetry = {
    queueVisible: await page.locator('#ovOnline.on #onQueue:not([hidden])').count() === 1,
    signupCalls: routes.signupCalls(),
  };

  await cancelQueue(page, routes, 'Next duel offline entry');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  await page.evaluate((report) => {
    document.getElementById('ovStart').classList.remove('on');
    window.__kbResult(report);
  }, REPORT);
  await page.waitForSelector('#ovEnd.on', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#endPlates button').length === 2);
  await page.waitForTimeout(250);
  await page.evaluate(() => { globalThis.__kbConnectionOnline = false; });
  await page.click('#btnAgain');
  await waitForOfflineOutcome(page);
  const nextDuel = await readOutcome(page, routes);
  await retryOnline(page);
  const nextRetry = {
    queueVisible: await page.locator('#ovOnline.on #onQueue:not([hidden])').count() === 1,
    signupCalls: routes.signupCalls(),
  };

  await cancelQueue(page, routes, 'identity transport failure');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  routes.setIdentityStatusUnavailable(true);
  await page.click('#btnOnline');
  await waitForOfflineOutcome(page);
  const transientFailure = await readOutcome(page, routes);
  routes.setIdentityStatusUnavailable(false);
  if (transientFailure.askVisible) {
    await page.click('#btnAskYes');
  } else if (transientFailure.authVisible) {
    /* Keep the red-state probe able to finish the harness: dismiss the wrong
       login sheet, then retry through the ordinary door after its one-shot
       failure has been consumed. */
    await page.keyboard.press('Escape');
    await page.waitForSelector('#ovStart.on', { timeout: 15000 });
    await page.waitForSelector('.authsheet', { state: 'detached', timeout: 15000 });
    await page.click('#btnOnline');
  }
  await page.waitForSelector('#ovOnline.on #onQueue:not([hidden])', { timeout: 7000 })
    .catch(() => undefined);
  const transientRetry = {
    queueVisible: await page.locator('#ovOnline.on #onQueue:not([hidden])').count() === 1,
    signupCalls: routes.signupCalls(),
  };

  const joinsBeforeFailure = routes.joinCalls();
  routes.setJoinUnavailable(true);
  const joinDeadline = Date.now() + 7000;
  while (routes.joinCalls() === joinsBeforeFailure && Date.now() < joinDeadline) {
    await page.waitForTimeout(50);
  }
  await waitForOfflineOutcome(page);
  const queueFailure = {
    ...await readOutcome(page, routes),
    joinsBeforeFailure,
    joinsAfterFailure: routes.joinCalls(),
  };
  routes.setJoinUnavailable(false);
  if (queueFailure.askVisible) await page.click('#btnAskYes');
  await page.waitForSelector('#ovOnline.on #onQueue:not([hidden])', { timeout: 7000 })
    .catch(() => undefined);
  const queueRetry = {
    queueVisible: await page.locator('#ovOnline.on #onQueue:not([hidden])').count() === 1,
    signupCalls: routes.signupCalls(),
  };

  return {
    initialSignupCalls,
    homeEntry,
    homeRetry,
    nextDuel,
    nextRetry,
    transientFailure,
    transientRetry,
    queueFailure,
    queueRetry,
  };
}

function isOfflineSheet(state, expectedSignupCalls) {
  return state?.askVisible === true
    && state.title === 'YOU\u2019RE OFFLINE'
    && state.body === 'Online play needs an internet connection. Check your connection, then try again.'
    && state.retry === 'Try again'
    && state.close === 'Close'
    && state.painted === true
    && state.centreHit === true
    && state.modal === 'true'
    && state.authVisible === false
    && state.queueVisible === false
    && state.homeOn === true
    && state.signupCalls === expectedSignupCalls;
}

function isConnectionSheet(state, expectedSignupCalls) {
  return state?.askVisible === true
    && state.title === 'CAN\u2019T CONNECT'
    && state.body === 'Online play is unavailable right now. Check your connection, then try again.'
    && state.retry === 'Try again'
    && state.close === 'Close'
    && state.painted === true
    && state.centreHit === true
    && state.modal === 'true'
    && state.authVisible === false
    && state.queueVisible === false
    && state.homeOn === true
    && state.signupCalls === expectedSignupCalls;
}

export async function runOfflineEntryScenarios(suite) {
  const { visit, out, check } = suite;
  const offline = await visit({
    door: 'play',
    gameCenterBridge: 'linked',
    identity: { gameCenterLinked: false, appleLinked: false, appleRevocationReady: false },
    initScript: installConnectionSignal,
    probe: offlineDoorsProbe,
    returnAfterProbe: true,
  });
  out.offlineEntry = offline.probeResult;
  const result = offline.probeResult;

  check(isOfflineSheet(result?.homeEntry, result?.initialSignupCalls),
    'HOME -> ONLINE treated a brief offline signal as a logout instead of showing the offline sheet',
    result?.homeEntry);
  check(result?.homeRetry?.queueVisible === true
    && result.homeRetry.signupCalls === result.initialSignupCalls,
  'Retry after Home -> Online did not reuse the stored session', result?.homeRetry);
  check(isOfflineSheet(result?.nextDuel, result?.initialSignupCalls),
    'NEXT DUEL treated a brief offline signal as a logout or kept its matchmaking clock running',
    result?.nextDuel);
  check(result?.nextRetry?.queueVisible === true
    && result.nextRetry.signupCalls === result.initialSignupCalls,
  'Retry after Next duel did not reuse the stored session', result?.nextRetry);
  check(isConnectionSheet(result?.transientFailure, result?.initialSignupCalls),
    'a temporary identity request failure was presented as signed out instead of unable to connect',
    result?.transientFailure);
  check(result?.transientRetry?.queueVisible === true
    && result.transientRetry.signupCalls === result.initialSignupCalls,
  'Retry after a temporary identity request failure did not reuse the stored session',
  result?.transientRetry);
  check(isConnectionSheet(result?.queueFailure, result?.initialSignupCalls)
    && result.queueFailure.joinsAfterFailure > result.queueFailure.joinsBeforeFailure,
  'a failed matchmaking request kept the searching clock running instead of showing a connection sheet',
  result?.queueFailure);
  check(result?.queueRetry?.queueVisible === true
    && result.queueRetry.signupCalls === result.initialSignupCalls,
  'Retry after a matchmaking connection failure did not reuse the stored session',
  result?.queueRetry);
  check(offline.errs.length === 0, 'page errors during offline ranked entry', offline.errs);
}
