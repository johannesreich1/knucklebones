const MOTION_IDS = [
  'kb-duel-bracket-p1',
  'kb-duel-bracket-p2',
  'kb-page-neon-beam',
  'kb-page-neon-source',
  'kb-page-neon-target',
];
const WIPE_IDS = MOTION_IDS.filter((id) => !id.startsWith('kb-duel-bracket'));
const CROSSFADE_IDS = ['kb-page-crossfade-source', 'kb-page-crossfade-target'];

async function settle(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('kbroot');
    const managed = document.getAnimations({ subtree: true })
      .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id));
    return !root?.classList.contains('page-motion-active')
      && managed.length === 0
      && !document.querySelector(
        '.page-wipe-beam,.page-motion-source,.page-motion-target,.page-motion-stage,.page-motion-cleanup,.page-motion-panel-layer',
      );
  }, null, { timeout: 1200 });
}

async function openSettings(page) {
  await settle(page);
  await page.evaluate(() => window.__kb.goHome());
  await page.waitForTimeout(100);
  await page.tap('#btnSettingsHome');
  await page.waitForFunction(() => document.getElementById('ovSettings')?.classList.contains('on'));
  await settle(page);
}

async function edgeSwipe(page) {
  await page.evaluate(() => {
    const mk = (x, y) => new Touch({
      identifier: 17,
      target: document.body,
      clientX: x,
      clientY: y,
    });
    const fire = (type, touch) => document.body.dispatchEvent(new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [touch],
      changedTouches: [touch],
      bubbles: true,
    }));
    fire('touchstart', mk(12, 300));
    for (const x of [30, 55, 90]) fire('touchmove', mk(x, 304));
    fire('touchend', mk(90, 304));
  });
}

