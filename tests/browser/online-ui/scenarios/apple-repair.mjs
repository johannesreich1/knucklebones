// REPAIR APPLE ACCESS is not the guest-upgrade offer.
//
// The profile's ACCOUNT ACCESS box tells a linked player that their deletion
// credential is missing and hands them one button. That button used to call
// exactly what the GUEST card's "Keep it forever" calls — showAuth('attach') —
// so a player who already had an account, already had Apple, and only needed a
// credential was answered with "KEEP ACCOUNT · add an email and this account
// survives a reinstall". Wrong question, and no repair either way.
//
// These probes assert what the player meets: the repair copy, and a tap that
// runs the Apple provider instead of opening somebody else's sheet. WebKit has
// no Capacitor bridge, so the provider answers "not available on this device"
// — a real localized reply on the profile's own error line, which is exactly
// the seam a silent failure used to slip through.

const REPAIRABLE = { gameCenterLinked: false, appleLinked: true, appleRevocationReady: false };

const readProviders = (page) => page.evaluate(() => {
  const seen = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return {
      text: element.textContent?.trim() ?? '',
      shown: box.width > 0 && box.height > 0,
      // A reply the player must scroll to find has not been delivered.
      inView: box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0,
    };
  };
  return {
    box: seen('#accProviders'),
    apple: seen('#accAppleState'),
    button: seen('#btnLinkApple'),
    guestCard: seen('#accGuest'),
    error: seen('#onAccErr'),
    authSheets: document.querySelectorAll('.authsheet').length,
    authTitle: document.getElementById('onAuthTitle')?.textContent ?? '',
    accountShown: document.getElementById('onAccount')?.hidden === false,
  };
});

async function probeRepairTap(page) {
  await page.waitForSelector('#btnLinkApple:not([hidden])');
  const before = await readProviders(page);
  await page.click('#btnLinkApple');
  /* The provider answers on a microtask, but a wrongly-opened sheet needs its
     entry flight; wait long enough that an appearing sheet would be caught. */
  await page.waitForTimeout(400);
  return { before, after: await readProviders(page) };
}

/* The other button in the same region must be untouched: a guest still gets
   the upgrade sheet, with its own copy, from its own card. */
async function probeGuestUpgradeIntact(page) {
  await page.waitForSelector('#btnKeepAcc:not([hidden])');
  await page.click('#btnKeepAcc');
  await page.waitForSelector('.authsheet .focard', { timeout: 15000 });
  return page.evaluate(() => ({
    title: document.getElementById('onAuthTitle')?.textContent ?? '',
    lead: document.getElementById('onAuthLead')?.textContent ?? '',
    sheets: document.querySelectorAll('.authsheet').length,
  }));
}

export async function runAppleRepairScenarios(suite) {
  const { visit, out, check } = suite;

  const repair = await visit({ member: true, named: true, identity: REPAIRABLE,
    skipStandardProbes: true, probe: probeRepairTap });
  out.appleRepair = repair.probeResult;
  const { before, after } = repair.probeResult ?? {};
  check(before?.box?.shown === true && before.guestCard?.shown === false,
  'a linked member was shown the guest card instead of ACCOUNT ACCESS', before);
  check(before?.apple?.text === 'Apple sign-in connected · deletion access needs repair'
    && before.button?.shown === true && before.button.text === 'Repair Apple access',
  'the profile does not offer repair for a linked account with no deletion credential', before);

  // The bug: the repair control opened the guest-upgrade sheet.
  check(after?.authSheets === 0 && after.authTitle !== 'KEEP ACCOUNT' && after.accountShown === true,
  'the repair control opened the guest-upgrade sheet instead of running Apple', after);
  check(after?.error?.text === 'Apple sign-in is not available on this device.'
    && after.error.inView === true,
  'the repair attempt reported nothing the player can read', after);
  check(before?.error?.text === '',
  'the profile carried a stale error before the repair tap', before);
  check(repair.errs.length === 0, 'page errors on the Apple repair path', repair.errs);

  const upgrade = await visit({ skipStandardProbes: true, probe: probeGuestUpgradeIntact });
  out.guestUpgradeAfterRepairSplit = upgrade.probeResult;
  check(upgrade.probeResult?.title === 'KEEP ACCOUNT' && upgrade.probeResult.sheets === 1
    && upgrade.probeResult.lead === 'Add an email and this account survives a reinstall',
  'splitting repair out of the auth sheet changed the guest upgrade offer', upgrade.probeResult);
  check(upgrade.errs.length === 0, 'page errors on the guest upgrade path', upgrade.errs);
}
