async function waitAtMost(pending, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      pending.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForCount(read, minimum, milliseconds = 5000) {
  const deadline = Date.now() + milliseconds;
  while (read() < minimum && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return read() >= minimum;
}

async function probeExplicitGuestLifecycle(page, routes) {
  const requests = [];
  let resolveFirstJoin;
  let resolveReloadJoin;
  let afterReload = false;
  const firstJoin = new Promise((resolve) => { resolveFirstJoin = resolve; });
  const reloadJoin = new Promise((resolve) => { resolveReloadJoin = resolve; });
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/auth/v1/signup')) requests.push('anonymous-signup');
    if (!url.includes('/functions/v1/pvp-join')) return;
    requests.push(afterReload ? 'pvp-join-after-reload' : 'pvp-join');
    (afterReload ? resolveReloadJoin : resolveFirstJoin)();
  });

  const initial = await page.evaluate(() => {
    const auth = document.getElementById('onAuth');
    const guest = document.getElementById('btnAuthGuest');
    return {
      authShown: !!auth && !auth.hidden && !!auth.getClientRects().length,
      guestOffered: !!guest && !guest.hidden && !!guest.getClientRects().length,
      attached: localStorage.getItem('knucklebones.online.attached'),
      manualAuth: localStorage.getItem('knucklebones.online.manual-auth'),
    };
  });
  const signupRequest = page.waitForRequest(
    (request) => request.url().includes('/auth/v1/signup'),
    { timeout: 5000 },
  ).then(() => true, () => false);
  routes.deferNextSignupResponse();
  await page.click('#btnAuthGuest');
  await page.waitForSelector('#btnAskYes', { state: 'visible', timeout: 5000 });
  const confirmation = await page.evaluate(() => ({
    head: document.getElementById('askHead')?.textContent?.trim() ?? null,
    confirm: document.getElementById('btnAskYes')?.textContent?.trim() ?? null,
  }));
  await page.click('#btnAskYes');

  /* The broken implementation enters profile hydration without ever asking
     Supabase for a guest. Stop quickly in that state so the regression reports
     the missing request rather than timing out fifteen seconds later. */
  const signupStarted = await signupRequest;
  if (!signupStarted) {
    return {
      initial,
      confirmation,
      first: { signupStarted, signupCalls: routes.signupCalls(),
               joinCalls: routes.joinCalls(), requests: [...requests] },
      reload: null,
    };
  }

  await routes.signupRequestStarted;
  const busyBeforeDismiss = await page.evaluate(() => {
    const sheet = document.querySelector('.authsheet');
    return !!sheet && !!sheet.getClientRects().length
      && [...sheet.querySelectorAll('button')].every((button) => button.disabled);
  });
  /* A pending auth mutation cannot be allowed to outlive its visible owner:
     dismiss, reopen and submit again would let the last network response
     replace a newer session. Exercise both global doors while the first
     anonymous response is deliberately held. */
  await page.click('.authsheet', { position: { x: 2, y: 2 } });
  await page.waitForTimeout(40);
  const busyAfterBackdrop = await page.evaluate(() => {
    const sheet = document.querySelector('.authsheet');
    return !!sheet && !!sheet.getClientRects().length
      && [...sheet.querySelectorAll('button')].every((button) => button.disabled);
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(40);
  const busyAfterEscape = await page.evaluate(() => {
    const sheet = document.querySelector('.authsheet');
    return !!sheet && !!sheet.getClientRects().length
      && [...sheet.querySelectorAll('button')].every((button) => button.disabled);
  });
  routes.releaseSignupResponse();

  const firstJoined = await waitAtMost(firstJoin, 15_000);
  if (firstJoined) await waitForCount(routes.joinCalls, 1);
  const first = {
    signupStarted,
    busyLocked: busyBeforeDismiss && busyAfterBackdrop && busyAfterEscape,
    firstJoined,
    signupCalls: routes.signupCalls(),
    joinCalls: routes.joinCalls(),
    requests: [...requests],
  };
  if (!firstJoined) return { initial, confirmation, first, reload: null };

  await page.waitForSelector('#onQueue:not([hidden])', { timeout: 5000 });
  await page.click('#btnQueueCancel');
  await page.waitForSelector('#ovStart.on', { timeout: 5000 });
  const signupCallsBeforeReload = routes.signupCalls();
  const joinCallsBeforeReload = routes.joinCalls();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#btnOnline', { timeout: 15_000 });
  const home = await page.evaluate(() => {
    const chip = document.getElementById('homeChip');
    const auth = document.querySelector('.authsheet');
    return {
      chipAnonymous: chip?.classList.contains('anon') ?? null,
      authVisible: !!auth && !!auth.getClientRects().length
        && !auth.classList.contains('foout'),
    };
  });
  afterReload = true;
  await page.click('#btnOnline');
  const joined = await waitAtMost(reloadJoin, 15_000);
  if (joined) await waitForCount(routes.joinCalls, joinCallsBeforeReload + 1);
  const reload = {
    joined,
    home,
    signupCallsBeforeReload,
    signupCallsAfterReload: routes.signupCalls(),
    joinCallsBeforeReload,
    joinCallsAfterReload: routes.joinCalls(),
    requests: [...requests],
  };
  if (joined) {
    await page.waitForSelector('#onQueue:not([hidden])', { timeout: 5000 });
    await page.click('#btnQueueCancel');
  }
  return { initial, confirmation, first, reload };
}

async function probeRefusedExplicitGuest(page, routes) {
  const signupRequest = page.waitForRequest(
    (request) => request.url().includes('/auth/v1/signup'),
    { timeout: 5000 },
  ).then(() => true, () => false);
  await page.click('#btnAuthGuest');
  await page.waitForSelector('#btnAskYes', { state: 'visible', timeout: 5000 });
  await page.click('#btnAskYes');
  const signupStarted = await signupRequest;
  if (signupStarted) {
    await page.waitForFunction(() => {
      const auth = document.getElementById('onAuth');
      const error = document.getElementById('onAuthErr')?.textContent?.trim() ?? '';
      return !!auth && !auth.hidden && !!auth.getClientRects().length && !!error;
    }, null, { timeout: 5000 });
  }
  return page.evaluate(({ signupCalls, joinCalls, signupStarted }) => {
    const auth = document.getElementById('onAuth');
    return {
      signupStarted,
      signupCalls,
      joinCalls,
      authShown: !!auth && !auth.hidden && !!auth.getClientRects().length,
      error: document.getElementById('onAuthErr')?.textContent?.trim() ?? '',
      grabberEnabled: !(document.querySelector('.authsheet .fograb')?.disabled ?? true),
      ariaBusy: document.querySelector('.authsheet .focard')?.getAttribute('aria-busy') ?? null,
      attached: localStorage.getItem('knucklebones.online.attached'),
      manualAuth: localStorage.getItem('knucklebones.online.manual-auth'),
    };
  }, {
    signupStarted,
    signupCalls: routes.signupCalls(),
    joinCalls: routes.joinCalls(),
  });
}

export async function runExplicitGuestSessionScenarios(suite) {
  const { visit, out, check } = suite;
  /* The door is not the feature by itself. It must mint and persist a live
     anonymous session BEFORE matchmaking can start; otherwise the searching
     clock runs over a sessionless hydration that can never enqueue. The same
     browser storage is then reloaded to prove this guest survives an app
     restart instead of being minted a second time. */
  const explicitGuest = await visit({
    attached: true,
    door: 'auth-play',
    skipStandardProbes: true,
    initScript: () => localStorage.setItem('knucklebones.online.manual-auth', '1'),
    probe: probeExplicitGuestLifecycle,
  });
  out.explicitGuestLifecycle = explicitGuest.probeResult;
  const first = explicitGuest.probeResult?.first;
  const requestOrder = first?.requests ?? [];
  check(explicitGuest.probeResult?.initial.authShown
    && explicitGuest.probeResult.initial.guestOffered,
  'the signed-out device did not expose the explicit guest confirmation',
  explicitGuest.probeResult?.initial);
  check(first?.signupCalls === 1 && first.busyLocked === true && first.firstJoined === true
    && requestOrder.indexOf('anonymous-signup') >= 0
    && requestOrder.indexOf('anonymous-signup') < requestOrder.indexOf('pvp-join'),
  'START AS GUEST DID NOT CREATE A SESSION BEFORE MATCHMAKING', first);
  check(explicitGuest.probeResult?.reload?.joined === true
    && explicitGuest.probeResult.reload.home.chipAnonymous === false
    && explicitGuest.probeResult.reload.home.authVisible === false
    && explicitGuest.probeResult.reload.signupCallsBeforeReload === 1
    && explicitGuest.probeResult.reload.signupCallsAfterReload === 1
    && explicitGuest.probeResult.reload.joinCallsAfterReload
      > explicitGuest.probeResult.reload.joinCallsBeforeReload,
  'the explicit guest session was not reused for matchmaking after reload',
  explicitGuest.probeResult?.reload);
  check(explicitGuest.errs.length === 0,
    'page errors on the explicit guest lifecycle', explicitGuest.errs);

  const refusedGuest = await visit({
    anonymous: 422,
    attached: true,
    door: 'auth-play',
    skipStandardProbes: true,
    initScript: () => localStorage.setItem('knucklebones.online.manual-auth', '1'),
    probe: probeRefusedExplicitGuest,
  });
  out.explicitGuestRefused = refusedGuest.probeResult;
  check(refusedGuest.probeResult?.signupStarted === true
    && refusedGuest.probeResult.signupCalls === 1
    && refusedGuest.probeResult.joinCalls === 0
    && refusedGuest.probeResult.authShown === true
    && !!refusedGuest.probeResult.error
    && refusedGuest.probeResult.grabberEnabled === true
    && refusedGuest.probeResult.ariaBusy === null
    && refusedGuest.probeResult.attached === '1'
    && refusedGuest.probeResult.manualAuth === '1',
  'a refused guest signup escaped auth or forgot the returning account guard',
  refusedGuest.probeResult);
  check(refusedGuest.errs.length === 0,
    'page errors when explicit guest signup is refused', refusedGuest.errs);
}
