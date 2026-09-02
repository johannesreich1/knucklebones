// CONNECTING GAME CENTER IS A TAP, AND THE ROW IS ABOUT THE ACCOUNT.
//
// iOS authenticates the LOCAL PLAYER at launch and greets them by name. That
// is the device's business with GameKit and says nothing about which
// Knucklebones account the identity belongs to — which is exactly why the
// profile once read "Game Center not connected" at a player who had just been
// welcomed back, with nothing to press. Two things fix that, and both are
// asserted here: the row now says what it is really about ("… to this
// account"), and the driver row carries the control that changes it.
//
// A refused link must fail CLOSED. A Game Center identity owned by another
// account answers 409, and the only correct outcome is copy the player can
// read plus an account that is byte-for-byte what it was — never a silent
// move of somebody else's identity.
//
// WHY THIS SUITE BRANCHES. Game Center needs two independent things: GameKit
// on the device (the bridge fixture stands that up) and an identity gateway
// origin, which Vite INLINES at build time — no page-side stub can add one to
// a bundle built without it. So the branch is read from a fact neither the
// profile nor this file can fake: whether the app's own launch sign-in reached
// the gateway at all. A build that carries the origin runs the whole link
// flow; a build without one must offer nothing anywhere, which is the other
// half of the same promise and is asserted just as hard.
import { readAccountAccess, readAccountProblem } from '../harness/account-access-view.mjs';

/* Apple linked but its deletion credential missing: a second driver, so the
   box stays open after Game Center links and its row can be read as the
   passenger it becomes. */
const REPAIRABLE = { gameCenterLinked: false, appleLinked: true, appleRevocationReady: false };

const LINKED = 'Game Center linked to this account';
const UNLINKED = 'Game Center not linked to this account';
const CONFLICT = 'That Game Center account is already linked to another player.';
const ACCOUNT_B = '11111111-2222-4333-8444-555555555555';

async function probePublicationAccountSwitch(page, routes) {
  await page.waitForSelector('#btnLinkGameCenter:not([hidden])');
  const assertionsBefore = routes.gameCenterModes()
    .filter((mode) => mode === 'assert-current').length;
  routes.deferNextGameCenterAttach();
  await page.click('#btnLinkGameCenter');
  await routes.gameCenterAttachStarted;
  /* The gateway has committed A's link but its answer has not reached the
     shared control. Become B at precisely that publication boundary; the
     provider's required session refresh must also describe the now-current B. */
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
  }, ACCOUNT_B);
  routes.setGameCenterRefreshAccount(ACCOUNT_B);
  routes.releaseGameCenterAttach();
  await page.waitForFunction(() => document.getElementById('onLoading')?.hidden === false,
    null, { timeout: 5000 });
  const afterLink = await page.evaluate(() => ({
    cache: localStorage.getItem('knucklebones.online.account-profile'),
    buttonDisabled: document.getElementById('btnLinkGameCenter')?.disabled,
    proofs: globalThis.__gameCenter?.proofs ?? 0,
  }));

  /* If A's callback acknowledged the native revision globally, ranked entry
     under linked B would continue without asserting ownership. The fixed path
     keeps that revision unaccepted, so B must ask Game Center again. */
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on', { timeout: 5000 });
  await page.click('#btnOnline');
  const deadline = Date.now() + 5000;
  while (routes.gameCenterModes().filter((mode) => mode === 'assert-current').length
      <= assertionsBefore && Date.now() < deadline) {
    await page.waitForTimeout(25);
  }
  const modes = routes.gameCenterModes();
  return {
    switched,
    afterLink,
    modes,
    identity: routes.identityState(),
    assertedForB: modes.filter((mode) => mode === 'assert-current').length
      === assertionsBefore + 1,
    proofsAfterEntry: await page.evaluate(() => globalThis.__gameCenter?.proofs ?? 0),
  };
}

