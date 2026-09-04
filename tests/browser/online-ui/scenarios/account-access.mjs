// ACCOUNT ACCESS is an offer, not a status readout.
//
// The box used to paint for every non-guest account and always list the same
// two providers. On a real device that produced a profile insisting "Game
// Center not connected" with nothing to press — while iOS had just shown its
// own "Signed in as …" banner for the local player — and a web/Android player
// who tapped "Add Apple sign-in" was answered "not available on this device".
// Both rows stated a fact the player could not act on. The box now paints only
// what this build and this device can actually do, and disappears when that is
// nothing, so a healthy Apple-linked account meets no box at all.
//
// The repair control is also not the guest-upgrade offer: it used to call the
// same showAuth('attach') as the GUEST card's "Keep it forever", answering a
// player whose account is already attached with "KEEP ACCOUNT · add an email".
// It runs the Apple provider instead, and its failure is dealt as the shared
// warning card (account-error-sheet.mjs owns what that card must look like;
// here it is only evidence that the right provider ran and answered).
//
// Everything below is read as PAINT (see harness/account-access-view.mjs):
// `hidden` on a row inside .providerbox is a claim about the DOM, and
// `.providerbox p{display:flex}` outranks the attribute on specificity alone.
import { readAccountAccess as readAccess } from '../harness/account-access-view.mjs';
import { openOffer } from '../harness/offer-deck.mjs';

const HEALTHY = { gameCenterLinked: false, appleLinked: true, appleRevocationReady: true };
const REPAIRABLE = { gameCenterLinked: false, appleLinked: true, appleRevocationReady: false };
const BARE = { gameCenterLinked: false, appleLinked: false, appleRevocationReady: false };
const ACCOUNT_B = '11111111-2222-4333-8444-555555555555';

const switchStoredAccount = (page, nextAccountId) => page.evaluate((accountId) => {
  const key = Object.keys(localStorage)
    .find((candidate) => candidate.startsWith('sb-') && candidate.endsWith('-auth-token'));
  if (!key) return false;
  const stored = JSON.parse(localStorage.getItem(key));
  const session = stored?.currentSession ?? stored;
  if (!session?.user) return false;
  session.user.id = accountId;
  localStorage.setItem(key, JSON.stringify(stored));
  return true;
}, nextAccountId);

async function probeAppleTap(page) {
  await page.waitForSelector('#btnLinkApple:not([hidden])');
  const before = await readAccess(page);
  await page.click('#btnLinkApple');
  /* The provider answers on a microtask, but a wrongly-opened sheet needs its
     entry flight; wait long enough that an appearing sheet would be caught. */
  await page.waitForTimeout(400);
  return { before, after: await readAccess(page) };
}

