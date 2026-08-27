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

const HEALTHY = { gameCenterLinked: false, appleLinked: true, appleRevocationReady: true };
const REPAIRABLE = { gameCenterLinked: false, appleLinked: true, appleRevocationReady: false };
const BARE = { gameCenterLinked: false, appleLinked: false, appleRevocationReady: false };

async function probeAppleTap(page) {
  await page.waitForSelector('#btnLinkApple:not([hidden])');
  const before = await readAccess(page);
  await page.click('#btnLinkApple');
  /* The provider answers on a microtask, but a wrongly-opened sheet needs its
     entry flight; wait long enough that an appearing sheet would be caught. */
  await page.waitForTimeout(400);
  return { before, after: await readAccess(page) };
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
