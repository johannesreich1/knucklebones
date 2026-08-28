// A CONTROL THAT IS KNOWN TO FAIL IS NOT AN OFFER, AND ITS ABSENCE IS NOT AN
// EXPLANATION EITHER.
//
// The owner tapped Connect Game Center on his own iPhone and got the amber card
// reading "Game Center will not identify this player. Check Settings › Game
// Center and any Screen Time limits on multiplayer." That is GameKit
// authenticating the local player and then refusing to vouch for a stable
// identifier — a real, correct refusal, and never something to work around: an
// account welded to an identifier that rotates is an account nobody can get
// back into.
//
// What was wrong is that the app could only learn it by offering a button and
// letting the player press it. `scopedIDsArePersistent()` now rides on the AUTH
// STATE, so the profile knows before it offers anything, and the answer changes
// posture: "this card, only for this status, should be shown at the bottom
// before the sign out button, after the match history" (user call 2026-08-27).
//
// Everything below is read as PAINT and as GEOMETRY. Document order proves
// nothing here: `.accfoot` is pinned with `margin-top:auto` and the mini
// history above it is trimmed to whatever the device leaves free, so "after the
// match history, before Sign out" is a claim about rects. The amber is a
// `color-mix` of a token that resolves to transparent the moment it stops
// reaching this box, and the whole point of the placement is that the player
// does not have to go looking — so the box is hit-tested in its own middle.
import { readAccountAccess, readStandingWarning } from '../harness/account-access-view.mjs';

/* Apple linked with its deletion credential missing: a second driver, so the
   ACCOUNT ACCESS box stays open and the Game Center half can be seen to be the
   only thing withheld. */
const REPAIRABLE = { gameCenterLinked: false, appleLinked: true, appleRevocationReady: false };
const TITLE = 'Game Center cannot be connected';
const MESSAGE = 'Game Center will not identify this player. '
  + 'Check Settings › Game Center and any Screen Time limits on multiplayer.';
const ORANGE = [255, 138, 61];   // --orange, the dealt card's own tint

/* WebKit serializes `color-mix()` as `color(srgb 1 0.54 0.24 / .42)` — 0-1
   floats — while a plain `color:` computes to `rgb(255, 138, 61)`. Same token;
   normalize rather than asserting one engine's spelling of it. */
const isOrange = (channels) => {
  if (!Array.isArray(channels) || channels.length < 3) return false;
  const scale = Math.max(channels[0], channels[1], channels[2]) <= 1 ? 255 : 1;
  return ORANGE.every((value, i) => Math.abs(channels[i] * scale - value) <= 1)
    && (channels[3] ?? 1) > 0;
};

/* Read where the player LANDS, then again at the foot of the panel.
   This profile scrolls — Sign out itself starts below the fold on a 932px
   device once the ACCOUNT ACCESS box is open, and PAST DUELS above it now
   states three duels on every device rather than shrinking to make room — so
   "fully in view" is a claim about the bottom of the panel, where Sign out and
   this box both live. What must hold on arrival is weaker and just as
   load-bearing: the box is real paint, not a ghost under something else. */
