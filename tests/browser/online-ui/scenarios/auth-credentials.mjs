// WHAT SUBMITTED CREDENTIALS DO TO THE FLOW. Split from auth-modal.mjs, which
// keeps the sheet's own presentation — how it stacks, drags and dismisses. This
// file owns the four outcomes of pressing the primary action: a rejected
// password, the atomic hand-off to the owned loading view, a Back taken during
// that load, and the account-origin return to Profile.
//
// Entry reads the profile twice by design — once to hydrate (screens/ui.ts
// entered()) and once for the destination to paint (account-screen show()) —
// so any assertion about "how many reads" has to pin WHEN the tap lands
// relative to those. The probes below do that with the harness's own deferral
// seam rather than with a pause.

async function submitCredentials(page) {
  await page.fill('#onEmail', 'player@example.test');
  await page.fill('#onPass', 'unchanged-secret');
  await page.click('#onAuthActs .primary');
}

async function probeCredentialError(page, routes) {
  await submitCredentials(page);
  await page.waitForFunction(() => document.getElementById('onAuthErr')?.textContent?.trim());
  const state = await page.evaluate(() => ({
    sheetOpen: !!document.querySelector('.authsheet:not(.foout)'),
    email: document.getElementById('onEmail')?.value,
    password: document.getElementById('onPass')?.value,
    error: document.getElementById('onAuthErr')?.textContent?.trim(),
    buttonsEnabled: [...document.querySelectorAll('#onAuth button')]
      .filter((button) => !button.hidden)
      .every((button) => !button.disabled),
  }));
  return { ...state, passwordCalls: routes.passwordCalls() };
}

async function probeCredentialTransition(page, routes) {
  await submitCredentials(page);
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  await page.waitForSelector('#onLoading:not([hidden])');
  const transition = await page.evaluate(() => ({
    onlineOn: document.getElementById('ovOnline')?.classList.contains('on'),
    loadingVisible: document.getElementById('onLoading')?.hidden === false,
    authRestored: document.getElementById('onAuth')?.parentElement?.classList.contains('pbody'),
    authHidden: document.getElementById('onAuth')?.hidden,
    focused: document.activeElement?.id,
  }));

  /* Reopen auth while the successful run is still loading Profile. The old
     continuation must never target this newer sheet when it eventually
     finishes. A real tap cannot reach the still-hidden account button yet;
     invoking its bound action directly creates the exact ownership race. */
  await page.evaluate(() => document.getElementById('btnHaveAcc').click());
  await page.waitForSelector('.authsheet:not(.foout)');
  await page.waitForFunction(() => document.getElementById('onAccount')?.hidden === false,
    null, { timeout: 4000 }).catch(() => { /* the assertion below reports the state */ });
  const settled = await page.evaluate(() => ({
    secondSheetOpen: !!document.querySelector('.authsheet:not(.foout)'),
    accountVisible: document.getElementById('onAccount')?.hidden === false,
    onlineInert: document.getElementById('ovOnline')?.inert,
  }));
  return {
    transition,
    settled,
    passwordCalls: routes.passwordCalls(),
    profileCalls: routes.profileCalls(),
    tierProfileCalls: routes.tierProfileCalls(),
  };
}

