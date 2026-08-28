import {
  beginReducedRollProbe,
  readReducedRollProbe,
  reloadReducedMotionWithKeeper,
} from '../harness/reduced-motion-support.mjs';
import {
  readDestroyedDieFeedback,
  readFarSeatFeedback,
} from '../harness/numeral-feedback-probe.mjs';

export async function runReducedMotionScenarios(suite) {
  const { browser, devices, F, errs, out, check, markExperienced } = suite;
  // ================= REDUCED MOTION =================
  const rm = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true,
    reducedMotion: 'reduce', locale: 'en-US' });
  await markExperienced(rm);   // an experienced player: tests/first-run-offer.mjs owns the first-run offer
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
  const rollStarted = await beginReducedRollProbe(rp);
  await rp.tap('#btnPlay');
  await rp.waitForFunction(() => window.__kb.S.phase === 'choose'
    && !!document.querySelector('#dieStage > .die'), null, { timeout: 1800 })
    .catch(() => { /* the measured check below names the failure */ });
  out.reducedRoll = await readReducedRollProbe(rp, rollStarted);

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

  /* Both probes below re-seat this same practice game to reach the other two
     floatPts branches — the turned far seat, and a destroyed victim — so they
     run in this order, on this page, after the near placement above. */
  out.reducedFarPoint = await readFarSeatFeedback(rp);
  out.reducedMinusPoint = await readDestroyedDieFeedback(rp);
  out.reduced = await rp.evaluate(() => ({
    jsFlag: window.__kb.reduced,
    particlesAfterBurst: (window.__kb.burst(100, 100, '#fff', 20), document.querySelectorAll('#fx .particle').length),
    playable: window.__kb.S.phase,
  }));
  check(out.reduced.jsFlag === true, 'reduced-motion not detected in JS', out.reduced);
  check(out.reduced.particlesAfterBurst === 0, 'particles still spawn under reduced motion', out.reduced);
  check(out.reducedRoll.phase === 'choose' && out.reducedRoll.value >= 1
    && out.reducedRoll.values.length === 1 && out.reducedRoll.values[0] === out.reducedRoll.value
    && !out.reducedRoll.rolling
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
  // file:// has discarded this just-written storage area on slow CI runners
  // even through a keeper, so the suite now uses one live HTTP origin. Retain
  // the same-origin keeper while reloading so only the origin semantics change,
  // and poll the observable restored state instead of sleeping through it.
  out.reducedSetting.persisted = await reloadReducedMotionWithKeeper(manual, mp, F);
  check(out.reducedSetting.state && out.reducedSetting.jsFlag && out.reducedSetting.rootClass
    && out.reducedSetting.selected === '1' && out.reducedSetting.ambient === 'none'
    && out.reducedSetting.particlesAfterBurst === 0
    && out.reducedSetting.persisted.state === true
    && out.reducedSetting.persisted.jsFlag && out.reducedSetting.persisted.rootClass,
    'the Reduced Motion setting did not apply or persist across JS and CSS', out.reducedSetting);
  await manual.close();
}