async function probeConnect(page, routes) {
  const before = await readAccountAccess(page);
  const launchModes = routes.gameCenterModes();
  const profileReads = routes.profileCalls();
  if (before.gameCenterButton?.shown === true) {
    await page.click('#btnLinkGameCenter');
    /* Settles either way: a success hides the control behind a fresh profile
       read, a refusal deals the shared warning card. */
    await page.waitForFunction(() => document.getElementById('btnLinkGameCenter')?.hidden === true
      || !!document.querySelector('.faceoff.warnsheet .focard'),
    null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(350);
  }
  return {
    before,
    after: await readAccountAccess(page),
    problem: await readAccountProblem(page),
    launchModes,
    modes: routes.gameCenterModes(),
    identity: routes.identityState(),
    refreshed: routes.profileCalls() > profileReads,
  };
}

export async function runAccountGameCenterScenarios(suite) {
  const { visit, out, check } = suite;

  const link = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, gameCenterBridge: 'linked', skipStandardProbes: true,
    probe: probeConnect });
  out.gameCenterLink = link.probeResult;
  const linked = link.probeResult ?? {};
  /* The gateway either exists in this bundle or it does not, and the launch
     sign-in exchange is the proof: the app posts to it before any account
     screen is painted, or it never posts at all. */
  const configured = (linked.launchModes ?? []).length > 0;
  out.gameCenterGatewayConfigured = configured;
  check(link.errs.length === 0, 'page errors on the Game Center link path', link.errs);

  if (!configured) {
    /* The build with no gateway origin. GameKit is authenticated on this
       device and the account is unlinked, and STILL nothing may be painted:
       an attach cannot complete anywhere, so a row saying so would be the
       original dead end with a button added to it. */
    check(linked.before?.gameCenter?.shown === false
      && linked.before?.gameCenter?.text === '',
    'a build with no identity gateway painted a Game Center row anyway', linked.before);
    check(linked.before?.gameCenterButton?.shown === false,
    'a build with no identity gateway offered a Game Center control', linked.before);
    check(linked.before?.appleButton?.shown === true,
    'the Apple repair offer disappeared with the Game Center row', linked.before);
    check((linked.modes ?? []).length === 0 && linked.before?.gameCenterProofs === 0,
    'a build with no identity gateway asked GameKit for a proof anyway', linked);
    return;
  }

  /* (a) Reachable and unlinked: the row states the ACCOUNT fact and carries
     the tap that changes it, beside Apple's own offer. */
  const before = linked.before;
  check(before?.box?.shown === true && before.gameCenter?.shown === true
    && before.gameCenter.text === UNLINKED && before.gameCenter.inView === true,
  'a reachable, unlinked Game Center row did not state the account link', before?.gameCenter);
  check(before?.gameCenter?.clipped === false,
  'the Game Center row overflowed its box, so the player read only part of it', before?.gameCenter);
  check(before?.gameCenterButton?.shown === true
    && before.gameCenterButton.text === 'Connect Game Center'
    && before.gameCenterButton.inView === true,
  'the Game Center row was painted with nothing to tap', before?.gameCenterButton);
  check(before?.appleButton?.shown === true && before.apple?.shown === true,
  'the Game Center offer displaced the Apple control beside it', before);
  check(!before?.error?.shown && before?.problemSheets === 0,
  'the profile carried a stale error before the Game Center tap', before);
  /* Deliberately NOT automatic: reaching the account screen with an
     authenticated local player must not have attached anything by itself. */
  check((linked.launchModes ?? []).every((mode) => mode !== 'attach'),
  'the app attached a Game Center identity without the player asking', linked.launchModes);

  /* (b) The tap runs the provider in ATTACH mode against this account, and the
     row flips to connected with its control retired. */
  const after = linked.after;
  /* One further GameKit proof than the launch sign-in already took: the tap
     re-proves the local player rather than replaying that assertion. */
  check(linked.modes?.includes('attach') === true
    && linked.after.gameCenterProofs === linked.before.gameCenterProofs + 1,
  'the Connect Game Center control did not run the provider against this account', linked);
  check(linked.identity?.gameCenterLinked === true && linked.refreshed === true,
  'a completed link never reached the account, or the profile never re-read it', linked);
  check(after?.gameCenter?.text === LINKED && after.gameCenter.shown === true,
  'the linked account was still told Game Center is not linked to it', after?.gameCenter);
  check(after?.gameCenterButton?.shown === false,
  'the Connect Game Center control survived the link it completed', after?.gameCenterButton);
  check(after?.box?.shown === true && after.appleButton?.shown === true,
  'linking Game Center swallowed the Apple repair still owed to this account', after);
  check(!after?.error?.shown && after.problemSheets === 0 && after.authSheets === 0,
  'a completed Game Center link reported an error or opened a sheet', after);

  const switchedOwner = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, gameCenterBridge: 'linked', skipStandardProbes: true,
    returnAfterProbe: true, probe: probePublicationAccountSwitch });
  out.gameCenterPublicationAccountSwitch = switchedOwner.probeResult;
  const switched = switchedOwner.probeResult;
  check(switched?.switched && switched.identity?.gameCenterLinked
    && switched.afterLink?.cache === null && switched.afterLink.buttonDisabled
    && switched.assertedForB
    && switched.proofsAfterEntry === switched.afterLink.proofs + 1,
  'account B inherited account A\'s completed Game Center publication or acknowledgement',
  switched);
  check(switchedOwner.errs.length === 0,
  'page errors during the Game Center publication account switch', switchedOwner.errs);

  /* (c) The identity belongs to somebody else. Fail closed: copy the player
     can read, and an account that did not move. */
  const clash = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, gameCenterBridge: 'conflict', skipStandardProbes: true,
    probe: probeConnect });
  out.gameCenterConflict = clash.probeResult;
  const refused = clash.probeResult ?? {};
  check(refused.problem?.open === true && refused.problem.message === CONFLICT
    && refused.problem.inView === true,
  'a Game Center identity owned elsewhere reported nothing the player can read',
  refused.problem);
  check(refused.identity?.gameCenterLinked === false && refused.refreshed === false,
  'a refused Game Center link moved the identity or repainted over the reply', refused);
  check(refused.after?.gameCenter?.text === UNLINKED
    && refused.after.gameCenterButton?.shown === true,
  'a refused link left the player with no way to try again', refused.after);
  check(clash.errs.length === 0, 'page errors on the Game Center conflict path', clash.errs);
}
