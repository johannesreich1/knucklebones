export async function runSettingsNavigationScenarios(suite) {
  const { page, ctx, F, out, check } = suite;
  // ===== settings panel — a HOME sheet since the HUD became quit-only =====
  await page.evaluate(() => window.__kb.goHome());
  await page.waitForTimeout(300);
  await page.tap('#btnSettingsHome'); await page.waitForTimeout(400);
  out.settingsOpen = await page.evaluate(() => ({
    on: document.getElementById('ovSettings').classList.contains('on'),
    sndOn: document.querySelector('#sndSeg button.on')?.dataset.s,
    faceOn: document.querySelector('#faceSeg button.on')?.dataset.f,
    accessibility: document.getElementById('accessibilityHeading')?.textContent?.trim(),
    accessibilityOrder: (() => {
      const body = document.querySelector('#ovSettings .pbody');
      const heading = document.getElementById('accessibilityHeading');
      const faces = document.getElementById('faceSeg')?.closest('.card');
      const colourBlind = document.getElementById('cbSeg')?.closest('.card');
      return !!body && !!heading && !!faces && !!colourBlind
        && !!(heading.compareDocumentPosition(faces) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!(faces.compareDocumentPosition(colourBlind) & Node.DOCUMENT_POSITION_FOLLOWING)
        && colourBlind.nextElementSibling?.classList.contains('tiny');
    })(),
  }));
  check(out.settingsOpen.on && out.settingsOpen.sndOn === '1' && out.settingsOpen.faceOn === 'pips',
        'settings did not open with current values', out.settingsOpen);
  check(out.settingsOpen.accessibility === 'Accessibility' && out.settingsOpen.accessibilityOrder,
        'accessibility controls are not grouped at the end of Settings', out.settingsOpen);

  await page.tap('#sndSeg button[data-s="0"]'); await page.waitForTimeout(200);
  await page.tap('#faceSeg button[data-f="nums"]'); await page.waitForTimeout(200);
  // Settings holds the two toggles and nothing else — the rules are reached
  // through the HOW TO PLAY hub on home, which is now their ONLY door.
  out.settingsIsToggles = await page.evaluate(() => ({
    how2: !!document.getElementById('btnHow2'),
    quit: !!document.querySelector('#ovSettings #btnMenu'),
    buttons: [...document.querySelectorAll('#ovSettings .pbody .btn')].length,
  }));
  check(!out.settingsIsToggles.how2 && !out.settingsIsToggles.quit && out.settingsIsToggles.buttons === 0,
        'settings still carries a button that belongs elsewhere', out.settingsIsToggles);
  await page.tap('#btnSettingsBack'); await page.waitForTimeout(300);
  await page.tap('#btnLearn'); await page.waitForTimeout(320);
  await page.tap('#btnLearnRules'); await page.waitForTimeout(400);
  out.help = await page.evaluate(() => ({
    rules: document.getElementById('ovRules').classList.contains('on'),
    settings: document.getElementById('ovSettings').classList.contains('on'),
  }));
  check(out.help.rules && !out.help.settings, 'help did not open from the hub', out.help);
  await page.tap('#btnCloseRules'); await page.waitForTimeout(300);

  // Choices persist across reload — but WAIT FOR THE WRITE first: this reload
  // raced the save on CI's slow runner (2026-08-20, same class as test10's).
  // The poll makes the wait deterministic and names the true failure when the
  // save itself never lands.
  await page.waitForFunction(() => {
    try { const d = JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}');
          return d.sound === false && d.numerals === true; }
    catch { return false; }
  }, null, { timeout: 8000 }).catch(() => { /* the check below names the failure */ });
  out.savedSettings = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}');
    return d.sound === false && d.numerals === true;
  });
  check(out.savedSettings, 'settings were never SAVED — the write itself is missing', out);
  // Same reload hazard as test10: over file:// this page is the origin's only
  // document, and its teardown races the storage area's disk commit (CI reds
  // 2026-08-21, defaults-after-reload while the poll above passed). The keeper
  // pins the area across the reload; the read-back is polled, not slept for.
  const keeper = await ctx.newPage();
  await keeper.goto(F);
  await keeper.evaluate(() => localStorage.length);   // binds the storage area
  await page.reload();
  await page.waitForFunction(() => window.__kb?.S?.sound === false && window.__kb.S.numerals === true,
    null, { timeout: 8000 }).catch(() => { /* the check below names the failure */ });
  out.persist = await page.evaluate(() => ({
    sound: window.__kb.S.sound, numerals: window.__kb.S.numerals,
    cls: document.getElementById('kbroot').classList.contains('numerals'),
    ...(window.__kb.S.sound === false ? {} : { raw: localStorage.getItem('knucklebones.v1') }),
  }));
  await keeper.close();
  check(out.persist.sound === false && out.persist.numerals === true && out.persist.cls,
        'settings did not persist', out.persist);

  /* Settings is a HOME sheet now: mid-match the HUD asks one question (quit),
     and sound/dice-faces live where nothing is at stake. */
  await page.evaluate(() => window.__kb.goHome());
  await page.waitForTimeout(300);
  await page.tap('#btnSettingsHome'); await page.waitForTimeout(300);
  out.sheet = await page.evaluate(() => ({
    reset: !!document.getElementById('btnResetStats'),
    done: [...document.querySelectorAll('#ovSettings .btn')].some(b => /done/i.test(b.textContent)),
    back: document.querySelector('#ovSettings .shead #btnSettingsBack')?.textContent ?? '',
    title: document.querySelector('#ovSettings .shead .ttl')?.textContent ?? '',
    quitInSheet: !!document.querySelector('#ovSettings #btnMenu'),
    buildTag: !!document.querySelector('#ovSettings #buildTag'),
  }));
  check(!out.sheet.quitInSheet, 'Quit is still inside the Settings sheet', out.sheet);
  check(out.sheet.buildTag, 'the build tag is not at the bottom of Settings', out.sheet);
  check(!out.sheet.reset, 'Reset record still in Settings', out.sheet);
  check(!out.sheet.done, 'Settings still has a bottom Done button', out.sheet);
  // Settings is a PAGE below Home now (user call, 2026-08-21): ‹ left like
  // OFFLINE and the ladder, not the old sheet ✕ on the right
  check(out.sheet.back === '‹' && out.sheet.title === 'SETTINGS', 'Settings page header wrong', out.sheet);
  await page.tap('#btnSettingsBack'); await page.waitForTimeout(300);
  out.sheetClosed = await page.evaluate(() => !document.getElementById('ovSettings').classList.contains('on'));
  check(out.sheetClosed, 'Settings ‹ did not close the page', out.sheetClosed);

  // ===== the iOS back gesture (ui/swipeback): an edge swipe presses the =====
  // header's own ‹ — same handler as the button, so the two cannot disagree
  const edgeSwipe = () => page.evaluate(() => {
    const mk = (x, y) => new Touch({ identifier: 7, target: document.body, clientX: x, clientY: y });
    const fire = (type, t) => document.body.dispatchEvent(new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true }));
    fire('touchstart', mk(12, 300));
    for (const x of [30, 55, 90]) fire('touchmove', mk(x, 304));
    fire('touchend', mk(90, 304));
  });
  await page.tap('#btnSettingsHome'); await page.waitForTimeout(400);
  await edgeSwipe(); await page.waitForTimeout(500);   // .ov visibility flips .28s after .on drops
  out.swipe = await page.evaluate(() => ({
    on: document.getElementById('ovSettings').classList.contains('on'),
    vis: getComputedStyle(document.getElementById('ovSettings')).visibility,
  }));
  check(!out.swipe.on && out.swipe.vis === 'hidden', 'edge swipe did not close Settings', out.swipe);
  // home is the root — the same swipe there must go nowhere
  await edgeSwipe(); await page.waitForTimeout(300);
  out.swipeHome = await page.evaluate(() =>
    [...document.querySelectorAll('.ov.on')].map(o => o.id).join(','));
  check(out.swipeHome === 'ovStart', 'edge swipe on home navigated somewhere', out.swipeHome);

}