async function captureActiveMotion(page, expectedIds) {
  await page.waitForFunction((ids) => {
    const active = new Set(document.getAnimations({ subtree: true }).map((animation) => animation.id));
    return ids.every((id) => active.has(id));
  }, expectedIds, { timeout: 700 });

  const sample = await page.evaluate(async () => {
    const all = document.getAnimations({ subtree: true });
    /* Capture the whole owned namespace, not only the IDs the caller expects.
       Otherwise an extra Neon/bracket animation can run and stay invisible to
       an exact-ID assertion. */
    const managed = all.filter((animation) =>
      /^(kb-page-|kb-duel-bracket-)/.test(animation.id));
    for (const animation of managed) {
      animation.pause();
      const timing = animation.effect?.getComputedTiming();
      const duration = Number(timing?.duration ?? 0);
      /* The selected ease is intentionally almost settled by halfway. Sample
         during its visible travel instead of mistaking rounded `opacity:1`
         at 50% for a missing underlay restore. */
      animation.currentTime = duration * .2;
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const signature = managed.map((animation) => {
      const timing = animation.effect?.getTiming();
      const target = animation.effect?.target;
      return {
        id: animation.id,
        duration: Number(timing?.duration ?? 0),
        easing: timing?.easing ?? '',
        keyframes: (animation.effect?.getKeyframes() ?? []).map((frame) =>
          Object.fromEntries(Object.entries(frame).sort(([a], [b]) => a.localeCompare(b)))),
        target: target?.id || target?.classList?.contains('page-wipe-beam') && 'beam'
          || target?.classList?.value || '',
      };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const sourceAnimation = managed.find((animation) => animation.id.endsWith('source'));
    const targetAnimation = managed.find((animation) => animation.id.endsWith('target'));
    const source = sourceAnimation?.effect?.target;
    const target = targetAnimation?.effect?.target;
    const beam = document.querySelector('.page-wipe-beam');
    const beamBox = beam?.getBoundingClientRect();
    const icon = document.getElementById('btnSettingsBack');
    const p1 = icon?.querySelector('.back-bracket--p1');
    const p2 = icon?.querySelector('.back-bracket--p2');
    const result = {
      signature,
      ids: signature.map((row) => row.id),
      sourceClip: source ? getComputedStyle(source).clipPath : '',
      sourceTransform: source ? getComputedStyle(source).transform : '',
      sourceOpacity: source ? getComputedStyle(source).opacity : '',
      targetClip: target ? getComputedStyle(target).clipPath : '',
      targetTransform: target ? getComputedStyle(target).transform : '',
      targetOpacity: target ? getComputedStyle(target).opacity : '',
      sourceId: source?.id ?? '',
      targetId: target?.id ?? '',
      beam: beam && beamBox ? {
        width: beamBox.width,
        height: beamBox.height,
        visible: Number(getComputedStyle(beam).opacity) > 0,
        gradient: getComputedStyle(beam).backgroundImage,
      } : null,
      bracketTransforms: [p1, p2].map((path) => path ? getComputedStyle(path).transform : ''),
      active: document.getElementById('kbroot')?.classList.contains('page-motion-active') ?? false,
    };
    for (const animation of managed) animation.play();
    return result;
  });
  await settle(page);
  return sample;
}

async function captureBackMotion(page, activate) {
  await openSettings(page);
  await activate();
  return captureActiveMotion(page, MOTION_IDS);
}

async function captureTargetInputLock(page) {
  await page.evaluate(() => window.__kb.goHome());
  await settle(page);
  await page.tap('#btnSettingsHome');
  await page.waitForFunction(() => document.getElementById('kbroot')?.classList.contains('page-motion-active'));
  return page.evaluate(async () => {
    const managed = document.getAnimations({ subtree: true })
      .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id));
    managed.forEach((animation) => animation.pause());
    const content = document.getElementById('languageNext');
    const back = document.getElementById('btnSettingsBack');
    content?.focus();
    const contentFocused = document.activeElement === content;
    back?.focus();
    const backFocused = document.activeElement === back;
    const sample = {
      contentFocused,
      backFocused,
      contentInert: !!content?.closest('[inert]'),
      backInert: !!back?.closest('[inert]'),
    };
    managed.forEach((animation) => animation.play());
    return sample;
  });
}

export async function runBackNavigationMotionScenarios(suite) {
  const { page, out, check } = suite;

  /* The language scenario before this one leaves an explicit non-English
     override behind, and the shared Back control's label follows the locale.
     This scenario reads that label in English, so it owns the precondition:
     walk the real picker to English rather than assume the previous owner's
     end state. */
  await page.evaluate(() => window.__kb.goHome());
  await page.waitForTimeout(100);
  await page.evaluate(() => document.getElementById('btnSettingsHome')?.click());
  await page.waitForTimeout(250);
  for (let attempts = 0; attempts < 12; attempts++) {
    const name = await page.$eval('#languageValue', (element) => element.textContent?.trim());
    if (name === 'English') break;
    await page.evaluate(() => document.getElementById('languageNext')?.click());
    await page.waitForTimeout(100);
  }
  /* Leave through Settings' own Back and let its wipe land, so the scenario
     below starts from a closed Settings page exactly as its taps assume. */
  await page.evaluate(() => document.getElementById('btnSettingsBack')?.click());
  await page.waitForFunction(() => !document.getElementById('ovSettings')?.classList.contains('on')
    && !document.getElementById('kbroot')?.classList.contains('page-motion-active'));
  await page.evaluate(() => window.__kb.goHome());
  await page.waitForTimeout(100);
  out.duelBrackets = await page.evaluate(() => {
    const button = document.getElementById('btnSettingsBack');
    const svg = button?.querySelector('svg.cico-back');
    const box = svg?.getBoundingClientRect();
    return {
      sharedControl: button?.matches('[data-page-back]') ?? false,
      text: button?.textContent?.trim() ?? '',
      label: button?.getAttribute('aria-label') ?? '',
      svg: !!svg,
      p1: !!svg?.querySelector('.back-bracket--p1'),
      p2: !!svg?.querySelector('.back-bracket--p2'),
      chevron: !!svg?.querySelector('.back-chevron'),
      size: box ? [box.width, box.height] : null,
      background: button ? getComputedStyle(button).backgroundImage : '',
    };
  });
  check(out.duelBrackets.sharedControl && out.duelBrackets.text === ''
    && out.duelBrackets.label === 'Back' && out.duelBrackets.svg
    && out.duelBrackets.p1 && out.duelBrackets.p2 && out.duelBrackets.chevron
    && out.duelBrackets.size?.every((value) => value >= 26.5 && value <= 30.5)
    && out.duelBrackets.background === 'none',
  'Settings does not wear the one shared transparent Duel Brackets Back control',
  out.duelBrackets);

  out.backButtonMotion = await captureBackMotion(page, () => page.tap('#btnSettingsBack'));
  out.backSwipeMotion = await captureBackMotion(page, () => edgeSwipe(page));
  const expected = [...MOTION_IDS].sort();
  check(JSON.stringify(out.backButtonMotion.ids) === JSON.stringify(expected),
    'button Back is missing the shared Duel Brackets + Neon Wipe timeline', out.backButtonMotion);
  check(JSON.stringify(out.backSwipeMotion.signature) === JSON.stringify(out.backButtonMotion.signature),
    'edge swipe does not run the exact same Back timeline as the button', {
      button: out.backButtonMotion.signature,
      swipe: out.backSwipeMotion.signature,
    });
  for (const [kind, sample] of Object.entries({
    button: out.backButtonMotion,
    swipe: out.backSwipeMotion,
  })) {
    check(sample.active && sample.sourceClip !== 'none'
      && sample.sourceTransform !== 'none' && Number(sample.targetOpacity) > 0
      && Number(sample.targetOpacity) < 1 && sample.beam?.visible
      && sample.beam.width >= 2 && sample.beam.width <= 4
      && /gradient/.test(sample.beam.gradient)
      && sample.bracketTransforms.every((value) => value && value !== 'none'),
    `${kind} Back is not visibly painting the selected Neon Wipe and bracket beat`, sample);
  }

  await page.evaluate(() => window.__kb.goHome());
  await settle(page);
  await page.tap('#btnSettingsHome');
  out.forwardMotion = await captureActiveMotion(page, WIPE_IDS);
  check(out.forwardMotion.ids.join() === [...WIPE_IDS].sort().join()
    && out.forwardMotion.sourceId === 'ovStart' && out.forwardMotion.targetId === 'ovSettings'
    && out.forwardMotion.targetClip !== 'none' && out.forwardMotion.targetTransform !== 'none'
    && out.forwardMotion.beam?.visible,
  'opening a page does not use the mirrored shared Neon Wipe', out.forwardMotion);
  await page.tap('#btnSettingsBack');
  await settle(page);

  out.targetInputLock = await captureTargetInputLock(page);
  check(out.targetInputLock.contentInert && !out.targetInputLock.contentFocused
    && !out.targetInputLock.backInert && out.targetInputLock.backFocused,
  'incoming page content is keyboard/AT-active before the wipe reveals it, or Back is locked too',
  out.targetInputLock);
  await settle(page);
  out.targetInputRelease = await page.evaluate(() => {
    const content = document.getElementById('languageNext');
    content?.focus();
    return {
      contentFocused: document.activeElement === content,
      contentInert: !!content?.closest('[inert]'),
    };
  });
  check(!out.targetInputRelease.contentInert && out.targetInputRelease.contentFocused,
    'incoming page content stayed inert after the wipe settled', out.targetInputRelease);
  await page.tap('#btnSettingsBack');
  await settle(page);

  await page.evaluate(() => document.getElementById('kbroot').classList.add('reduce-motion'));
  await openSettings(page);
  await page.tap('#btnSettingsBack');
  out.reducedMotion = await captureActiveMotion(page, CROSSFADE_IDS);
  check(out.reducedMotion.ids.join() === [...CROSSFADE_IDS].sort().join()
    && !out.reducedMotion.beam && out.reducedMotion.sourceClip === 'none'
    && out.reducedMotion.sourceTransform === 'none'
    && Number(out.reducedMotion.sourceOpacity) > 0
    && Number(out.reducedMotion.sourceOpacity) < 1
    && Number(out.reducedMotion.targetOpacity) > 0
    && Number(out.reducedMotion.targetOpacity) < 1
    && out.reducedMotion.bracketTransforms.every((value) => value === 'none')
    && out.reducedMotion.signature.every((row) => row.duration === 120),
  'Reduced Motion still travels/clips or paints the Neon beam instead of crossfading', out.reducedMotion);
  await page.evaluate(() => document.getElementById('kbroot').classList.remove('reduce-motion'));

  await page.evaluate(() => window.__kb.newGame());
  await page.waitForTimeout(50);
  out.gameExcluded = await page.evaluate(() => ({
    animations: document.getAnimations({ subtree: true })
      .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id))
      .map((animation) => animation.id),
    active: document.getElementById('kbroot')?.classList.contains('page-motion-active') ?? false,
    beam: !!document.querySelector('.page-wipe-beam'),
  }));
  check(out.gameExcluded.animations.length === 0 && !out.gameExcluded.active && !out.gameExcluded.beam,
    'entering the game runs page navigation motion', out.gameExcluded);
  await page.evaluate(() => window.__kb.goHome());
}
