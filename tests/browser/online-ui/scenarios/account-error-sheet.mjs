// A REFUSAL IS DEALT AS A CARD, NOT WRITTEN SOMEWHERE ELSE ON THE PANEL.
//
// The profile's provider controls sit in the middle of the ACCOUNT ACCESS box;
// their answers used to land in `#onAccErr`, a small orange line pinned below
// the recent matches near the bottom of a scrolling panel. The player pressed
// a button here and the reply appeared there, sometimes past the fold — "the
// position doesn't make sense. it should be a modal like the spells or ladder
// comparison" (user call 2026-08-26). So it now comes up as the shared sheet,
// wearing the amber the line used to wear plus the warning glyph.
//
// Everything below is read as PAINT, because every part of this claim is a
// pixel claim: a sheet that exists in the DOM can still be entirely below the
// fold on its 340ms flight, and an amber frame built from a `color-mix` of a
// token resolves to transparent the moment the token stops reaching it. The
// aria contract is asserted for the same reason the grabber exists at all —
// a gesture is invisible to a screen reader.
//
// The other half of the promise is that NOTHING HAPPENED: a refusal never
// refreshes the account, so the box behind the card is unchanged and still
// offers the same tap, and dismissing hands focus back to the control that
// opened it rather than dropping the keyboard player at the top of the panel.
import { readAccountAccess, readAccountProblem } from '../harness/account-access-view.mjs';

const REPAIRABLE = { gameCenterLinked: false, appleLinked: true, appleRevocationReady: false };
const APPLE_INVALID = 'Apple sign-in could not be verified. Please try again.';
/* The refusal the owner's device most plausibly hit: GameKit authenticated the
   local player (iOS showed its "Signed in as …" banner) and then declined to
   vouch for the scoped identifiers, which never reaches the gateway at all. */
const NOT_PERSISTENT = {
  code: 'identifiers-not-persistent',
  message: 'Game Center identifiers are not persistent',
  // the launch exchange is what signs this fixture's member in; the refusal
  // under test is the one the player's own tap asks for (see visit.mjs)
  afterProofs: 1,
};
const IDENTIFIERS_COPY = 'Game Center will not identify this player. '
  + 'Check Settings › Game Center and any Screen Time limits on multiplayer.';
const GENERIC = 'Game Center sign-in failed. Please try again.';
const ORANGE = [255, 138, 61];   // --orange, the token the retired line wore

/* WebKit serializes a `color-mix()` result as `color(srgb 1 0.54 0.24 / .42)` —
   0-1 floats — while a plain `color:` computes to `rgb(255, 138, 61)`. Both are
   the same token; normalize before comparing rather than asserting one engine's
   spelling of it. The alpha must simply be visible: the frame is the tint at
   42%, which is the shared sheet's own `hued` rule, not a number this owns. */
const isOrange = (channels) => {
  if (!Array.isArray(channels) || channels.length < 3) return false;
  const scale = Math.max(channels[0], channels[1], channels[2]) <= 1 ? 255 : 1;
  return ORANGE.every((value, i) => Math.abs(channels[i] * scale - value) <= 1)
    && (channels[3] ?? 1) > 0;
};

/* Tap the control, read the card, then send the card away the way a keyboard
   player would and see where focus lands. */
async function probeRefusal(page, control) {
  await page.waitForSelector(`${control}:not([hidden])`);
  const before = await readAccountAccess(page);
  await page.click(control);
  await page.waitForSelector('.faceoff.warnsheet .focard', { timeout: 15000 });
  // past the 340ms arrival flight, so the rect read below is the resting card
  await page.waitForTimeout(420);
  const sheet = await readAccountProblem(page);
  const after = await readAccountAccess(page);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.faceoff.warnsheet', { state: 'detached', timeout: 15000 });
  // the exit flight plus the frame on which sheet.ts restores the opener
  await page.waitForTimeout(400);
  const dismissed = await page.evaluate(() => ({
    focused: document.activeElement?.id ?? '',
    sheets: document.querySelectorAll('.faceoff.warnsheet').length,
    accountShown: document.getElementById('onAccount')?.hidden === false,
  }));
  return { before, sheet, after, dismissed };
}

