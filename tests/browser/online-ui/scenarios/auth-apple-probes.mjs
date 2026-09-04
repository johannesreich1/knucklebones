import { openOffer } from '../harness/offer-deck.mjs';

async function openAppleWarning(page) {
  await page.waitForSelector('.authsheet:not(.foout) .tap.apple');
  await page.click('.authsheet .tap.apple');
  await page.waitForFunction(() => document.getElementById('askHead')?.textContent?.trim()
    === 'YOUR GUEST RUN WILL BE LOST');
}

function restoredAuthState() {
  const sheet = document.querySelector('.authsheet');
  const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  return {
    authOpen: !!sheet,
    askOpen: !!document.querySelector('#ovAsk'),
    buttonsEnabled: !!sheet && [...sheet.querySelectorAll('#onAuth button')]
      .filter((button) => !button.hidden).every((button) => !button.disabled),
    onlineInert: document.getElementById('ovOnline')?.inert,
    hitOwned: !!sheet && !!hit && sheet.contains(hit),
  };
}

export async function probeAppleRestoreSuccess(page, routes) {
  await openOffer(page, 'guest');
  await page.click('#btnHaveAcc');
  const beforeProfileCalls = routes.profileCalls();
  await openAppleWarning(page);
  await page.click('#btnAskYes');
  await routes.appleTokenStarted;
  const waiting = await page.evaluate(() => {
    const sheet = document.querySelector('.authsheet');
    const card = sheet?.querySelector('.focard');
    /* The card may still be completing its entrance flight; the full-screen
       overlay already owns the room from frame one. */
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return {
      sheetOpen: !!sheet,
      ariaBusy: card?.getAttribute('aria-busy'),
      buttonsDisabled: !!sheet && [...sheet.querySelectorAll('button')]
        .every((button) => button.disabled),
      onlineInert: document.getElementById('ovOnline')?.inert,
      hitOwned: !!sheet && !!hit && sheet.contains(hit),
      staleNickname: document.getElementById('onAccount')?.dataset.accountName?.trim() ?? null,
    };
  });
  routes.releaseAppleToken();
  await page.waitForFunction(() =>
    document.getElementById('onAccount')?.dataset.accountName?.trim() === 'ApplePlayer99',
  null, { timeout: 5000 }).catch(() => { /* the observation below owns the failure */ });
  return page.evaluate(({ beforeProfileCalls, profileCalls, appleTokenCalls,
    appleRegistrationCalls, appleAccountId, identity, waiting }) => ({
    beforeProfileCalls,
    profileCalls,
    appleTokenCalls,
    appleRegistrationCalls,
    appleCalls: window.__appleSignIn?.calls ?? 0,
    appleAccountId,
    identity,
    waiting,
    sheets: document.querySelectorAll('.faceoff').length,
    authHidden: document.getElementById('onAuth')?.hidden,
    accountVisible: document.getElementById('onAccount')?.hidden === false,
    nickname: document.getElementById('onAccount')?.dataset.accountName?.trim() ?? null,
    providerBoxVisible: document.getElementById('accProviders')?.hidden === false,
    claimVisible: document.getElementById('accClaim')?.hidden === false,
    guestOfferVisible: document.getElementById('accGuest')?.hidden === false,
    signOutVisible: document.getElementById('btnSignOut')?.hidden === false,
    focused: document.activeElement?.id,
  }), {
    beforeProfileCalls,
    profileCalls: routes.profileCalls(),
    appleTokenCalls: routes.appleTokenCalls(),
    appleRegistrationCalls: routes.appleRegistrationCalls(),
    appleAccountId: routes.appleAccountId(),
    identity: routes.identityState(),
    waiting,
  });
}

export async function probeAppleAskReplacement(page, routes) {
  await openOffer(page, 'guest');
  await page.click('#btnHaveAcc');
  await openAppleWarning(page);
  /* The account is inert under Apple, but application navigation can still
     request a real, higher-priority shared sheet. */
  await page.evaluate(() => document.getElementById('btnDeleteAcc').click());
  await page.waitForTimeout(50);
  return page.evaluate(({ appleTokenCalls, identity }) => {
    const ask = document.querySelector('#ovAsk .askcard');
    const sheet = ask?.closest('.asksheet');
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return {
      appleTokenCalls,
      identity,
      authOpen: !!document.querySelector('.authsheet'),
      askOpen: !!ask,
      head: document.getElementById('askHead')?.textContent?.trim() ?? null,
      deleteGuarded: document.getElementById('btnAskYes')?.disabled,
      onlineInert: document.getElementById('ovOnline')?.inert,
      hitOwned: !!sheet && !!hit && sheet.contains(hit),
    };
  }, {
    appleTokenCalls: routes.appleTokenCalls(),
    identity: routes.identityState(),
  });
}

export async function probeAppleExplicitCancellation(page, routes) {
  await openOffer(page, 'guest');
  await page.click('#btnHaveAcc');
  await openAppleWarning(page);
  await page.click('#btnAskNo');
  await page.waitForFunction(() => !!document.querySelector('.authsheet')
    && !document.querySelector('#ovAsk'));
  const cancelled = await page.evaluate(restoredAuthState);

  await openAppleWarning(page);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !!document.querySelector('.authsheet')
    && !document.querySelector('#ovAsk'));
  const dismissed = await page.evaluate(restoredAuthState);
  return {
    cancelled,
    dismissed,
    appleCalls: await page.evaluate(() => window.__appleSignIn?.calls ?? 0),
    appleTokenCalls: routes.appleTokenCalls(),
  };
}