async function probeCancelledTransition(page, routes) {
  /* HOLD THE ENTRY'S OWN PROFILE READ OPEN. Hydration and the destination's
     paint read the profile about 250ms apart, so a Back that merely arrives
     late finds the second read already dispatched and counts two — a footrace
     between the tap and the app's hydration, won or lost by how fast the
     machine is (delaying this tap by 400ms reproduces the ubuntu-latest
     detail exactly). Blocking the first response puts Back inside the loading
     window on every machine, so what follows measures the cancel. */
  routes.deferNextAccountProfileResponse();
  await submitCredentials(page);
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  await page.waitForSelector('#onLoading:not([hidden])');
  await routes.accountProfileStarted;
  await page.click('#btnOnlineBack');
  await page.waitForFunction(() => !document.getElementById('ovOnline')?.classList.contains('on'));
  /* A destination that survived the cancel paints from a second profile read.
     Watch for that read for as long as the release takes, rather than sampling
     a counter once the clock says it should be over. */
  const staleRead = page.waitForRequest(
    (request) => request.method() === 'GET'
      && request.url().includes('/rest/v1/profiles')
      && !request.url().includes('ranked_pool_tier'),
    { timeout: 4000 },
  ).then(() => true, () => false);
  routes.releaseAccountProfileResponse();
  await routes.accountProfileFinished;
  const staleDestinationRead = await staleRead;
  const state = await page.evaluate(() => ({
    homeOn: document.getElementById('ovStart')?.classList.contains('on'),
    onlineOn: document.getElementById('ovOnline')?.classList.contains('on'),
    visiblePanels: [...document.querySelectorAll('#ovOnline .panel')]
      .filter((panel) => !panel.hidden && panel.id !== 'onLoading')
      .map((panel) => panel.id),
  }));
  return {
    ...state,
    staleDestinationRead,
    profileCalls: routes.profileCalls(),
    tierProfileCalls: routes.tierProfileCalls(),
  };
}

async function probeAccountCredentialSuccess(page, routes) {
  await page.click('#btnHaveAcc');
  await submitCredentials(page);
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  await page.waitForSelector('#onAccount:not([hidden])');
  return page.evaluate((passwordCalls) => ({
    passwordCalls,
    onlineOn: document.getElementById('ovOnline')?.classList.contains('on'),
    accountVisible: document.getElementById('onAccount')?.hidden === false,
    queueVisible: document.getElementById('onQueue')?.hidden === false,
    title: document.getElementById('onTitle')?.textContent,
    focused: document.activeElement?.id,
  }), routes.passwordCalls());
}

export async function runAuthCredentialScenarios({ visit, out, check }) {
  const error = await visit({ anonymous: 422, passwordAuth: 'error', skipStandardProbes: true,
    probe: probeCredentialError });
  out.authCredentialError = error.probeResult;
  const e = error.probeResult;
  check(e?.passwordCalls === 1 && e.sheetOpen && e.error && e.buttonsEnabled
    && e.email === 'player@example.test' && e.password === 'unchanged-secret',
  'credential error dismissed, locked, or rebuilt the auth form', e);

  const transition = await visit({ anonymous: 422, passwordAuth: 'success', dataDelay: 700,
    skipStandardProbes: true, probe: probeCredentialTransition });
  out.authCredentialTransition = transition.probeResult;
  const c = transition.probeResult;
  check(c?.passwordCalls === 1 && c.transition.onlineOn && c.transition.loadingVisible
    && c.transition.authRestored && c.transition.authHidden && c.transition.focused === 'onTitle',
  'successful credentials did not atomically leave auth for the owned loading view', c);
  check(c?.profileCalls >= 2 && c.tierProfileCalls >= 2
    && c.settled.secondSheetOpen && c.settled.accountVisible
    && c.settled.onlineInert,
  'an older successful transition closed or displaced a newer auth sheet', c);

  const cancelled = await visit({ anonymous: 422, passwordAuth: 'success', dataDelay: 700,
    skipStandardProbes: true, probe: probeCancelledTransition });
  out.authCredentialCancelled = cancelled.probeResult;
  const x = cancelled.probeResult;
  check(x?.homeOn && !x.onlineOn && !x.staleDestinationRead
    && x.profileCalls === 1 && x.tierProfileCalls === 1
    && x.visiblePanels.length === 0,
    'Back during credential loading allowed the stale destination route to continue', x);

  const accountSuccess = await visit({ passwordAuth: 'success', skipStandardProbes: true,
    probe: probeAccountCredentialSuccess });
  out.authCredentialAccount = accountSuccess.probeResult;
  const p = accountSuccess.probeResult;
  check(p?.passwordCalls === 1 && p.onlineOn && p.accountVisible && !p.queueVisible
    && p.title === 'PROFILE' && p.focused === 'onTitle',
  'account-origin sign-in did not return to Profile', p);
}