function checkCard(check, label, sheet, message) {
  check(sheet?.open === true && sheet.inView === true && sheet.hit === true,
  `${label} produced a card the player cannot actually see`, sheet);
  check(sheet?.message === message,
  `${label} did not carry the reason the device gave`, { said: sheet?.message, message });
  check(sheet?.role === 'dialog' && sheet.modal === 'true' && !!sheet.label.trim(),
  `${label} opened an unannounced dialog`, sheet);
  check(sheet?.title === 'That did not go through' && sheet.label === sheet.title,
  `${label} lost the card's heading, so the message stands with nothing naming it`, sheet);
  /* The treatment the owner asked to keep: the orange the error line wore, as
     an outline, with an icon — read from the painted frame and glyph. */
  check(isOrange(sheet?.border) && parseFloat(sheet?.borderWidth ?? '0') > 0,
  `${label} lost the amber outline`, { border: sheet?.border, width: sheet?.borderWidth });
  check(isOrange(sheet?.headColor) && sheet?.glyph === true,
  `${label} lost the warning icon or its colour`, sheet);
  check(sheet?.grabber === true && sheet.count === 1,
  `${label} stacked cards or shipped one with no announced way out`, sheet);
}

export async function runAccountErrorSheetScenarios(suite) {
  const { visit, out, check } = suite;

  /* (a) THE APPLE CONTROL, which every build can run: the stub bridge answers
     with a credential the app must reject, so the tap runs the whole provider
     and lands on a real refusal. */
  const apple = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, skipStandardProbes: true,
    probe: (page) => probeRefusal(page, '#btnLinkApple') });
  out.problemSheetApple = apple.probeResult;
  const repair = apple.probeResult ?? {};
  checkCard(check, 'a refused Apple repair', repair.sheet, APPLE_INVALID);
  /* The line is not merely empty — it is GONE. A second surface that happens
     to be blank today is a second surface somebody fills in tomorrow. */
  check(repair.before?.error === null && repair.after?.error === null,
  'the retired inline error line came back and answered beside the card', repair.after);
  /* Nothing happened: the box behind the card is the box that was there. */
  check(repair.after?.box?.shown === true && repair.after.appleButton?.shown === true
    && repair.after.apple?.text === repair.before?.apple?.text,
  'a refused repair repainted the account it did not change', repair.after);
  check(repair.after?.authSheets === 0,
  'the warning card arrived on top of the guest-upgrade sheet', repair.after);
  check(repair.dismissed?.focused === 'btnLinkApple' && repair.dismissed.sheets === 0
    && repair.dismissed.accountShown === true,
  'dismissing the card did not hand focus back to the control that opened it',
  repair.dismissed);
  check(apple.errs.length === 0, 'page errors on the refused Apple path', apple.errs);

  /* (b) THE DEVICE'S OWN WORDS. GameKit refuses to sign, nothing reaches the
     gateway, and the card must carry the specific remedy rather than the
     "please try again" that four different causes used to share.
     Reachable only where this build compiled an identity gateway origin —
     Vite inlines it, so no page-side stub can add one — which is exactly the
     condition under which the control is offered at all. */
  const refused = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, gameCenterBridge: 'linked', proofRefusal: NOT_PERSISTENT,
    skipStandardProbes: true,
    probe: async (page, routes) => {
      const painted = await readAccountAccess(page);
      /* The gateway is a build fact, proven by the launch sign-in exchange —
         not by whether the control happened to paint. A build with the
         gateway that paints no control must fail below, not skip. */
      const offered = routes.gameCenterModes().length > 0;
      if (!offered) return { offered: false, painted, modes: routes.gameCenterModes() };
      const probed = await probeRefusal(page, '#btnLinkGameCenter');
      return { offered: true, ...probed,
               modes: routes.gameCenterModes(), identity: routes.identityState() };
    } });
  out.problemSheetGameCenter = refused.probeResult;
  const device = refused.probeResult ?? {};
  check(refused.errs.length === 0, 'page errors on the refused proof path', refused.errs);
  if (!device.offered) {
    out.problemSheetGameCenterSkipped = 'no identity gateway origin in this build';
    return;
  }
  checkCard(check, 'a proof GameKit would not sign', device.sheet, IDENTIFIERS_COPY);
  check(device.sheet?.message !== GENERIC,
  'the device named its refusal and the app answered "please try again" anyway', device.sheet);
  /* The whole point of the diagnosis: this failure never left the phone, so no
     server log could ever have explained it. */
  check((device.modes ?? []).every((mode) => mode !== 'attach')
    && device.identity?.gameCenterLinked === false,
  'a refused proof still posted to the identity gateway, or moved the account', device);
  check(device.after?.gameCenterButton?.shown === true,
  'a refused link left the player with no way to try again', device.after);
  check(device.dismissed?.focused === 'btnLinkGameCenter',
  'dismissing the card did not hand focus back to the Game Center control',
  device.dismissed);
}
