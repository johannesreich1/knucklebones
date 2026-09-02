// WHAT SUBMITTED CREDENTIALS DO TO THE FLOW. Split from auth-modal.mjs, which
// keeps the sheet's own presentation — how it stacks, drags and dismisses. This
// file owns the four outcomes of pressing the primary action: a rejected
// password, the atomic hand-off to the owned loading view, a Back taken during
// that load, and the account-origin return to Profile.
//
// Entry reads the pool tier twice by design — once to discover rewards
// (entry-hydration.ts) and once for Profile to confirm them (account-screen
// show()) — but the profile ROW only once: Profile owns that read, so
// hydration skips it for the account view (hydrateOnlineEntry's refreshProfile
// is false there). Any assertion about "how many reads" has to pin WHEN the
// tap lands relative to those. The probes below do that with the harness's
// own deferral seam rather than with a pause.
import {
  probeAppleAskReplacement,
  probeAppleExplicitCancellation,
  probeAppleRestoreSuccess,
} from './auth-apple-probes.mjs';
import { waitForOverlayTransitions } from '../../support/overlay-transitions.mjs';

async function submitCredentials(page) {
  await page.fill('#onEmail', 'player@example.test');
  await page.fill('#onPass', 'unchanged-secret');
  await page.click('#onAuthActs .primary');
}

