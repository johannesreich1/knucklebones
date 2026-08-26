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
    motionOn: document.querySelector('#motionSeg button.on')?.dataset.rm,
    segmentOrder: {
      sound: [...document.querySelectorAll('#sndSeg button')].map((button) => button.dataset.s),
      faces: [...document.querySelectorAll('#faceSeg button')].map((button) => button.dataset.f),
      colourBlind: [...document.querySelectorAll('#cbSeg button')].map((button) => button.dataset.b),
      motion: [...document.querySelectorAll('#motionSeg button')].map((button) => button.dataset.rm),
    },
    accessibility: document.getElementById('accessibilityHeading')?.textContent?.trim(),
    languageFirst: document.querySelector('#ovSettings .pbody')?.firstElementChild
      === document.getElementById('languagePicker')?.closest('.card'),
    accessibilityOrder: (() => {
      const body = document.querySelector('#ovSettings .pbody');
      const heading = document.getElementById('accessibilityHeading');
      const sound = document.getElementById('sndSeg')?.closest('.card');
      const faces = document.getElementById('faceSeg')?.closest('.card');
      const colourBlind = document.getElementById('cbSeg')?.closest('.card');
      const motion = document.getElementById('motionSeg')?.closest('.card');
      return !!body && !!heading && !!sound && !!faces && !!colourBlind && !!motion
        && !!(sound.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!(heading.compareDocumentPosition(faces) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!(faces.compareDocumentPosition(colourBlind) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!(colourBlind.compareDocumentPosition(motion) & Node.DOCUMENT_POSITION_FOLLOWING)
        && motion === body.lastElementChild;
    })(),
    accessibilityHelp: ['faceSeg', 'cbSeg', 'motionSeg'].flatMap((id) => {
      const card = document.getElementById(id)?.closest('.card');
      return [...(card?.querySelectorAll('.tiny') ?? [])]
        .map((node) => node.textContent?.trim()).filter(Boolean);
    }),
    sectionSpacing: (() => {
      const opponentColour = document.getElementById('p2Pick')?.closest('.card')?.getBoundingClientRect();
      const sound = document.getElementById('sndSeg')?.closest('.card')?.getBoundingClientRect();
      const heading = document.getElementById('accessibilityHeading')?.getBoundingClientRect();
      return opponentColour && sound && heading ? {
        aboveSound: sound.top - opponentColour.bottom,
        aboveAccessibility: heading.top - sound.bottom,
        colourNote: !!document.getElementById('colNote'),
      } : null;
    })(),
    instantMessage: [...document.querySelectorAll('#ovSettings .pbody .tiny')]
      .some((node) => /changes apply/i.test(node.textContent ?? '')),
  }));
  check(out.settingsOpen.on && out.settingsOpen.sndOn === '1' && out.settingsOpen.faceOn === 'pips'
    && out.settingsOpen.motionOn === '0',
        'settings did not open with current values', out.settingsOpen);
  check(JSON.stringify(out.settingsOpen.segmentOrder) === JSON.stringify({
    sound: ['1', '0'], faces: ['nums', 'pips'], colourBlind: ['1', '0'], motion: ['1', '0'],
  }), 'default Settings choices are not right-aligned, or Sound order changed', out.settingsOpen);
  check(out.settingsOpen.languageFirst,
        'Language is not the first control in Settings', out.settingsOpen);
  check(out.settingsOpen.accessibility === 'Accessibility' && out.settingsOpen.accessibilityOrder,
        'Sound is not above the grouped accessibility controls', out.settingsOpen);
  check(out.settingsOpen.accessibilityHelp.length === 0,
        'accessibility controls still have explanatory copy below their buttons', out.settingsOpen);
  check(out.settingsOpen.sectionSpacing && !out.settingsOpen.sectionSpacing.colourNote
    && out.settingsOpen.sectionSpacing.aboveAccessibility > out.settingsOpen.sectionSpacing.aboveSound + 8,
        'the section spacing is not attached to the Accessibility heading', out.settingsOpen);
  check(!out.settingsOpen.instantMessage, 'the redundant instant-apply message is still in Settings', out.settingsOpen);

  /* Playwright may scroll the bounded Settings body just enough to tap a
     near-bottom segment once the legal footer is present. Compare the
     heading's content coordinate, not its transient viewport coordinate. */
  const accessibilityTop = () => page.$eval('#accessibilityHeading', (heading) => {
    const body = heading.closest('.pbody');
    return heading.getBoundingClientRect().top + (body?.scrollTop ?? 0);
  });
  const topBeforeColourBlind = await accessibilityTop();
  await page.tap('#cbSeg button[data-b="1"]'); await page.waitForTimeout(150);
  out.colourBlindLocks = await page.evaluate(() => [...document.querySelectorAll('#ovSettings .hues')].map((picker) => {
    const lock = picker.querySelector('.hues-lock');
    const lockBox = lock?.getBoundingClientRect();
    const buttons = [...picker.querySelectorAll('button[data-h]')];
    const first = buttons[0]?.getBoundingClientRect();
    const last = buttons.at(-1)?.getBoundingClientRect();
    const icon = lock?.querySelector('.hues-lock__icon');
    const iconBox = icon?.getBoundingClientRect();
    const shackleBox = lock?.querySelector('.hues-lock__shackle')?.getBoundingClientRect();
    const centreTarget = lockBox
      ? document.elementFromPoint(lockBox.x + lockBox.width / 2, lockBox.y + lockBox.height / 2)
      : null;
    return {
      picker: picker.id,
      text: lock?.textContent?.trim(),
      visible: !!lockBox && lockBox.width > 0 && lockBox.height > 0
        && getComputedStyle(lock).visibility === 'visible',
      coversRow: !!lockBox && !!first && !!last
        && lockBox.left <= first.left && lockBox.right >= last.right
        && lockBox.top <= first.top && lockBox.bottom >= first.bottom,
      blocksCentre: !!lock && !!centreTarget && (centreTarget === lock || lock.contains(centreTarget)),
      iconCentreError: iconBox && shackleBox
        ? Math.abs((iconBox.left + iconBox.width / 2) - (shackleBox.left + shackleBox.width / 2))
        : null,
      disabled: buttons.length > 0 && buttons.every((button) => button.disabled),
      ariaDisabled: picker.getAttribute('aria-disabled'),
    };
  }));
  check(out.colourBlindLocks.length === 2 && out.colourBlindLocks.every((lock) =>
    lock.text === 'Colour-blind mode · cyan + gold' && lock.visible && lock.coversRow
      && lock.blocksCentre && lock.iconCentreError !== null && lock.iconCentreError <= 0.25
      && lock.disabled && lock.ariaDisabled === 'true'),
  'colour-blind mode does not clearly cover and explain both locked colour pickers',
  out.colourBlindLocks);
  const topWithColourBlind = await accessibilityTop();
  await page.tap('#cbSeg button[data-b="0"]'); await page.waitForTimeout(150);
  out.colourBlindLocksOff = await page.evaluate(() => ({
    hidden: [...document.querySelectorAll('#ovSettings .hues-lock')]
      .every((lock) => lock.hidden && lock.getBoundingClientRect().width === 0),
    unlocked: [...document.querySelectorAll('#ovSettings .hues')]
      .every((picker) => picker.getAttribute('aria-disabled') === 'false'
        && [...picker.querySelectorAll('button[data-h]')].some((button) => !button.disabled)),
  }));
  check(out.colourBlindLocksOff.hidden && out.colourBlindLocksOff.unlocked,
        'colour picker overlays or locks remain after colour-blind mode is switched off',
        out.colourBlindLocksOff);
  const topAfterColourBlind = await accessibilityTop();
  out.accessibilityStable = { topBeforeColourBlind, topWithColourBlind, topAfterColourBlind };
  check(Math.max(...Object.values(out.accessibilityStable)) - Math.min(...Object.values(out.accessibilityStable)) < 0.5,
        'Accessibility jumps when the colour-blind note appears', out.accessibilityStable);

  await page.tap('#sndSeg button[data-s="0"]'); await page.waitForTimeout(200);
  await page.tap('#faceSeg button[data-f="nums"]'); await page.waitForTimeout(200);
  // Settings holds preferences rather than navigation actions — the rules are
  // reached through the HOW TO PLAY hub on home, which is now their ONLY door.
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
  out.help = await page.evaluate(() => {
    const rules = document.getElementById('ovRules');
    const head = rules?.querySelector('.shead');
    const buttons = [...(head?.querySelectorAll('button') ?? [])];
    const back = head?.querySelector('[data-learn-back="ovRules"]');
    return {
      rules: rules?.classList.contains('on') ?? false,
      learn: document.getElementById('ovLearn').classList.contains('on'),
      settings: document.getElementById('ovSettings').classList.contains('on'),
      nav: {
        buttons: buttons.length,
        backs: head?.querySelectorAll('[data-learn-back="ovRules"]').length ?? 0,
        glyph: back?.textContent?.trim() ?? '',
        label: back?.getAttribute('aria-label') ?? '',
        left: head?.firstElementChild === back,
        noX: !buttons.some((button) => button.textContent?.includes('✕')),
      },
    };
  });
  check(out.help.rules && !out.help.settings, 'help did not open from the hub', out.help);
  check(out.help.learn && out.help.nav.buttons === 1 && out.help.nav.backs === 1
    && out.help.nav.glyph === '‹' && out.help.nav.label === 'Back'
    && out.help.nav.left && out.help.nav.noX,
        'Rules does not use the one shared Learn-page Back header', out.help);
  await page.tap('[data-learn-back="ovRules"]'); await page.waitForTimeout(300);
  out.helpBack = await page.evaluate(() => ({
    rules: document.getElementById('ovRules').classList.contains('on'),
    learn: document.getElementById('ovLearn').classList.contains('on'),
  }));
  check(!out.helpBack.rules && out.helpBack.learn,
        'Rules Back did not return to HOW TO PLAY without closing it', out.helpBack);

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
    placeholderLegalDoors: document.querySelectorAll('#ovSettings [data-legal-open]').length,
    homeFoot: !!document.querySelector('#ovStart > .viewfoot'),
  }));
  check(!out.sheet.quitInSheet, 'Quit is still inside the Settings sheet', out.sheet);
  check(out.sheet.buildTag, 'the build tag is not at the bottom of Settings', out.sheet);
  check(out.sheet.placeholderLegalDoors === 2,
    'Settings does not expose exactly the approved Imprint/Privacy placeholder doors', out.sheet);
  check(out.sheet.homeFoot,
    'draft legal publication removed Home structural spacing', out.sheet);
  check(!out.sheet.reset, 'Reset record still in Settings', out.sheet);
  check(!out.sheet.done, 'Settings still has a bottom Done button', out.sheet);
  // Settings is a PAGE below Home now (user call, 2026-08-21): ‹ left like
  // OFFLINE and the ladder, not the old sheet ✕ on the right
  check(out.sheet.back === '‹' && out.sheet.title === 'SETTINGS', 'Settings page header wrong', out.sheet);
  /* Public routes stay fail-closed, while the owner-approved in-app placeholder
     doors use the same controller and final Settings placement. */
  out.settingsLegal = await page.evaluate(() => {
    const footer = document.querySelector('#ovSettings .settings-foot');
    const buttons = [...footer.querySelectorAll('[data-legal-open]')];
    const footBox = footer.getBoundingClientRect();
    const viewBox = document.getElementById('ovSettings').getBoundingClientRect();
    return {
      pages: buttons.map((button) => button.dataset.legalOpen),
      beforeBuild: footer.querySelector('.legal-settings-nav')?.nextElementSibling?.id === 'buildTag',
      atBottom: Math.abs(footBox.bottom - viewBox.bottom) <= 2,
      targets: buttons.map((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { width: box.width, height: box.height, hit: hit === button || button.contains(hit) };
      }),
    };
  });
  check(out.settingsLegal.pages.join() === 'imprint,privacy' && out.settingsLegal.beforeBuild
    && out.settingsLegal.atBottom
    && out.settingsLegal.targets.every((target) => target.width >= 44 && target.height >= 44 && target.hit),
  'placeholder legal doors are not a reachable Imprint/Privacy pair at the Settings bottom', out.settingsLegal);
  await page.tap('#btnSettingsPrivacy'); await page.waitForTimeout(100);
  out.settingsPrivacy = await page.evaluate(() => {
    const overlay = document.getElementById('ovPrivacy');
    const heading = overlay.querySelector('h1');
    const box = heading.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      open: overlay.classList.contains('on'),
      topmost: !!hit && overlay.contains(hit),
      settingsInert: document.getElementById('ovSettings').inert,
    };
  });
  check(out.settingsPrivacy.open && out.settingsPrivacy.topmost && out.settingsPrivacy.settingsInert,
    'Privacy did not open above Settings as the active modal', out.settingsPrivacy);
  await page.tap('#ovPrivacy [data-legal-close]');
  /* Production restores the opener on the next animation frame. Wait for that
     player-visible state instead of assuming a busy browser paints within an
     arbitrary 50ms sleep; retain a short bound so a real focus loss fails. */
  await page.waitForFunction(() => document.activeElement?.id === 'btnSettingsPrivacy'
    && document.getElementById('ovSettings').classList.contains('on')
    && !document.getElementById('ovSettings').inert, null, { timeout: 1000 }).catch(() => {});
  out.settingsPrivacy.focusRestored = await page.evaluate(() =>
    document.activeElement?.id === 'btnSettingsPrivacy'
      && document.getElementById('ovSettings').classList.contains('on')
      && !document.getElementById('ovSettings').inert);
  check(out.settingsPrivacy.focusRestored,
    'closing Privacy did not restore the Settings door and page', out.settingsPrivacy);
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