async function probeSuccessfulAppleWithFailedIdentityRefresh(page, routes) {
  await page.waitForSelector('#btnLinkApple:not([hidden])');
  const before = await readAccess(page);
  const profileReads = routes.profileCalls();
  const failedStatusReads = routes.identityStatusFailures();
  /* The provider mutation succeeds, but its immediately-following status read
     does not. The completed local fact must retire the offer without waiting
     for that independent endpoint to repeat what the provider just proved. */
  routes.failNextIdentityStatusResponse();
  await page.click('#btnLinkApple');
  const deadline = Date.now() + 5000;
  while (routes.profileCalls() === profileReads && Date.now() < deadline) {
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(300);
  return {
    before,
    after: await readAccess(page),
    identity: routes.identityState(),
    cachedIdentity: await page.evaluate(() => JSON.parse(localStorage.getItem(
      'knucklebones.online.account-profile') ?? 'null')?.identity ?? null),
    profileRefreshed: routes.profileCalls() > profileReads,
    failedStatusRefreshConsumed: routes.identityStatusFailures() === failedStatusReads + 1,
  };
}

async function probeProviderAccountSwitchAfterMutation(page, routes) {
  await page.waitForSelector('#btnLinkApple:not([hidden])');
  await page.click('#btnLinkApple');
  /* linkIdentity has succeeded and stored A. Hold the final registration so B
     can become current before the shared control publishes that success. */
  await routes.appleRegistrationStarted;
  const switched = await switchStoredAccount(page, ACCOUNT_B);
  routes.releaseAppleRegistration();
  await page.waitForFunction(() => document.getElementById('onLoading')?.hidden === false,
    null, { timeout: 5000 });
  const invalidated = await page.evaluate(() => ({
    cached: localStorage.getItem('knucklebones.online.account-profile'),
    loading: document.getElementById('onLoading')?.hidden === false,
    buttonDisabled: document.getElementById('btnLinkApple')?.disabled,
  }));
  const committedIdentity = routes.identityState();
  routes.setProfileAccountId(ACCOUNT_B);
  routes.setAppleIdentity(true, false);
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on', { timeout: 5000 });
  await page.click('#homeChip');
  await page.waitForSelector('#btnLinkApple:not([hidden])', { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('btnLinkApple')?.disabled === false,
    null, { timeout: 5000 }).catch(() => {});
  return {
    switched,
    appleCalls: await page.evaluate(() => globalThis.__appleSignIn?.calls ?? 0),
    tokenCalls: routes.appleTokenCalls(),
    registrationCalls: routes.appleRegistrationCalls(),
    identity: committedIdentity,
    ...invalidated,
    reopenedAccountId: await page.evaluate(() => JSON.parse(localStorage.getItem(
      'knucklebones.online.account-profile') ?? 'null')?.accountId ?? null),
    reopenedActionable: await page.locator('#btnLinkApple').isEnabled(),
  };
}

async function probeProviderNativeAccountSwitch(page, routes) {
  await page.waitForSelector('#btnLinkApple:not([hidden])');
  await page.click('#btnLinkApple');
  await page.waitForFunction(() => globalThis.__appleSignIn?.started === true,
    null, { timeout: 5000 });
  const switched = await switchStoredAccount(page, ACCOUNT_B);
  await page.evaluate(() => globalThis.__releaseAppleNative?.());
  await page.waitForFunction(() => document.getElementById('onLoading')?.hidden === false,
    null, { timeout: 5000 });
  return {
    switched,
    appleCalls: await page.evaluate(() => globalThis.__appleSignIn?.calls ?? 0),
    tokenCalls: routes.appleTokenCalls(),
    registrationCalls: routes.appleRegistrationCalls(),
    identity: routes.identityState(),
    cached: await page.evaluate(() => localStorage.getItem(
      'knucklebones.online.account-profile')),
    problemSheets: await page.locator('.faceoff.warnsheet').count(),
    buttonDisabled: await page.locator('#btnLinkApple').isDisabled(),
  };
}

async function probeProviderErrorAccountSwitch(page, routes) {
  await page.waitForSelector('#btnLinkApple:not([hidden])');
  await page.click('#btnLinkApple');
  await routes.appleTokenStarted;
  const switched = await switchStoredAccount(page, ACCOUNT_B);
  routes.releaseAppleToken();
  await page.waitForFunction(() => document.getElementById('onLoading')?.hidden === false,
    null, { timeout: 5000 });
  return {
    switched,
    appleCalls: await page.evaluate(() => globalThis.__appleSignIn?.calls ?? 0),
    tokenCalls: routes.appleTokenCalls(),
    cached: await page.evaluate(() => localStorage.getItem(
      'knucklebones.online.account-profile')),
    problemSheets: await page.locator('.faceoff.warnsheet').count(),
    buttonDisabled: await page.locator('#btnLinkApple').isDisabled(),
  };
}

async function probeProviderSuccessWithCacheWriteFailure(page, routes) {
  await page.waitForSelector('#btnLinkApple:not([hidden])');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    let failed = false;
    Storage.prototype.setItem = function setItem(key, value) {
      if (!failed && key === 'knucklebones.online.account-profile') {
        failed = true;
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
    globalThis.__accountCacheWriteFailed = () => failed;
  });
  await page.click('#btnLinkApple');
  await page.waitForFunction(() => document.getElementById('btnLinkApple')?.hidden === true,
    null, { timeout: 5000 });
  return {
    access: await readAccess(page),
    cacheWriteFailed: await page.evaluate(() => globalThis.__accountCacheWriteFailed?.()),
    identity: routes.identityState(),
  };
}

/* The other button in the same region must be untouched: a guest still gets
   the upgrade sheet, with its own copy, from its own card. */
async function probeGuestUpgradeIntact(page) {
  /* the way up lives on the guest offer, which is the deck's second slide */
  await openOffer(page, 'guest');
  await page.waitForSelector('#btnKeepAcc:not([hidden])');
  await page.click('#btnKeepAcc');
  await page.waitForSelector('.authsheet .focard', { timeout: 15000 });
  return page.evaluate(() => ({
    title: document.getElementById('onAuthTitle')?.textContent ?? '',
    lead: document.getElementById('onAuthLead')?.textContent ?? '',
    sheets: document.querySelectorAll('.authsheet').length,
  }));
}

/* No provider row may survive as a bare status line: whenever the box is gone
   its rows must be gone with it, text included, so nothing can come back by
   somebody later restoring the box for an unrelated reason. */
function checkNoBox(check, label, state) {
  check(state?.accountShown === true && state.box?.shown === false,
  `${label} was still shown the ACCOUNT ACCESS box`, state);
  check(state?.appleButton?.shown === false && state?.gameCenterButton?.shown === false,
  `${label} was offered a provider control`, state);
  check(state?.gameCenter?.shown === false && state?.gameCenter?.text === '',
  `${label} was told about Game Center linking it cannot perform`, state?.gameCenter);
  check(state?.apple?.shown === false && state?.apple?.text === '',
  `${label} was shown an Apple status line`, state?.apple);
}

export async function runAccountAccessScenarios(suite) {
  const { visit, out, check } = suite;

  /* (a) A device that CAN run Apple, on an account where Apple is linked and
     its deletion credential is registered. Nothing is left to do and Game
     Center linking cannot complete without the identity gateway, so the whole
     box goes — this is the state the owner reported the dead-end box in. */
  const healthy = await visit({ member: true, named: true, identity: HEALTHY,
    appleBridge: true, skipStandardProbes: true, probe: readAccess });
  out.accessHealthy = healthy.probeResult;
  checkNoBox(check, 'a healthy Apple-linked account', healthy.probeResult);
  check(healthy.errs.length === 0, 'page errors on the healthy account path', healthy.errs);

  /* (b) Linked, but the deletion credential never registered. That IS
     actionable on this device, so the box returns with the repair copy. */
  const repair = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, skipStandardProbes: true, probe: probeAppleTap });
  out.accessRepair = repair.probeResult;
  const { before, after } = repair.probeResult ?? {};
  check(before?.box?.shown === true && before.guestCard?.shown === false,
  'a linked member was shown the guest card instead of ACCOUNT ACCESS', before);
  check(before?.apple?.text === 'Apple sign-in connected · deletion access needs repair'
    && before.apple.shown === true
    && before.appleButton?.shown === true && before.appleButton.text === 'Repair Apple access',
  'the profile does not offer repair for a linked account with no deletion credential', before);
  check(before?.gameCenter?.shown === false && before?.gameCenter?.text === '',
  'the repair box carried a Game Center row this device cannot link', before?.gameCenter);
  check(!before?.error?.shown && before?.problemSheets === 0,
  'the profile carried a stale error before the repair tap', before);

  // The bug: the repair control opened the guest-upgrade sheet.
  check(after?.authSheets === 0 && after.authTitle !== 'KEEP ACCOUNT' && after.accountShown === true,
  'the repair control opened the guest-upgrade sheet instead of running Apple', after);
  check(after?.appleCalls === 1,
  'the repair control did not run the Apple provider', after?.appleCalls);
  check(after?.problemSheets === 1 && !after.error?.shown,
  'the repair attempt reported nothing the player can read, or answered in two places', after);
  check(repair.errs.length === 0, 'page errors on the Apple repair path', repair.errs);

  const retainedSuccess = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, appleAuth: 'success', skipStandardProbes: true,
    probe: probeSuccessfulAppleWithFailedIdentityRefresh });
  out.accessAppleSuccessRefreshFailure = retainedSuccess.probeResult;
  const retained = retainedSuccess.probeResult;
  check(retained?.before?.appleButton?.shown === true
      && retained.identity?.appleLinked && retained.identity.appleRevocationReady
      && retained.profileRefreshed
      && retained.failedStatusRefreshConsumed
      && retained.cachedIdentity?.appleLinked && retained.cachedIdentity.appleRevocationReady
      && retained.after?.appleButton?.shown === false
      && !/repair|not connected/i.test(retained.after?.apple?.text ?? ''),
  'a successful Apple link stayed actionable when identity-status refresh failed', retained);
  check(retainedSuccess.errs.length === 0,
    'page errors while retaining a provider success across a failed identity refresh',
    retainedSuccess.errs);

  const switchedOwner = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, appleAuth: 'success', deferAppleRegistration: true,
    skipStandardProbes: true, probe: probeProviderAccountSwitchAfterMutation });
  out.accessProviderPublicationAccountSwitch = switchedOwner.probeResult;
  const switched = switchedOwner.probeResult;
  check(switched?.switched && switched.appleCalls === 1
      && switched.tokenCalls === 1 && switched.registrationCalls === 1
      && switched.identity?.appleLinked && switched.identity.appleRevocationReady
      && switched.cached === null && switched.loading && switched.buttonDisabled
      && switched.reopenedAccountId === ACCOUNT_B && switched.reopenedActionable,
  'a completed account A provider mutation published into account B', switched);
  check(switchedOwner.errs.length === 0,
    'page errors while refusing a stale provider control after an account switch',
    switchedOwner.errs);

  const nativeSwitch = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, appleAuth: 'success', deferAppleNative: true,
    skipStandardProbes: true, probe: probeProviderNativeAccountSwitch });
  out.accessProviderNativeAccountSwitch = nativeSwitch.probeResult;
  const switchedBeforeWrite = nativeSwitch.probeResult;
  check(switchedBeforeWrite?.switched && switchedBeforeWrite.appleCalls === 1
      && switchedBeforeWrite.tokenCalls === 0
      && switchedBeforeWrite.registrationCalls === 0
      && switchedBeforeWrite.identity?.appleLinked
      && !switchedBeforeWrite.identity.appleRevocationReady
      && switchedBeforeWrite.cached === null
      && switchedBeforeWrite.problemSheets === 0
      && switchedBeforeWrite.buttonDisabled,
  'native account A proof mutated account B before provider publication', switchedBeforeWrite);
  check(nativeSwitch.errs.length === 0,
    'page errors while refusing a native provider proof after an account switch',
    nativeSwitch.errs);

  const switchedError = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, appleAuth: 'rejected', deferAppleAuth: true,
    skipStandardProbes: true, probe: probeProviderErrorAccountSwitch });
  out.accessProviderErrorAccountSwitch = switchedError.probeResult;
  const staleError = switchedError.probeResult;
  check(staleError?.switched && staleError.appleCalls === 1 && staleError.tokenCalls === 1
      && staleError.cached === null && staleError.problemSheets === 0
      && staleError.buttonDisabled,
  'a stale account A provider error was dealt over account B', staleError);
  check(switchedError.errs.length === 0,
    'page errors while discarding a stale provider error', switchedError.errs);

  const forgetfulCache = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, appleAuth: 'success', skipStandardProbes: true,
    probe: probeProviderSuccessWithCacheWriteFailure });
  out.accessProviderForgetfulCache = forgetfulCache.probeResult;
  const forgetful = forgetfulCache.probeResult;
  check(forgetful?.cacheWriteFailed && forgetful.identity?.appleLinked
      && forgetful.identity.appleRevocationReady
      && forgetful.access?.accountShown && !forgetful.access.appleButton?.shown,
  'a successful provider mutation was rejected because local cache write failed', forgetful);
  check(forgetfulCache.errs.length === 0,
    'page errors while refreshing after a refused local cache write', forgetfulCache.errs);

  /* (c) Nothing linked, and Apple can run here: the box offers the way to add
     it — and still says nothing about Game Center. */
  const add = await visit({ member: true, named: true, identity: BARE,
    appleBridge: true, skipStandardProbes: true, probe: probeAppleTap });
  out.accessAdd = add.probeResult;
  const bareBefore = add.probeResult?.before;
  check(bareBefore?.box?.shown === true
    && bareBefore.apple?.text === 'Apple sign-in not connected'
    && bareBefore.apple.shown === true
    && bareBefore.appleButton?.shown === true && bareBefore.appleButton.text === 'Add Apple sign-in',
  'an unlinked member with a working Apple provider was not offered it', bareBefore);
  check(bareBefore?.gameCenter?.shown === false && bareBefore?.gameCenter?.text === '',
  'the add box carried a Game Center row this device cannot link', bareBefore?.gameCenter);
  check(add.probeResult?.after?.appleCalls === 1
    && add.probeResult.after.authSheets === 0,
  'Add Apple sign-in did not run the Apple provider', add.probeResult?.after);
  check(add.errs.length === 0, 'page errors on the Apple add path', add.errs);

  /* (d) The web/Android player — the case this harness runs in natively. The
     Apple plugin does not exist, so "Add Apple sign-in" could only ever answer
     "not available on this device"; it is not offered, and the Game Center row
     that used to keep the box alive beside it is gone too. Same account state
     as (b): the difference is the device, not the account. */
  const web = await visit({ member: true, named: true, identity: REPAIRABLE,
    skipStandardProbes: true, probe: readAccess });
  out.accessWeb = web.probeResult;
  checkNoBox(check, 'a web player with no Apple bridge', web.probeResult);
  check(web.probeResult?.appleCalls === 0,
  'the web profile reached the Apple provider anyway', web.probeResult);
  check(web.errs.length === 0, 'page errors on the bridge-less profile path', web.errs);

  const upgrade = await visit({ skipStandardProbes: true, probe: probeGuestUpgradeIntact });
  out.guestUpgradeAfterRepairSplit = upgrade.probeResult;
  check(upgrade.probeResult?.title === 'KEEP ACCOUNT' && upgrade.probeResult.sheets === 1
    && upgrade.probeResult.lead === 'Add an email and this account survives a reinstall',
  'splitting repair out of the auth sheet changed the guest upgrade offer', upgrade.probeResult);
  check(upgrade.errs.length === 0, 'page errors on the guest upgrade path', upgrade.errs);
}
