export async function runMotionSafeAreaScenarios(suite) {
  const { browser, devices, F, errs, out, check, markExperienced } = suite;
  // ================= REDUCED MOTION =================
  const rm = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  await markExperienced(rm);   // an experienced player: the first-run tutorial offer is test19's subject
  const rp = await rm.newPage();
  rp.on('pageerror', e => errs.push('RM: ' + e.message));
  await rp.goto(F); await rp.waitForTimeout(400);
  await rp.tap('#btnSettingsHome'); await rp.waitForTimeout(250);
  out.reducedSystemDefault = await rp.evaluate(() => ({
    state: window.__kb.S.reducedMotion,
    jsFlag: window.__kb.reduced,
    rootClass: document.getElementById('kbroot').classList.contains('reduce-motion'),
    selected: document.querySelector('#motionSeg button.on')?.dataset.rm,
  }));
  await rp.tap('#motionSeg button[data-rm="0"]'); await rp.waitForTimeout(100);
  out.reducedSystemOverride = await rp.evaluate(() => ({
    state: window.__kb.S.reducedMotion,
    jsFlag: window.__kb.reduced,
    rootClass: document.getElementById('kbroot').classList.contains('reduce-motion'),
    selected: document.querySelector('#motionSeg button.on')?.dataset.rm,
    ambient: getComputedStyle(document.getElementById('bg'), '::before').animationName,
    particlesAfterBurst: (window.__kb.burst(100, 100, '#fff', 4), document.querySelectorAll('#fx .particle').length),
  }));
  await rp.evaluate(() => document.querySelectorAll('#fx .particle').forEach((particle) => particle.remove()));
  await rp.tap('#motionSeg button[data-rm="1"]'); await rp.waitForTimeout(100);
  await rp.tap('#btnSettingsBack'); await rp.waitForTimeout(200);
  await rp.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
  await rp.tap('#btnPlay'); await rp.waitForTimeout(2500);
  out.reduced = await rp.evaluate(() => ({
    jsFlag: window.__kb.reduced,
    particlesAfterBurst: (window.__kb.burst(100, 100, '#fff', 20), document.querySelectorAll('#fx .particle').length),
    playable: window.__kb.S.phase,
  }));
  check(out.reduced.jsFlag === true, 'reduced-motion not detected in JS', out.reduced);
  check(out.reduced.particlesAfterBurst === 0, 'particles still spawn under reduced motion', out.reduced);
  check(out.reducedSystemDefault.state === null && out.reducedSystemDefault.jsFlag
    && out.reducedSystemDefault.rootClass && out.reducedSystemDefault.selected === '1',
    'the Reduced Motion toggle did not initialize from the OS default', out.reducedSystemDefault);
  check(out.reducedSystemOverride.state === false && !out.reducedSystemOverride.jsFlag
    && !out.reducedSystemOverride.rootClass && out.reducedSystemOverride.selected === '0'
    && out.reducedSystemOverride.ambient !== 'none' && out.reducedSystemOverride.particlesAfterBurst > 0,
    'an explicit in-app OFF did not override the OS reduced-motion default', out.reducedSystemOverride);
  await rm.close();

  // The in-app opt-in reaches the SAME effective flag and CSS state, persists,
  // and does not depend on a browser context emulating the OS preference.
  const manual = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
  await markExperienced(manual);
  const mp = await manual.newPage();
  mp.on('pageerror', e => errs.push('RM SETTING: ' + e.message));
  await mp.goto(F); await mp.waitForTimeout(400);
  await mp.tap('#btnSettingsHome'); await mp.waitForTimeout(300);
  await mp.tap('#motionSeg button[data-rm="1"]'); await mp.waitForTimeout(150);
  out.reducedSetting = await mp.evaluate(() => ({
    state: window.__kb.S.reducedMotion,
    jsFlag: window.__kb.reduced,
    rootClass: document.getElementById('kbroot').classList.contains('reduce-motion'),
    selected: document.querySelector('#motionSeg button.on')?.dataset.rm,
    ambient: getComputedStyle(document.getElementById('bg'), '::before').animationName,
    particlesAfterBurst: (window.__kb.burst(100, 100, '#fff', 20), document.querySelectorAll('#fx .particle').length),
  }));
  await mp.waitForFunction(() => {
    try { return JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}').reducedMotion === true; }
    catch { return false; }
  });
  await mp.reload(); await mp.waitForTimeout(300);
  out.reducedSetting.persisted = await mp.evaluate(() => window.__kb.S.reducedMotion
    && window.__kb.reduced && document.getElementById('kbroot').classList.contains('reduce-motion'));
  check(out.reducedSetting.state && out.reducedSetting.jsFlag && out.reducedSetting.rootClass
    && out.reducedSetting.selected === '1' && out.reducedSetting.ambient === 'none'
    && out.reducedSetting.particlesAfterBurst === 0 && out.reducedSetting.persisted,
    'the Reduced Motion setting did not apply or persist across JS and CSS', out.reducedSetting);
  await manual.close();

  // ================= SAFE AREAS (notched phones, PWA + native shell) =================
  // fit() sizes the cell from #app.clientHeight, which INCLUDES #app's padding —
  // and that padding carries the Dynamic Island and home-indicator strips. Counted
  // as usable, the board grew until the near nameplate sat UNDER the home
  // indicator: measured 9px under on a 390x844 iPhone, 10px on a 375x812. The cell
  // cap hid it on the largest phones, which is why it survived so long.
  const SAFE_DEVICES = [
    { w: 375, h: 812, top: 47, bottom: 34, name: 'iPhone X / 13 mini' },
    { w: 390, h: 844, top: 47, bottom: 34, name: 'iPhone 14 / 15 / 16' },
    { w: 440, h: 956, top: 62, bottom: 34, name: 'iPhone 17 Pro Max' },
  ];
  out.safeAreas = [];
  for (const d of SAFE_DEVICES) {
    const sc = await browser.newContext({ viewport: { width: d.w, height: d.h }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  await markExperienced(sc);   // an experienced player: the first-run tutorial offer is test19's subject
    const sp = await sc.newPage();
    sp.on('pageerror', e => errs.push('SAFE: ' + e.message));
    await sp.goto(F); await sp.waitForTimeout(400);
    await sp.evaluate(() => window.__kb.openPractice());
    await sp.tap('#btnPlay'); await sp.waitForTimeout(1500);
    const r = await sp.evaluate(([top, bottom, h]) => {
      // emulate the device insets the way iOS hands them to env(safe-area-inset-*)
      const app = document.getElementById('app');
      app.style.paddingTop = `calc(${top}px + 6px)`;
      app.style.paddingBottom = `calc(${bottom}px + 6px)`;
      window.__kb.fit();
      const hud = document.querySelector('.hud').getBoundingClientRect();
      const plate = document.getElementById('plateBot').getBoundingClientRect();
      return { cell: parseFloat(getComputedStyle(document.getElementById('kbroot')).getPropertyValue('--cell')),
               clearTop: +(hud.top - top).toFixed(1), clearBottom: +((h - bottom) - plate.bottom).toFixed(1) };
    }, [d.top, d.bottom, d.h]);
    out.safeAreas.push({ name: d.name, ...r });
    check(r.clearBottom >= 0, `${d.name}: board runs under the home indicator`, r);
    check(r.clearTop >= 0, `${d.name}: hud runs under the notch`, r);
    await sc.close();
  }

}