const probe = async (page, routes) => {
  const access = await readAccountAccess(page);
  const note = await readStandingWarning(page);
  await page.evaluate(() => {
    const scroller = document.querySelector('#onAccount')?.closest('.pbody');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(120);
  return { access, note, atFoot: await readStandingWarning(page),
           launchModes: routes.gameCenterModes() };
};

export async function runAccountGameCenterBlockedScenarios(suite) {
  const { visit, out, check } = suite;

  /* The device GameKit will not identify, reported on the auth state itself —
     no tap, no refused proof, nothing on the wire. */
  const blocked = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, gameCenterBridge: 'linked', gameCenterPersistent: false,
    skipStandardProbes: true, probe });
  out.gameCenterBlocked = blocked.probeResult;
  const shown = blocked.probeResult ?? {};
  check(blocked.errs.length === 0, 'page errors on the unidentified-player path', blocked.errs);

  /* Game Center needs an identity gateway origin, which Vite INLINES at build
     time — no page-side stub can add one. The launch sign-in exchange is the
     only honest signal of whether this build has one, and without it the
     profile offers Game Center nowhere, so there is no withheld control to
     explain. Assert exactly that, and stop. */
  const configured = (shown.launchModes ?? []).length > 0;
  out.gameCenterBlockedGatewayConfigured = configured;
  if (!configured) {
    check(shown.note?.present === true && shown.note.shown === false,
    'a build that never offers Game Center explained its absence anyway', shown.note);
    check(shown.access?.gameCenterButton?.shown === false,
    'a build with no identity gateway offered a Game Center control', shown.access);
    return;
  }

  const note = shown.note;
  const foot = shown.atFoot;
  /* ON ARRIVAL the profile is now longer than the phone. PAST DUELS states the
     three newest duels on EVERY device (user call 2026-08-28) instead of
     trimming itself row by row against the pinned foot, so the section holds
     its ~127px and this box — like Sign out, which the probe above already
     expects below the fold — starts off-screen on a 430x932 device. That is
     the accepted shape: the shared .pbody scrolls them into reach, and the
     foot reading below is where "fully readable" is proved.
     So hit-testing is asserted exactly where it can answer. elementFromPoint
     returns null outside the viewport, and demanding a hit there would assert
     the retired layout rather than occlusion. A box that IS in view and still
     cannot be touched is a ghost under something else, and still fails. */
  check(note?.shown === true && (note.inView === false || note.hit === true),
  'the standing warning is not paint the player could put a finger on', note);
  check(foot?.shown === true && foot.inView === true && foot.hit === true,
  'the standing warning is never fully readable, even at the foot of the panel', foot);
  check(note?.title === TITLE && note.message === MESSAGE,
  'the standing warning did not say what the device refused', note);

  /* WHERE IT STANDS. After the full-history row (and the recent matches above
     it), below Sign out's own top — measured in BOTH readings, because the
     panel moves under the player: the foot is pinned and everything above it
     scrolls. */
  for (const [where, seen] of [['on arrival', note], ['at the foot', foot]]) {
    check(!!seen?.history && !!seen.signOut
      && seen.rect.top >= seen.history.bottom
      && seen.rect.bottom <= seen.signOut.top,
    `the standing warning did not sit between the match history and Sign out ${where}`, seen);
    check(!seen?.recent || seen.rect.top >= seen.recent.bottom,
    `the standing warning cut into the recent matches above it ${where}`, seen);
  }

  /* NOT A DIALOG. The dealt card announces itself, traps focus and puts a wash
     over the panel; this is a box in the panel and must do none of it. */
  check(note?.role === null && note.modal === null && note.sheets === 0,
  'the standing warning came up as a second modal', note);
  check(note?.focusables === 0 && note.holdsFocus === false,
  'the standing warning took focus, or holds a control that could trap it', note);

  /* THE SAME LANGUAGE AS THE CARD: the amber frame and the lit warning glyph,
     read from paint rather than from the class list. */
  check(isOrange(note?.border) && parseFloat(note?.borderWidth ?? '0') > 0,
  'the standing warning lost the amber outline the dealt card wears',
  { border: note?.border, width: note?.borderWidth });
  check(isOrange(note?.headColor) && note?.glyph === true,
  'the standing warning lost the warning glyph or its colour', note);

  /* NO DEAD END BESIDE IT. The Game Center row and its control are gone, the
     Apple repair this account is still owed is untouched, and nothing was
     asked of the gateway. */
  check(shown.access?.gameCenterButton?.shown === false
    && shown.access.gameCenter?.shown === false,
  'a Game Center control was offered to a player it cannot work for', shown.access);
  check(shown.access?.box?.shown === true && shown.access.appleButton?.shown === true,
  'withholding the Game Center offer swallowed the Apple repair beside it', shown.access);
  check((shown.launchModes ?? []).every((mode) => mode !== 'attach'),
  'the app tried to bind an identifier GameKit will not vouch for', shown.launchModes);

  /* THE OTHER HALF OF THE PROMISE: a device GameKit does vouch for is offered
     the control exactly as before, and is shown no warning at all. */
  const fine = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, gameCenterBridge: 'linked', skipStandardProbes: true, probe });
  out.gameCenterIdentified = fine.probeResult;
  const healthy = fine.probeResult ?? {};
  check(fine.errs.length === 0, 'page errors on the identified-player path', fine.errs);
  check(healthy.access?.gameCenterButton?.shown === true
    && healthy.access.gameCenter?.text === 'Game Center not linked to this account',
  'a player GameKit vouches for lost the Connect Game Center offer', healthy.access);
  check(healthy.note?.present === true && healthy.note.shown === false,
  'a player GameKit vouches for was warned that they cannot connect', healthy.note);

  /* AN OLDER INSTALLED BINARY says nothing about persistence — the plugin is
     compiled into the app and this payload is not. Absent is UNKNOWN, never a
     refusal: standing a warning the device never made would withdraw a control
     that works perfectly on that build. */
  const legacy = await visit({ member: true, named: true, identity: REPAIRABLE,
    appleBridge: true, gameCenterBridge: 'linked', gameCenterPersistent: null,
    skipStandardProbes: true, probe });
  out.gameCenterUnreported = legacy.probeResult;
  const older = legacy.probeResult ?? {};
  check(legacy.errs.length === 0, 'page errors on the older-binary path', legacy.errs);
  check(older.note?.shown === false && older.access?.gameCenterButton?.shown === true,
  'a binary that never reported persistence was treated as having refused', older);
}