const RESULT = {
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

async function showHydratedResult(page) {
  const profileHydrated = page.waitForResponse((response) => {
    const url = response.url();
    return response.request().method() === 'GET'
      && url.includes('/rest/v1/profiles')
      && !url.includes('ranked_pool_tier')
      && !url.includes('equipped_rune')
      && !url.includes('random_rune_mode');
  });
  await page.evaluate((report) => {
    window.__kb.S.played = true;
    window.__kbResult(report);
  }, RESULT);
  await page.waitForSelector('#ovEnd.on', { timeout: 15000 });
  await profileHydrated;
  await page.waitForFunction(() => !document.getElementById('ovEnd')?.inert);
}

async function openResultProfile(page) {
  await page.$eval('#endPlates > button:first-child .gpill', (pill) => pill.click());
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
  /* HOLD HYDRATION'S FIRST READ OPEN. Auth is reopened below while the
     successful run is still loading; Profile's own load disables every account
     control, so entry hydration is the one deterministic window for that. */
  routes.deferNextRuneResponse();
  await submitCredentials(page);
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  await page.waitForSelector('#onLoading:not([hidden])');
  const handoff = await page.evaluate(() => ({
    onlineOn: document.getElementById('ovOnline')?.classList.contains('on'),
    loadingVisible: document.getElementById('onLoading')?.hidden === false,
    authRestored: document.getElementById('onAuth')?.parentElement?.classList.contains('pbody'),
    authHidden: document.getElementById('onAuth')?.hidden,
  }));
  /* The title focus is owed after the shared page wipe, not at the hand-off:
     the incoming Online page is inert except its Back control until the wipe
     lands, and the run then restores the focus entry established
     (ui/page-motion.ts deferredTargetFocus). Sample it where the player can
     first reach it. */
  await waitForOverlayTransitions(page, '#ovOnline');
  const transition = {
    ...handoff,
    focused: await page.evaluate(() => document.activeElement?.id),
  };

  /* Reopen auth while the successful run is still hydrating. The old
     continuation must never target this newer sheet when it eventually
     finishes. A real tap cannot reach the still-hidden account button yet;
     invoking its bound action directly creates the exact ownership race. */
  await routes.runeRequestStarted;
  await page.evaluate(() => document.getElementById('btnHaveAcc').click());
  await page.waitForSelector('.authsheet:not(.foout)');
  routes.releaseRuneResponse();
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
  /* HOLD PROFILE'S OWN ROW READ OPEN. For the account view hydration reads
     only the collection (one tier read); the single profile-row read is the
     destination's, dispatched together with Profile's confirming tier read.
     A Back that merely arrives late finds Profile already painted — a
     footrace between the tap and the app's loading, won or lost by how fast
     the machine is. Blocking that response puts Back inside the loading
     window on every machine, so what follows measures the cancel of an
     already-started Profile load: no paint, and no further row read. */
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

/* Back inside entry hydration, before Profile's own load exists. The account
   view's hydration reads no profile row, so the row seam above cannot place
   Back here; hold hydration's rune read instead. entered()'s revision guard,
   not Profile's ownsRun, must stop the stale destination. */
async function probeCancelledHydration(page, routes) {
  routes.deferNextRuneResponse();
  await submitCredentials(page);
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  await page.waitForSelector('#onLoading:not([hidden])');
  await routes.runeRequestStarted;
  await page.click('#btnOnlineBack');
  await page.waitForFunction(() => !document.getElementById('ovOnline')?.classList.contains('on'));
  const staleRead = page.waitForRequest(
    (request) => request.method() === 'GET'
      && request.url().includes('/rest/v1/profiles')
      && !request.url().includes('ranked_pool_tier'),
    { timeout: 4000 },
  ).then(() => true, () => false);
  routes.releaseRuneResponse();
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

/* Profile is a cover over the still-live result. If Back wins while its cached
   view is refreshing, that abandoned read must not later call the
   mutable global exit slot (which now means Home) and close the restored
   result a second time. */
async function probeResultProfileLoadingBack(page, routes) {
  await showHydratedResult(page);
  routes.deferNextAccountProfileResponse();
  await openResultProfile(page);
  await Promise.all([
    page.waitForSelector('#ovOnline.on #onAccount:not([hidden])', { timeout: 15000 }),
    routes.accountProfileStarted,
  ]);
  await page.click('#btnOnlineBack');
  await page.waitForFunction(() => !document.getElementById('ovOnline')?.classList.contains('on'));
  /* Back runs the shared Neon Wipe, which borrows inert on the incoming
     result until it lands (src/ui/page-motion.ts). Judge the restored result
     at the moment the player can act on it; the held profile read is still
     held, so the abandoned-load race below is unchanged. */
  await waitForOverlayTransitions(page, '#ovOnline');
  const restored = await page.evaluate(() => ({
    resultOpen: document.getElementById('ovEnd')?.classList.contains('on'),
    resultInert: document.getElementById('ovEnd')?.inert,
  }));
  routes.releaseAccountProfileResponse();
  await routes.accountProfileFinished;
  await page.waitForTimeout(100);
  const settled = await page.evaluate(() => {
    const result = document.getElementById('ovEnd');
    const action = document.getElementById('btnAgain');
    const box = action?.getBoundingClientRect();
    const hit = box ? document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    ) : null;
    return {
      resultOpen: result?.classList.contains('on'),
      resultInert: result?.inert,
      resultActionOwnsHit: !!action && !!hit && action.contains(hit),
      onlineOpen: document.getElementById('ovOnline')?.classList.contains('on'),
    };
  });
  return { restored, settled };
}

/* Sign-out is a Home-origin auth transition even when Profile was opened from
   a result. Successful re-auth must not leave that old result open and exposed
   to assistive technology beneath the new queue. */
async function probeResultProfileSignOut(page) {
  await page.route('**/auth/v1/logout*', (route) => route.fulfill({
    status: 204,
    body: '',
  }));
  await showHydratedResult(page);
  await openResultProfile(page);
  await page.waitForSelector('#onAccount:not([hidden]) #btnSignOut:not([hidden])', {
    timeout: 15000,
  });
  await page.click('#btnSignOut');
  await page.waitForSelector('.authsheet:not(.foout) #onAuth', { timeout: 15000 });
  await submitCredentials(page);
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  await page.waitForSelector('#ovOnline.on #onQueue:not([hidden])', { timeout: 15000 });
  return page.evaluate(() => {
    const queue = document.getElementById('onQueue');
    const result = document.getElementById('ovEnd');
    return {
      queueVisible: queue?.hidden === false,
      resultOpen: result?.classList.contains('on'),
      resultInert: result?.inert,
    };
  });
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
  check(c?.profileCalls === 1 && c.tierProfileCalls === 2
    && c.settled.secondSheetOpen && c.settled.accountVisible
    && c.settled.onlineInert,
  'an older successful transition closed or displaced a newer auth sheet', c);

  const cancelled = await visit({ anonymous: 422, passwordAuth: 'success', dataDelay: 700,
    skipStandardProbes: true, probe: probeCancelledTransition });
  out.authCredentialCancelled = cancelled.probeResult;
  const x = cancelled.probeResult;
  check(x?.homeOn && !x.onlineOn && !x.staleDestinationRead
    && x.profileCalls === 1 && x.tierProfileCalls === 2
    && x.visiblePanels.length === 0,
    'Back during credential loading allowed the stale destination route to continue', x);

  const cancelledHydration = await visit({ anonymous: 422, passwordAuth: 'success',
    dataDelay: 700, skipStandardProbes: true, probe: probeCancelledHydration });
  out.authCredentialCancelledHydration = cancelledHydration.probeResult;
  const y = cancelledHydration.probeResult;
  check(y?.homeOn && !y.onlineOn && !y.staleDestinationRead
    && y.profileCalls === 0 && y.tierProfileCalls === 1
    && y.visiblePanels.length === 0,
  'Back during credential hydration allowed the stale destination route to continue', y);

  const accountSuccess = await visit({ passwordAuth: 'success', skipStandardProbes: true,
    probe: probeAccountCredentialSuccess });
  out.authCredentialAccount = accountSuccess.probeResult;
  const p = accountSuccess.probeResult;
  check(p?.passwordCalls === 1 && p.onlineOn && p.accountVisible && !p.queueVisible
    && p.title === 'PROFILE' && p.focused === 'onTitle',
  'account-origin sign-in did not return to Profile', p);

  const apple = await visit({ appleBridge: true, appleAuth: 'success', deferAppleAuth: true,
    skipStandardProbes: true, probe: probeAppleRestoreSuccess });
  out.authAppleRestore = apple.probeResult;
  const a = apple.probeResult;
  check(a?.waiting.sheetOpen && a.waiting.ariaBusy === 'true'
    && a.waiting.buttonsDisabled && a.waiting.onlineInert && a.waiting.hitOwned
    && a.waiting.staleNickname === 'TestGuest001',
  'native Apple exchange uncovered an interactive stale Profile while waiting', a?.waiting);
  check(a?.appleCalls === 1 && a.appleTokenCalls === 1 && a.appleRegistrationCalls === 1
    && a.profileCalls > a.beforeProfileCalls && a.sheets === 0 && a.authHidden
    && a.accountVisible && a.nickname === 'ApplePlayer99'
    && a.appleAccountId !== '00000000-0000-4000-8000-00000000beef'
    && a.identity.appleLinked && a.identity.appleRevocationReady
    && !a.providerBoxVisible && !a.claimVisible
    && !a.guestOfferVisible && a.signOutVisible && a.focused === 'onTitle',
  'successful native Apple restore left the auth flow stale instead of repainting Profile', a);
  check(apple.errs.length === 0, 'page errors during native Apple restore', apple.errs);

  const explicitCancel = await visit({ appleBridge: true, appleAuth: 'success',
    skipStandardProbes: true, probe: probeAppleExplicitCancellation });
  out.authAppleExplicitCancel = explicitCancel.probeResult;
  const n = explicitCancel.probeResult;
  check(n?.appleCalls === 2 && n.appleTokenCalls === 0
    && n.cancelled.authOpen && !n.cancelled.askOpen && n.cancelled.buttonsEnabled
    && n.cancelled.onlineInert && n.cancelled.hitOwned
    && n.dismissed.authOpen && !n.dismissed.askOpen && n.dismissed.buttonsEnabled
    && n.dismissed.onlineInert && n.dismissed.hitOwned,
  'Apple warning cancel or Escape did not restore the owned auth form', n);
  check(explicitCancel.errs.length === 0,
    'page errors while cancelling or dismissing the Apple warning', explicitCancel.errs);

  const replaced = await visit({ appleBridge: true, appleAuth: 'success',
    skipStandardProbes: true, probe: probeAppleAskReplacement });
  out.authAppleAskReplacement = replaced.probeResult;
  const r = replaced.probeResult;
  check(r?.askOpen && !r.authOpen && r.head === 'Delete your account?'
    && r.deleteGuarded && r.onlineInert && r.hitOwned && r.appleTokenCalls === 0
    && !r.identity.appleLinked && !r.identity.appleRevocationReady,
  'a replaced Apple warning resurrected AUTH over the newer account sheet', r);
  check(replaced.errs.length === 0, 'page errors while replacing the Apple warning', replaced.errs);

  const loadingBack = await visit({ named: true, skipStandardProbes: true,
    probe: probeResultProfileLoadingBack });
  out.resultProfileLoadingBack = loadingBack.probeResult;
  const b = loadingBack.probeResult;
  check(b?.restored.resultOpen && !b.restored.resultInert
    && b.settled.resultOpen && !b.settled.resultInert
    && b.settled.resultActionOwnsHit && !b.settled.onlineOpen,
  'an abandoned Profile load closed the ranked result after Back had restored it', b);
  check(loadingBack.errs.length === 0,
    'page errors during result Profile loading Back race', loadingBack.errs);

  const signedOut = await visit({ member: true, named: true, passwordAuth: 'success',
    skipStandardProbes: true, probe: probeResultProfileSignOut });
  out.resultProfileSignOut = signedOut.probeResult;
  const s = signedOut.probeResult;
  check(s?.queueVisible && !s.resultOpen && !s.resultInert,
    'successful re-auth left the previous ranked result alive beneath matchmaking', s);
  check(signedOut.errs.length === 0,
    'page errors during result Profile sign-out transition', signedOut.errs);
}
