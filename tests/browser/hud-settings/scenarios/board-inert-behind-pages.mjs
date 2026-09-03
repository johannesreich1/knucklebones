/* THE BOARD IS ALWAYS MOUNTED. An opaque page is only paint, so #app kept its
   place in the tab order and the accessibility tree behind Settings, Profile,
   HOW TO PLAY and Home: Tab reached the in-game Leave control and activating it
   opened the forfeit ask from underneath an open page. Sheets, legal pages and
   the group transition had always borrowed inert for the whole background;
   ordinary .ov.paged pages never did.

   Asserted as what a keyboard or assistive user can actually REACH — whether
   focus lands on the control — rather than as an attribute, because the
   attribute is the mechanism and reachability is the report. */
import { waitForOverlayTransitions } from '../../support/overlay-transitions.mjs';

const reach = (page) => page.evaluate(() => {
  const leave = document.getElementById('btnLeave');
  leave?.focus();
  return {
    focused: document.activeElement === leave,
    appInert: !!document.getElementById('app')?.inert,
    top: [...document.querySelectorAll('.ov.on')].map((o) => o.id).join(','),
  };
});

export async function runBoardInertBehindPagesScenarios(suite) {
  const { page, out, check } = suite;
  out.boardInert = {};

  await page.evaluate(() => window.__kb.goHome());
  await page.waitForSelector('#ovStart.on');
  await waitForOverlayTransitions(page, '.ov');
  out.boardInert.home = await reach(page);

  /* It has to HOLD across a page change, not just be set once on open. */
  await page.tap('#btnSettingsHome');
  await page.waitForSelector('#ovSettings.on');
  await waitForOverlayTransitions(page, '.ov');
  out.boardInert.underSettings = await reach(page);
  await page.tap('#btnSettingsBack');
  await page.waitForFunction(() => !document.getElementById('ovSettings')
    ?.classList.contains('on'), null, { timeout: 5000 });
  await waitForOverlayTransitions(page, '.ov');
  out.boardInert.settingsClosed = await reach(page);

  /* THE CONTROL STILL HAS TO WORK IN A GAME. With no overlay the table is the
     screen, and Leave is its one control. */
  await page.evaluate(() => window.__kb.openPractice());
  await page.tap('#btnPlay');
  await page.waitForFunction(() => !document.querySelector('.ov.on:not(#ovLoad)'), null,
    { timeout: 8000 });
  out.boardInert.inGame = await reach(page);

  await page.evaluate(() => window.__kb.goHome());
  await page.waitForSelector('#ovStart.on');
  await waitForOverlayTransitions(page, '.ov');
  out.boardInert.backHome = await reach(page);

  check(out.boardInert.home.appInert && !out.boardInert.home.focused,
    'the in-game Leave control is still reachable behind Home — Tab gets to it '
    + 'and it opens the forfeit ask from under the page', out.boardInert.home);
  check(out.boardInert.underSettings.appInert && !out.boardInert.underSettings.focused,
    'the in-game Leave control is reachable behind Settings',
    out.boardInert.underSettings);
  check(out.boardInert.settingsClosed.appInert && !out.boardInert.settingsClosed.focused,
    'closing Settings back to Home let the board out of reach again',
    out.boardInert.settingsClosed);
  check(!out.boardInert.inGame.appInert && out.boardInert.inGame.focused,
    'THE BOARD IS INERT DURING A GAME — Leave cannot be focused at all',
    out.boardInert.inGame);
  check(out.boardInert.backHome.appInert && !out.boardInert.backHome.focused,
    'leaving a game did not put the board back out of reach', out.boardInert.backHome);
}
