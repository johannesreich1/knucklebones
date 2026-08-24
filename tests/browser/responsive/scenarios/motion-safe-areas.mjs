export async function runMotionSafeAreaScenarios(suite) {
  const { browser, devices, F, errs, out, check, markExperienced } = suite;
  // ================= REDUCED MOTION =================
  const rm = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true,
    reducedMotion: 'reduce', locale: 'en-US' });
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
  await rp.tap('#faceSeg button[data-f="nums"]'); await rp.waitForTimeout(100);
  await rp.tap('#btnSettingsBack'); await rp.waitForTimeout(200);
  await rp.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
  // Force the human opener so this measures the shared roll/placement view,
  // not an AI thinking delay. Reduced motion must resolve the face without
  // the JavaScript scramble and commit a tapped die without a flying ghost.
  await rp.evaluate(() => { window.__kb.S.starter = 1; });
  const rollStarted = Date.now();
  await rp.tap('#btnPlay');
  await rp.waitForFunction(() => window.__kb.S.phase === 'choose'
    && !!document.querySelector('#dieStage > .die'), null, { timeout: 1800 })
    .catch(() => { /* the measured check below names the failure */ });
  out.reducedRoll = await rp.evaluate((started) => ({
    elapsed: Date.now() - started,
    phase: window.__kb.S.phase,
    value: Number(document.querySelector('#dieStage > .die')?.dataset.v ?? 0),
    rolling: document.getElementById('dieStage').classList.contains('rolling'),
    activeAnimations: document.getElementById('dieStage').getAnimations({ subtree: true })
      .filter((animation) => animation.playState === 'running').length,
  }), rollStarted);

  /* Reduced motion removes the ordinary attention rings, not information a
     player explicitly requested by arming a spell. Read the painted pseudo
     elements because a class-only assertion cannot tell whether either ring
     is actually visible. */
  out.reducedHints = await rp.evaluate(() => {
    const root = document.getElementById('kbroot');
    const legal = document.querySelector('#botBoard .col.legal');
    const danger = document.querySelector('#topBoard .col');
    const ordinary = getComputedStyle(legal, '::after').display;
    danger.classList.add('danger');
    const destruction = getComputedStyle(danger, '::before').display;
    root.classList.add('casting');
    legal.classList.add('aim');
    const aimed = getComputedStyle(legal, '::after');
    const spell = {
      display: aimed.display,
      borderWidth: parseFloat(aimed.borderTopWidth),
      borderStyle: aimed.borderTopStyle,
    };
    legal.classList.remove('aim');
    root.classList.remove('casting');
    danger.classList.remove('danger');
    /* A protected legal column normally moves that hint onto its seal. Under
       reduced motion it must look exactly like the same resting ward, while
       the ward itself remains visible. */
    legal.classList.add('warded');
    const wardLine = legal.querySelector('.seal .sa');
    const wardedLegal = {
      seal: getComputedStyle(legal.querySelector('.seal')).display,
      stroke: getComputedStyle(wardLine).strokeWidth,
      filter: getComputedStyle(wardLine).filter,
    };
    legal.classList.remove('legal');
    const wardedRest = {
      stroke: getComputedStyle(wardLine).strokeWidth,
      filter: getComputedStyle(wardLine).filter,
    };
    legal.classList.add('legal');
    legal.classList.remove('warded');
    return { ordinary, destruction, spell, wardedLegal, wardedRest };
  });

  const beforePlacement = await rp.evaluate(() => {
    const score = document.getElementById('totBot');
    const rect = score.getBoundingClientRect();
    return {
      dice: window.__kb.S.boards[1][0].length,
      score: { height: rect.height, fontSize: getComputedStyle(score).fontSize },
    };
  });
  await rp.tap('#botBoard .col[data-col="0"]');
  await rp.waitForTimeout(50);
  out.reducedPlacement = await rp.evaluate((before) => {
    const slot = document.querySelector('#botBoard .col[data-col="0"] .slot:last-of-type');
    const die = document.querySelector('#botBoard .col[data-col="0"] .slot .die');
    const dieRect = die?.getBoundingClientRect();
    const slotRect = die?.parentElement?.getBoundingClientRect();
    const score = document.getElementById('totBot');
    const scoreRect = score.getBoundingClientRect();
    const point = document.querySelector('#botBoard .col[data-col="0"] .pts');
    const numeral = die?.querySelector('.num');
    const inkRect = (element) => {
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    const pointRect = inkRect(point);
    const pointBox = point?.getBoundingClientRect();
    const numeralRect = inkRect(numeral);
    return {
      before: before.dice,
      after: window.__kb.S.boards[1][0].length,
      ghost: !!document.querySelector('#kbroot > .die'),
      settling: !!die?.classList.contains('settle'),
      centred: !!dieRect && !!slotRect
        && Math.abs((dieRect.left + dieRect.width / 2) - (slotRect.left + slotRect.width / 2)) < .5
        && Math.abs((dieRect.top + dieRect.height / 2) - (slotRect.top + slotRect.height / 2)) < .5,
      slotPresent: !!slot,
      score: {
        bumping: document.getElementById('plateBot').classList.contains('bump'),
        heightBefore: before.score.height,
        heightAfter: scoreRect.height,
        fontSizeBefore: before.score.fontSize,
        fontSizeAfter: getComputedStyle(score).fontSize,
        transform: getComputedStyle(score).transform,
      },
      point: pointRect && pointBox && numeralRect && dieRect ? {
        text: point.textContent,
        numeralDisplay: getComputedStyle(numeral).display,
        inside: pointBox.top >= dieRect.top - .5 && pointBox.bottom <= dieRect.bottom + .5
          && pointBox.left >= dieRect.left - .5 && pointBox.right <= dieRect.right + .5,
        edgeInset: pointBox.top - dieRect.top,
        halfGap: dieRect.top + dieRect.height / 2 - pointBox.bottom,
        gap: numeralRect.top - pointRect.bottom,
        centreError: Math.abs((pointRect.left + pointRect.width / 2)
          - (numeralRect.left + numeralRect.width / 2)),
      } : null,
    };
  }, beforePlacement);

  /* The far face-to-face seat is the distinct floatPts branch: its die and
     feedback both turn, and the score leaves through the physical bottom of
     the die so it remains the player's reading-top edge. Exercise the real
     placement path rather than a private effect hook. */
  out.reducedFarPoint = await rp.evaluate(async () => {
    const k = window.__kb;
    k.S.gen += 1;                 // cancel the near placement's continuation
    k.S.mode = 'duo';
    k.S.seat = 'face';
    k.S.timer = 0;
    k.S.bottom = 1;
    k.S.turn = 0;
    k.S.phase = 'choose';
    k.S.busy = false;
    k.S.die = 4;
    k.S.boards = [[[], [], []], [[], [], []]];
    k.applySides();
    k.setStageDie(4, 0);
    k.showHints();
    await k.place(0, 0);

    const die = document.querySelector('#topBoard .col[data-col="0"] .die');
    const point = document.querySelector('#topBoard .col[data-col="0"] .pts');
    const numeral = die?.querySelector('.num');
    const inkRect = (element) => {
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    const dieRect = die?.getBoundingClientRect();
    const pointBox = point?.getBoundingClientRect();
    const pointInk = inkRect(point);
    const numeralInk = inkRect(numeral);
    const matrix = point ? new DOMMatrix(getComputedStyle(point).transform) : null;
    return dieRect && pointBox && pointInk && numeralInk && matrix ? {
      text: point.textContent,
      numeralDisplay: getComputedStyle(numeral).display,
      turned: matrix.a < -.99 && matrix.d < -.99,
      inside: pointBox.top >= dieRect.top - .5 && pointBox.bottom <= dieRect.bottom + .5
        && pointBox.left >= dieRect.left - .5 && pointBox.right <= dieRect.right + .5,
      edgeInset: dieRect.bottom - pointBox.bottom,
      halfGap: pointBox.top - (dieRect.top + dieRect.height / 2),
      gap: pointInk.top - numeralInk.bottom,
      centreError: Math.abs((pointInk.left + pointInk.width / 2)
        - (numeralInk.left + numeralInk.width / 2)),
    } : null;
  });

  /* Minus feedback uses the same numeral header, but it belongs to a real
     victim rather than the last surviving die in that column. Use a stack
     where the matched 5 is not last so a wrong anchor cannot accidentally
     pass the geometry check. */
  out.reducedMinusPoint = await rp.evaluate(async () => {
    const k = window.__kb;
    k.S.gen += 1;
    k.S.mode = 'duo';
    k.S.seat = 'pass';
    k.S.scoring = 0;
    k.S.timer = 0;
    k.S.bottom = 1;
    k.S.turn = 1;
    k.S.phase = 'choose';
    k.S.busy = false;
    k.S.die = 5;
    k.S.boards = [[[5, 2], [], []], [[], [], []]];
    k.S.charm.wards = [[0, 0, 0], [0, 0, 0]];
    k.applySides();
    k.renderAll(false);
    k.setStageDie(5, 1);
    k.showHints();
    const placement = k.place(1, 0);
    let point = null;
    for (let tick = 0; tick < 60; tick++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      point = [...document.querySelectorAll('#topBoard .pts')]
        .find((node) => node.textContent.startsWith('−'));
      if (point) break;
    }
    const victim = document.querySelector('#topBoard .col[data-col="0"] .slot[data-slot="2"] .die');
    const survivor = document.querySelector('#topBoard .col[data-col="0"] .slot[data-slot="1"] .die');
    const numeral = victim?.querySelector('.num');
    const inkRect = (element) => {
      if (!element) return null;
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect();
    };
    const dieRect = victim?.getBoundingClientRect();
    const survivorRect = survivor?.getBoundingClientRect();
    const pointBox = point?.getBoundingClientRect();
    const pointInk = inkRect(point);
    const numeralInk = inkRect(numeral);
    const result = dieRect && survivorRect && pointBox && pointInk && numeralInk ? {
      text: point.textContent,
      victim: numeral.textContent,
      survivor: survivor.querySelector('.num')?.textContent,
      victimOpacity: getComputedStyle(victim).opacity,
      inside: pointBox.top >= dieRect.top - .5 && pointBox.bottom <= dieRect.bottom + .5
        && pointBox.left >= dieRect.left - .5 && pointBox.right <= dieRect.right + .5,
      edgeInset: pointBox.top - dieRect.top,
      halfGap: dieRect.top + dieRect.height / 2 - pointBox.bottom,
      gap: numeralInk.top - pointInk.bottom,
      victimCentreError: Math.abs((pointInk.left + pointInk.width / 2)
        - (numeralInk.left + numeralInk.width / 2)),
      survivorDistance: Math.hypot(
        (pointInk.left + pointInk.width / 2) - (survivorRect.left + survivorRect.width / 2),
        (pointInk.top + pointInk.height / 2) - (survivorRect.top + survivorRect.height / 2)),
    } : null;
    k.S.gen += 1;
    await placement;
    return result;
  });
  out.reduced = await rp.evaluate(() => ({
    jsFlag: window.__kb.reduced,
    particlesAfterBurst: (window.__kb.burst(100, 100, '#fff', 20), document.querySelectorAll('#fx .particle').length),
    playable: window.__kb.S.phase,
  }));
  check(out.reduced.jsFlag === true, 'reduced-motion not detected in JS', out.reduced);
  check(out.reduced.particlesAfterBurst === 0, 'particles still spawn under reduced motion', out.reduced);
  check(out.reducedRoll.phase === 'choose' && out.reducedRoll.value >= 1
    && out.reducedRoll.elapsed < 950 && !out.reducedRoll.rolling
    && out.reducedRoll.activeAnimations === 0,
  'reduced motion did not reveal the settled roll immediately', out.reducedRoll);
  check(out.reducedPlacement.after === out.reducedPlacement.before + 1
    && !out.reducedPlacement.ghost && !out.reducedPlacement.settling
    && out.reducedPlacement.centred && out.reducedPlacement.slotPresent,
  'reduced motion did not place the die directly in its slot', out.reducedPlacement);
  check(out.reducedHints.ordinary === 'none' && out.reducedHints.destruction === 'none'
    && out.reducedHints.spell.display === 'block' && out.reducedHints.spell.borderWidth > 0
    && out.reducedHints.spell.borderStyle === 'dashed'
    && out.reducedHints.wardedLegal.seal !== 'none'
    && out.reducedHints.wardedLegal.stroke === out.reducedHints.wardedRest.stroke
    && out.reducedHints.wardedLegal.filter === out.reducedHints.wardedRest.filter,
  'reduced motion did not hide ordinary hints while preserving a spell target', out.reducedHints);
  check(out.reducedPlacement.score.bumping
    && Math.abs(out.reducedPlacement.score.heightAfter - out.reducedPlacement.score.heightBefore) < .1
    && out.reducedPlacement.score.fontSizeAfter === out.reducedPlacement.score.fontSizeBefore
    && out.reducedPlacement.score.transform === 'none',
  'a score still changes size when it updates with motion reduced', out.reducedPlacement.score);
  check(out.reducedPlacement.point?.text.startsWith('+')
    && out.reducedPlacement.point.numeralDisplay === 'flex'
    && out.reducedPlacement.point.inside
    && out.reducedPlacement.point.edgeInset >= 2.5
    && out.reducedPlacement.point.edgeInset <= 4.5
    && out.reducedPlacement.point.halfGap >= 1
    && out.reducedPlacement.point.gap >= -5
    && out.reducedPlacement.point.centreError <= 1.5,
  'numbered-die score feedback is not inside the die above its numeral', out.reducedPlacement.point);
  check(out.reducedFarPoint?.text.startsWith('+')
    && out.reducedFarPoint.numeralDisplay === 'flex'
    && out.reducedFarPoint.turned
    && out.reducedFarPoint.inside
    && out.reducedFarPoint.edgeInset >= 2.5
    && out.reducedFarPoint.edgeInset <= 4.5
    && out.reducedFarPoint.halfGap >= 1
    && out.reducedFarPoint.gap >= -5
    && out.reducedFarPoint.centreError <= 1.5,
  'top-seat numbered-die feedback is not inside its reading edge', out.reducedFarPoint);
  check(out.reducedMinusPoint?.text === '−5'
    && out.reducedMinusPoint.victim === '5' && out.reducedMinusPoint.survivor === '2'
    && +out.reducedMinusPoint.victimOpacity > .95
    && out.reducedMinusPoint.inside
    && out.reducedMinusPoint.edgeInset >= 2.5 && out.reducedMinusPoint.edgeInset <= 4.5
    && out.reducedMinusPoint.halfGap >= 1 && out.reducedMinusPoint.gap >= -5
    && out.reducedMinusPoint.victimCentreError <= 1.5
    && out.reducedMinusPoint.survivorDistance > 20,
  'minus feedback is not inside the destroyed numbered die', out.reducedMinusPoint);
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
  const manual = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true,
    locale: 'en-US' });
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
    const sc = await browser.newContext({ viewport: { width: d.w, height: d.h }, hasTouch: true,
      isMobile: true, deviceScaleFactor: 3, locale: 'en-US' });
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
