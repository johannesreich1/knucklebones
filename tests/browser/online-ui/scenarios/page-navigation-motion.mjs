const WIPE_IDS = [
  'kb-page-neon-beam',
  'kb-page-neon-source',
  'kb-page-neon-target',
];
const BACK_IDS = [
  'kb-duel-bracket-p1',
  'kb-duel-bracket-p2',
  ...WIPE_IDS,
].sort();

/* Installed before app code. It gives each WAAPI object a stable identity so
   a hydration test can distinguish one continuing wipe from a replacement
   wipe that happens to reuse the same public animation IDs. The rAF recorder
   also keeps the real Home -> Ladder entry: visit() cannot run its probe until
   the asynchronous door has already reached its final panel. */
const RECORD_PAGE_MOTION = () => {
  const w = window;
  const managed = (animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id);
  const targetName = (animation) => {
    const target = animation.effect?.target;
    if (!(target instanceof Element)) return null;
    return target.id || target.querySelector?.('.panel')?.id
      || target.getAttribute('class') || target.tagName.toLowerCase();
  };
  const clipAllows = (owner, childBox) => {
    if (!(owner instanceof Element) || !childBox) return true;
    const ownerBox = owner.getBoundingClientRect();
    const clip = getComputedStyle(owner).clipPath;
    const leftPercent = Number(clip.match(/([0-9.]+)%\)$/)?.[1] ?? 0);
    const paintedLeft = ownerBox.left + ownerBox.width * leftPercent / 100;
    const centre = childBox.left + childBox.width / 2;
    return centre >= paintedLeft && centre <= ownerBox.right;
  };
  const loaderReading = (source, target) => {
    const panel = document.getElementById('onLoading');
    const loader = panel?.querySelector('.ldwait');
    const box = loader?.getBoundingClientRect();
    const style = loader ? getComputedStyle(loader) : null;
    const clipOwner = target?.contains(loader) ? target : source?.contains(loader) ? source : null;
    const withinClip = clipAllows(clipOwner, box);
    const opacity = Number(style?.opacity ?? 0);
    const logicallyVisible = !!panel && (!panel.hidden
      || panel.classList.contains('page-motion-loader-hold'));
    const painted = !!loader && logicallyVisible && !!box && box.width > 0 && box.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden' && opacity > .05
      && box.right > 0 && box.left < innerWidth && box.bottom > 0 && box.top < innerHeight
      && withinClip;
    return {
      hidden: panel?.hidden ?? null,
      display: style?.display ?? null,
      visibility: style?.visibility ?? null,
      opacity,
      width: box?.width ?? 0,
      height: box?.height ?? 0,
      containedByTarget: !!loader && !!target?.contains(loader),
      withinClip,
      painted,
    };
  };
  const backReading = (target) => {
    const back = document.getElementById('btnOnlineBack');
    const box = back?.getBoundingClientRect();
    if (!back || !box || !(target instanceof Element)) {
      return { revealed: false, interactive: false };
    }
    const targetBox = target.getBoundingClientRect();
    const clip = getComputedStyle(target).clipPath;
    const leftPercent = Number(clip.match(/([0-9.]+)%\)$/)?.[1] ?? 0);
    const centreX = box.left + box.width / 2;
    const centreY = box.top + box.height / 2;
    const revealed = centreX >= targetBox.left + targetBox.width * leftPercent / 100;
    const hit = revealed ? document.elementFromPoint(centreX, centreY) : null;
    return { revealed, interactive: !!hit && (hit === back || back.contains(hit)) };
  };

  const state = w.__kbPageMotionAudit = {
    calls: [],
    homeLadder: { frames: 0, first: null, painted: null, back: null },
  };
  let token = 0;
  const nativeAnimate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const animation = nativeAnimate.apply(this, args);
    animation.__kbPageMotionToken = ++token;
    queueMicrotask(() => {
      if (!managed(animation)) return;
      state.calls.push({
        token: animation.__kbPageMotionToken,
        id: animation.id,
        target: targetName(animation),
        at: performance.now(),
      });
    });
    return animation;
  };

  const sample = () => {
    const animations = document.getAnimations({ subtree: true }).filter(managed);
    const sourceAnimation = animations.find((animation) => animation.id === 'kb-page-neon-source');
    const targetAnimation = animations.find((animation) => animation.id === 'kb-page-neon-target');
    const source = sourceAnimation?.effect?.target;
    const target = targetAnimation?.effect?.target;
    if (source?.id === 'ovStart' && target?.id === 'ovOnline') {
      const reading = {
        ids: animations.map((animation) => animation.id).sort(),
        direction: document.getElementById('kbroot')?.dataset.pageMotionDirection ?? null,
        sourceId: source.id,
        targetId: target.id,
        targetClip: getComputedStyle(target).clipPath,
        targetOpacity: Number(getComputedStyle(target).opacity),
        loader: loaderReading(source, target),
        back: backReading(target),
      };
      state.homeLadder.frames++;
      state.homeLadder.first ??= reading;
      if (reading.loader.painted) state.homeLadder.painted ??= reading;
      if (reading.back.revealed) state.homeLadder.back ??= reading;
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

/* Hold only the cross-overlay Account entry animations. A zero-delay network
   stub is usually quicker than the 280ms wipe, but "usually" is not a race
   regression: pausing the owned WAAPI objects makes the pre-settle frame
   deterministic on both a fast laptop and a loaded CI runner. The app still
   performs its real async hydration while that frame is held. */
const HOLD_ACCOUNT_ENTRY_MOTION = () => {
  const managed = () => document.getAnimations({ subtree: true })
    .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id));
  const state = window.__kbAccountEntryGate = {
    armed: true,
    held: false,
    sourceId: null,
    pauses: 0,
  };

  const inspect = () => {
    if (!state.armed) return;
    const animations = managed();
    const source = animations.find((animation) => animation.id === 'kb-page-neon-source')
      ?.effect?.target;
    const target = animations.find((animation) => animation.id === 'kb-page-neon-target')
      ?.effect?.target;
    const accountDestination = document.getElementById('onLoading')
      ?.dataset.pageMotionFor === 'onAccount';
    if (!state.held && accountDestination && target?.id === 'ovOnline'
        && (source?.id === 'ovStart' || source?.id === 'ovEnd')) {
      state.held = true;
      state.sourceId = source.id;
    }
    if (!state.held) return;
    for (const animation of animations) {
      if (animation.playState === 'running') {
        animation.pause();
        state.pauses++;
      }
    }
  };

  window.__kbArmAccountEntryGate = () => {
    state.armed = true;
    state.held = false;
    state.sourceId = null;
    state.pauses = 0;
    inspect();
  };
  window.__kbReleaseAccountEntryGate = () => {
    state.armed = false;
    for (const animation of managed()) animation.play();
  };
  new MutationObserver(inspect).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  const sample = () => {
    inspect();
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

/* Freeze Home -> Result after the Result's own progression read has completed.
   This makes the inert-owner ordering deterministic: progression can release
   its lock while navigation must continue to own the target until landing. */
const HOLD_RESULT_ENTRY_MOTION = () => {
  const managed = () => document.getAnimations({ subtree: true })
    .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id));
  const state = window.__kbResultEntryGate = {
    armed: true, held: false, pauses: 0, sourceId: null,
  };
  const inspect = () => {
    if (!state.armed) return;
    const animations = managed();
    const source = animations.find((animation) => animation.id === 'kb-page-neon-source')
      ?.effect?.target;
    const target = animations.find((animation) => animation.id === 'kb-page-neon-target')
      ?.effect?.target;
    if (!source?.id || target?.id !== 'ovEnd') return;
    state.held = true;
    state.sourceId = source.id;
    for (const animation of animations) {
      if (animation.playState === 'running') {
        animation.pause();
        state.pauses++;
      }
    }
  };
  window.__kbReleaseResultEntryGate = () => {
    state.armed = false;
    for (const animation of managed()) animation.play();
  };
  new MutationObserver(inspect).observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  const sample = () => {
    inspect();
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

async function resetMotionAudit(page) {
  await page.evaluate(() => { window.__kbPageMotionAudit.calls.length = 0; });
}

async function readMotionState(page) {
  return page.evaluate(() => {
    const managed = (animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id);
    const animations = document.getAnimations({ subtree: true }).filter(managed);
    const effectTarget = (id) => animations
      .find((animation) => animation.id === id)?.effect?.target ?? null;
    const surfaceId = (element) => element?.id
      || element?.querySelector?.('.panel')?.id
      || null;
    const box = (element) => {
      const rect = element?.getBoundingClientRect?.();
      return rect ? {
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height,
      } : null;
    };
    const overlap = (left, right) => left && right ? {
      width: Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)),
      height: Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)),
    } : null;
    const painted = (element) => {
      if (!element || element.hidden) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity) > .05;
    };
    const clipAllows = (owner, childBox) => {
      if (!(owner instanceof Element) || !childBox) return true;
      const ownerBox = owner.getBoundingClientRect();
      const clip = getComputedStyle(owner).clipPath;
      const leftPercent = Number(clip.match(/([0-9.]+)%\)$/)?.[1] ?? 0);
      const paintedLeft = ownerBox.left + ownerBox.width * leftPercent / 100;
      const centre = childBox.left + childBox.width / 2;
      return centre >= paintedLeft && centre <= ownerBox.right;
    };

    const source = effectTarget('kb-page-neon-source');
    const target = effectTarget('kb-page-neon-target');
    const sourceBox = box(source), targetBox = box(target);
    const loaderPanel = document.getElementById('onLoading');
    const loader = loaderPanel?.querySelector('.ldwait');
    const loaderBox = box(loader);
    const loaderStyle = loader ? getComputedStyle(loader) : null;
    const clipOwner = target?.contains(loader) ? target : source?.contains(loader) ? source : null;
    const loaderWithinClip = clipAllows(clipOwner, loaderBox);
    const loaderOpacity = Number(loaderStyle?.opacity ?? 0);
    const ready = document.getElementById('onLadder');
    const readyStyle = ready ? getComputedStyle(ready) : null;
    const readyBox = box(ready);
    const back = document.getElementById('btnOnlineBack');
    const backBox = back?.getBoundingClientRect();
    const backHit = backBox
      ? document.elementFromPoint(backBox.left + backBox.width / 2,
        backBox.top + backBox.height / 2)
      : null;
    return {
      animations: animations.map((animation) => ({
        id: animation.id,
        token: animation.__kbPageMotionToken ?? null,
        target: surfaceId(animation.effect?.target),
      })).sort((left, right) => left.id.localeCompare(right.id)),
      ids: animations.map((animation) => animation.id).sort(),
      calls: (window.__kbPageMotionAudit?.calls ?? []).map((call) => ({ ...call })),
      sourceId: surfaceId(source),
      targetId: surfaceId(target),
      sourceBox,
      targetBox,
      overlap: overlap(sourceBox, targetBox),
      sourceContainsLoader: !!loader && !!source?.contains(loader),
      targetContainsLoader: !!loader && !!target?.contains(loader),
      direction: document.getElementById('kbroot')?.dataset.pageMotionDirection ?? null,
      active: document.getElementById('kbroot')?.classList.contains('page-motion-active') ?? false,
      loader: {
        hidden: loaderPanel?.hidden ?? null,
        held: loaderPanel?.classList.contains('page-motion-loader-hold') ?? false,
        display: loaderStyle?.display ?? null,
        visibility: loaderStyle?.visibility ?? null,
        opacity: loaderOpacity,
        width: loaderBox?.width ?? 0,
        height: loaderBox?.height ?? 0,
        withinClip: loaderWithinClip,
        painted: !!loader && (!loaderPanel.hidden
          || loaderPanel.classList.contains('page-motion-loader-hold')) && !!loaderBox
          && loaderBox.width > 0 && loaderBox.height > 0
          && loaderStyle.display !== 'none' && loaderStyle.visibility !== 'hidden'
          && loaderOpacity > .05 && loaderWithinClip,
      },
      ready: {
        hidden: ready?.hidden ?? null,
        deferred: ready?.classList.contains('page-motion-loader-next') ?? false,
        display: readyStyle?.display ?? null,
        visibility: readyStyle?.visibility ?? null,
        opacity: Number(readyStyle?.opacity ?? 0),
        width: readyBox?.width ?? 0,
        height: readyBox?.height ?? 0,
        painted: painted(ready),
        inert: ready?.inert ?? false,
      },
      ladder: (() => {
        const body = document.querySelector('#ovOnline .pbody');
        const rows = [...document.querySelectorAll('#onLadderList .lrow')];
        const visibleRows = rows.filter(painted);
        const own = document.querySelector('#onLadderList .lrow.me');
        const ownBox = own?.getBoundingClientRect();
        const bodyBox = body?.getBoundingClientRect();
        return {
          rows: rows.length,
          visibleRows: visibleRows.length,
          slots: document.querySelectorAll('#onLadderList [data-slot]').length,
          pending: document.querySelectorAll('#onLadderList [data-pending]').length,
          own: !!own,
          scrollTop: body?.scrollTop ?? 0,
          ownInViewport: !!ownBox && !!bodyBox
            && ownBox.bottom > bodyBox.top && ownBox.top < bodyBox.bottom,
          ownCentreError: ownBox && bodyBox
            ? Math.abs((ownBox.top + ownBox.bottom) / 2 - (bodyBox.top + bodyBox.bottom) / 2)
            : null,
        };
      })(),
      onlineOn: document.getElementById('ovOnline')?.classList.contains('on') ?? false,
      homeOn: document.getElementById('ovStart')?.classList.contains('on') ?? false,
      backInteractive: !!back && (backHit === back || back.contains(backHit)),
      panelDom: {
        layers: document.querySelectorAll('#ovOnline > .page-motion-panel-layer').length,
        loaderNodes: document.querySelectorAll('#onLoading').length,
        ladderNodes: document.querySelectorAll('#onLadder').length,
        loaderUnderLayer: !!loaderPanel?.parentElement?.classList.contains('page-motion-panel-layer'),
        loaderUnderBody: !!loaderPanel?.parentElement?.classList.contains('pbody'),
        ladderUnderBody: !!ready?.parentElement?.classList.contains('pbody'),
      },
      beamCount: document.querySelectorAll('.page-wipe-beam').length,
      transientCount: document.querySelectorAll(
        '.page-motion-source,.page-motion-target,.page-motion-stage,.page-motion-cleanup,.page-motion-panel-layer',
      ).length,
    };
  });
}

async function waitForMotionIdle(page) {
  await page.waitForFunction(() => {
    const managed = document.getAnimations({ subtree: true })
      .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id));
    return !document.getElementById('kbroot')?.classList.contains('page-motion-active')
      && managed.length === 0
      && !document.querySelector(
        '.page-wipe-beam,.page-motion-source,.page-motion-target,.page-motion-stage,.page-motion-cleanup,.page-motion-panel-layer',
      );
  }, null, { timeout: 1600 });
}

async function motionSample(page, { delay = 40, progress = .2 } = {}) {
  if (delay) await page.waitForTimeout(delay);
  await page.evaluate(async (at) => {
    const animations = document.getAnimations({ subtree: true })
      .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id));
    for (const animation of animations) {
      animation.pause();
      const timing = animation.effect?.getComputedTiming();
      animation.currentTime = Number(timing?.duration ?? 0) * at;
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, progress);
  const reading = await readMotionState(page);
  await page.evaluate(() => {
    document.getAnimations({ subtree: true })
      .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id))
      .forEach((animation) => animation.play());
  });
  return reading;
}

const overlapsViewport = (sample) => sample?.sourceBox?.width > 0
  && sample.sourceBox.height > 0
  && sample.targetBox?.width > 0
  && sample.targetBox.height > 0
  && sample.overlap?.width > 0
  && sample.overlap.height > 0;

const exactIds = (actual, expected) => actual?.join() === [...expected].sort().join();

function sameAnimationTokens(before, after, ids) {
  const tokens = (reading) => new Map(reading?.animations?.map((row) => [row.id, row.token]));
  const left = tokens(before), right = tokens(after);
  return ids.every((id) => left.get(id) != null && left.get(id) === right.get(id));
}

const RESULT_ACCOUNT_REPORT = {
  won: true,
  draw: false,
  forfeit: false,
  my: 48,
  their: 31,
  delta: 21,
  opp: 'NovaComet992',
  oppAvatar: 'die:3:mg',
  oppRating: 1072,
};

async function probeHeldAccountPresentation(page, expectedSource) {
  await page.waitForFunction((sourceId) => {
    const gate = window.__kbAccountEntryGate;
    return gate?.held && gate.sourceId === sourceId
      && document.getElementById('onAccount')?.hidden === false;
  }, expectedSource, { timeout: 15000 });
  /* Let every cached/resolved-promise continuation run while the compositor is
     deliberately still paused. A presentation gated by the motion promise has
     nothing left to race here. */
  await page.waitForTimeout(60);
  const held = await page.evaluate(() => ({
    gate: structuredClone(window.__kbAccountEntryGate),
    active: document.getElementById('kbroot')?.classList.contains('page-motion-active') ?? false,
    reward: document.querySelectorAll('.rune-reward-sheet').length,
    guide: document.querySelectorAll('#accRuneGuide').length,
  }));

  /* If a regression dealt the sheet early, take its real Continue path while
     the entry is still frozen. That makes the guide half of the same ordering
     contract observable instead of passing merely because its prerequisite
     sheet was never acted on. */
  if (held.reward) {
    await page.$eval('.rune-reward-sheet__continue', (button) => button.click());
    await page.waitForTimeout(30);
  }
  const beforeRelease = await page.evaluate(() => ({
    active: document.getElementById('kbroot')?.classList.contains('page-motion-active') ?? false,
    reward: document.querySelectorAll('.rune-reward-sheet').length,
    guide: document.querySelectorAll('#accRuneGuide').length,
  }));

  await page.evaluate(() => window.__kbReleaseAccountEntryGate());
  await waitForMotionIdle(page);
  if (!held.reward) {
    await page.waitForSelector('.rune-reward-sheet__continue', { timeout: 15000 });
  }
  const presented = await page.evaluate(() => ({
    active: document.getElementById('kbroot')?.classList.contains('page-motion-active') ?? false,
    reward: document.querySelectorAll('.rune-reward-sheet').length,
    guide: document.querySelectorAll('#accRuneGuide').length,
  }));
  if (!held.reward) {
    await page.$eval('.rune-reward-sheet__continue', (button) => button.click());
  }
  await page.waitForSelector('#accRuneGuide', { timeout: 15000 });
  const guided = await page.evaluate(() => ({
    active: document.getElementById('kbroot')?.classList.contains('page-motion-active') ?? false,
    reward: document.querySelectorAll('.rune-reward-sheet').length,
    guide: document.querySelectorAll('#accRuneGuide').length,
  }));
  return { held, beforeRelease, presented, guided };
}

async function resultAccountPresentationProbe(page, routes) {
  /* The visit itself entered Account from Home. Release that setup run, return
     Home, and build a settled result with no reward before introducing the one
     unseen rune that the result-owned Profile door will discover. */
  await page.evaluate(() => window.__kbReleaseAccountEntryGate());
  await waitForMotionIdle(page);
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  await waitForMotionIdle(page);
  const readsBeforeResult = routes.runeCalls();
  await page.evaluate((report) => window.__kbResult(report), RESULT_ACCOUNT_REPORT);
  await page.waitForSelector('#ovEnd.on #endPlates > button:first-child .gpill', {
    timeout: 15000,
  });
  const deadline = Date.now() + 5000;
  while (routes.runeCalls() <= readsBeforeResult && Date.now() < deadline) {
    await page.waitForTimeout(20);
  }
  if (routes.runeCalls() <= readsBeforeResult) {
    throw new Error('the settled Result never completed its initial empty rune read');
  }
  await page.waitForTimeout(30);
  routes.makeRuneUnseen('fate');
  await page.evaluate(() => window.__kbArmAccountEntryGate());
  await page.$eval('#endPlates > button:first-child .gpill', (pill) => pill.click());
  return probeHeldAccountPresentation(page, 'ovEnd');
}

async function resultTargetBackInterruptionProbe(page) {
  /* Release the visit's Home -> Account setup, then stand up the real covered
     Result route. Pausing its Result -> Account wipe makes target Back win
     before that first run can settle, independent of compositor speed. */
  await page.evaluate(() => window.__kbReleaseAccountEntryGate());
  await waitForMotionIdle(page);
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  await waitForMotionIdle(page);
  await page.evaluate((report) => {
    window.__kb.S.played = true;
    window.__kbResult(report);
  }, RESULT_ACCOUNT_REPORT);
  await page.waitForSelector('#ovEnd.on #endPlates > button:first-child .gpill', {
    timeout: 15000,
  });

  await page.evaluate(() => window.__kbArmAccountEntryGate());
  await page.$eval('#endPlates > button:first-child .gpill', (pill) => pill.click());
  await page.waitForFunction(() => {
    const gate = window.__kbAccountEntryGate;
    return gate?.held && gate.sourceId === 'ovEnd'
      && document.getElementById('onAccount')?.hidden === false
      && document.getElementById('kbroot')?.dataset.pageMotionDirection === 'forward';
  }, null, { timeout: 15000 });
  const interruptedFrom = await page.evaluate(() => ({
    active: document.getElementById('kbroot')?.classList.contains('page-motion-active') ?? false,
    resultInert: document.getElementById('ovEnd')?.inert ?? null,
  }));

  /* Invoke the real target control while its incoming page is still held. CSS
     deliberately makes this one escape hatch live before the rest of Account. */
  await page.$eval('#btnOnlineBack', (button) => button.click());
  await page.waitForFunction(() =>
    document.getElementById('kbroot')?.dataset.pageMotionDirection === 'back',
  null, { timeout: 15000 });
  await page.evaluate(() => window.__kbReleaseAccountEntryGate());
  await page.waitForSelector('#ovEnd.on', { timeout: 15000 });
  await waitForMotionIdle(page);

  const landed = await page.evaluate(() => {
    const result = document.getElementById('ovEnd');
    const again = document.getElementById('btnAgain');
    const box = again?.getBoundingClientRect();
    const style = result ? getComputedStyle(result) : null;
    const hit = box ? document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    ) : null;
    return {
      on: result?.classList.contains('on') ?? false,
      inert: result?.inert ?? null,
      visibility: style?.visibility ?? null,
      display: style?.display ?? null,
      againOwnsHit: !!again && !!hit && (hit === again || again.contains(hit)),
    };
  });
  let againActivated = false;
  if (landed.againOwnsHit) {
    await page.click('#btnAgain');
    try {
      await page.waitForSelector('#onQueue:not([hidden])', { timeout: 3000 });
      againActivated = true;
    } catch {
      againActivated = false;
    }
  }
  return { interruptedFrom, landed, againActivated };
}

async function fastAbsentResultEntryProbe(page) {
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  await waitForMotionIdle(page);
  await page.click('#btnSettingsHome');
  await page.waitForSelector('#ovSettings.on', { timeout: 15000 });
  await waitForMotionIdle(page);
  let finishProgressionRead;
  const progressionRead = new Promise((resolve) => { finishProgressionRead = resolve; });
  await page.route('**/rest/v1/ranked_progression_events*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    finishProgressionRead();
  });
  await page.evaluate((report) => window.__kbResult({
    ...report,
    matchId: 'motion-fast-absent',
    progression: { kind: 'absent' },
  }), RESULT_ACCOUNT_REPORT);
  await page.waitForFunction(() => window.__kbResultEntryGate?.held
    && window.__kbResultEntryGate.pauses > 0, null, { timeout: 15000 });
  await Promise.race([
    progressionRead,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'the fast absent progression read did not complete while Result entry was held',
    )), 15000)),
  ]);
  await page.waitForTimeout(50);
  const during = await page.evaluate(() => ({
    active: document.getElementById('kbroot')?.classList.contains('page-motion-active') ?? false,
    inert: document.getElementById('ovEnd')?.inert ?? null,
  }));
  await page.evaluate(() => window.__kbReleaseResultEntryGate());
  await waitForMotionIdle(page);
  const landed = await page.evaluate(() => {
    const result = document.getElementById('ovEnd');
    const again = document.getElementById('btnAgain');
    const box = again?.getBoundingClientRect();
    const hit = box ? document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    ) : null;
    return {
      on: result?.classList.contains('on') ?? false,
      inert: result?.inert ?? null,
      againOwnsHit: !!again && !!hit && (hit === again || again.contains(hit)),
    };
  });
  return { during, landed };
}

export async function runPageNavigationMotionScenarios(suite) {
  const { visitChromium, out, check } = suite;

  /* The actual Home door is the user's reported path. Because visit() reaches
     its probe only after Ladder data is ready, the pre-load recorder preserves
     the frame in which the centred die is visibly inside the arriving page. */
  const homeEntry = await visitChromium({
    door: 'board',
    dataDelay: 500,
    skipStandardProbes: true,
    initScript: RECORD_PAGE_MOTION,
    probe: (page) => page.evaluate(() => ({
      ...structuredClone(window.__kbPageMotionAudit.homeLadder),
      calls: structuredClone(window.__kbPageMotionAudit.calls),
    })),
  });
  out.pageNavigationMotion = { homeToLadder: homeEntry.probeResult };
  const homePainted = homeEntry.probeResult?.painted;
  check(homeEntry.probeResult?.frames > 0
      && homeEntry.probeResult.first?.direction === 'forward'
      && homeEntry.probeResult.first.sourceId === 'ovStart'
      && homeEntry.probeResult.first.targetId === 'ovOnline'
      && exactIds(homeEntry.probeResult.first.ids, WIPE_IDS)
      && homePainted?.sourceId === 'ovStart'
      && homePainted.targetId === 'ovOnline'
      && homePainted.loader.containedByTarget
      && homePainted.loader.painted
      && homePainted.loader.opacity > .05
      && homePainted.loader.withinClip
      && homePainted.targetOpacity > 0
      && homeEntry.probeResult.back?.back.interactive
      && exactIds(homeEntry.probeResult.calls.map((call) => call.id).sort(), WIPE_IDS),
  'Home to Ladder does not wipe in a visibly painted loading die as part of #ovOnline',
  homeEntry.probeResult);
  check(homeEntry.errs.length === 0, 'page errors during Home to Ladder entry motion', homeEntry.errs);

  /* Account can finish from resolved/cached reads before a cross-overlay wipe
     does. Its reward sheet and focus-owning seat guide belong after that one
     presentation promise, whether the source is Home or a covered Result. */
  const accountFromHome = await visitChromium({
    named: true,
    runes: ['fate'],
    unseenRunes: ['fate'],
    dataDelay: 0,
    expectReward: true,
    skipStandardProbes: true,
    returnAfterProbe: true,
    initScript: HOLD_ACCOUNT_ENTRY_MOTION,
    probe: (page) => probeHeldAccountPresentation(page, 'ovStart'),
  });
  const accountFromResult = await visitChromium({
    named: true,
    dataDelay: 0,
    expectReward: true,
    skipStandardProbes: true,
    returnAfterProbe: true,
    initScript: HOLD_ACCOUNT_ENTRY_MOTION,
    probe: resultAccountPresentationProbe,
  });
  out.pageNavigationMotion.accountPresentationGate = {
    home: accountFromHome.probeResult,
    result: accountFromResult.probeResult,
  };
  for (const [source, visitResult, expectedSource] of [
    ['Home', accountFromHome, 'ovStart'],
    ['Result', accountFromResult, 'ovEnd'],
  ]) {
    const reading = visitResult.probeResult;
    check(reading?.held.gate.sourceId === expectedSource
        && reading.held.gate.pauses > 0 && reading.held.active
        && reading.held.reward === 0 && reading.held.guide === 0
        && reading.beforeRelease.active
        && reading.beforeRelease.reward === 0 && reading.beforeRelease.guide === 0
        && !reading.presented.active && reading.presented.reward === 1
        && !reading.guided.active && reading.guided.reward === 0 && reading.guided.guide === 1,
    `${source} to cached Account dealt its reward sheet or focus guide before the entry wipe settled`,
    reading);
    check(visitResult.errs.length === 0,
      `page errors during cached Account entry from ${source}`, visitResult.errs);
  }

  const resultTargetBack = await visitChromium({
    named: true,
    dataDelay: 0,
    skipStandardProbes: true,
    returnAfterProbe: true,
    initScript: HOLD_ACCOUNT_ENTRY_MOTION,
    probe: resultTargetBackInterruptionProbe,
  });
  out.pageNavigationMotion.resultTargetBack = resultTargetBack.probeResult;
  check(resultTargetBack.probeResult?.interruptedFrom.active
      && resultTargetBack.probeResult.interruptedFrom.resultInert
      && resultTargetBack.probeResult.landed.on
      && resultTargetBack.probeResult.landed.inert === false
      && resultTargetBack.probeResult.landed.visibility === 'visible'
      && resultTargetBack.probeResult.landed.display !== 'none'
      && resultTargetBack.probeResult.landed.againOwnsHit
      && resultTargetBack.probeResult.againActivated,
  'target Back interrupting Result to Profile left the landed Result inert or unusable',
  resultTargetBack.probeResult);
  check(resultTargetBack.errs.length === 0,
    'page errors during target Back interruption from Result', resultTargetBack.errs);

  const fastAbsentResult = await visitChromium({
    named: true,
    skipStandardProbes: true,
    returnAfterProbe: true,
    initScript: HOLD_RESULT_ENTRY_MOTION,
    probe: fastAbsentResultEntryProbe,
  });
  out.pageNavigationMotion.fastAbsentResult = fastAbsentResult.probeResult;
  check(fastAbsentResult.probeResult?.during.active
      && fastAbsentResult.probeResult.during.inert
      && fastAbsentResult.probeResult.landed.on
      && fastAbsentResult.probeResult.landed.inert === false
      && fastAbsentResult.probeResult.landed.againOwnsHit,
  'fast absent progression released Result input during its wipe or left the landing inert',
  fastAbsentResult.probeResult);
  check(fastAbsentResult.errs.length === 0,
    'page errors during fast absent Result entry', fastAbsentResult.errs);

  /* A real in-overlay route: Profile hands the shared shell to Ladder, which
     must move the already-centred loading die rather than snapping panels. */
  const slow = await visitChromium({
    dataDelay: 500,
    skipStandardProbes: true,
    initScript: RECORD_PAGE_MOTION,
    probe: async (page) => {
      await page.click('#btnLadder');
      await page.waitForFunction(() => {
        const loader = document.querySelector('#onLoading .ldwait');
        return document.getElementById('kbroot')?.classList.contains('page-motion-active')
          && Number(loader ? getComputedStyle(loader).opacity : 0) > .05;
      }, null, { timeout: 1000 });
      const entering = await motionSample(page, { delay: 0 });
      await page.waitForFunction(() => document.getElementById('onLadder')?.hidden === false,
        null, { timeout: 15000 });
      return entering;
    },
  });
  out.pageNavigationMotion.profileToLadder = slow.probeResult;
  check(slow.probeResult?.direction === 'forward'
      && slow.probeResult.sourceId === 'onAccount'
      && slow.probeResult.targetId === 'onLoading'
      && exactIds(slow.probeResult.ids, WIPE_IDS)
      && slow.probeResult.loader.painted
      && slow.probeResult.loader.opacity > .05
      && slow.probeResult.targetContainsLoader
      && overlapsViewport(slow.probeResult),
  'Profile to Ladder does not wipe the visibly painted loading die over the outgoing Profile',
  slow.probeResult);
  check(slow.errs.length === 0, 'page errors during slow Profile to Ladder motion', slow.errs);

  /* Capture the same three Animation objects before and after fast hydration,
     then let the run finish naturally. Reusing IDs is not continuity: stable
     tokens plus the exact animate-call log prove no replacement wipe began. */
  const fast = await visitChromium({
    named: true,
    ladderNearBottom: true,
    viewport: { width: 390, height: 844 },
    dataDelay: 60,
    skipStandardProbes: true,
    returnAfterProbe: true,
    initScript: RECORD_PAGE_MOTION,
    probe: async (page) => {
      await resetMotionAudit(page);
      await page.click('#btnLadder');
      await page.waitForFunction(() => document.getAnimations({ subtree: true })
        .some((animation) => animation.id === 'kb-page-neon-target'));
      const beforeHydration = await readMotionState(page);
      await page.waitForFunction(() => document.getElementById('onLadder')?.hidden === false,
        null, { timeout: 15000 });
      const hydrated = await readMotionState(page);
      await waitForMotionIdle(page);
      const settled = await readMotionState(page);
      return { beforeHydration, hydrated, settled };
    },
  });
  out.pageNavigationMotion.fastHydration = fast.probeResult;
  const beforeHydration = fast.probeResult?.beforeHydration;
  const hydrated = fast.probeResult?.hydrated;
  const hydratedCallIds = hydrated?.calls.map((call) => call.id).sort();
  check(beforeHydration?.ready.hidden === true
      && exactIds(beforeHydration.ids, WIPE_IDS)
      && hydrated?.sourceId === 'onAccount'
      && hydrated.targetId === 'onLoading'
      && hydrated.loader.hidden === true
      && hydrated.loader.held
      && hydrated.loader.display !== 'none'
      && hydrated.ready.hidden === false
      && hydrated.ready.deferred
      && hydrated.ready.visibility === 'hidden'
      && hydrated.ready.inert
      && !hydrated.ready.painted
      && exactIds(hydrated.ids, WIPE_IDS)
      && exactIds(hydratedCallIds, WIPE_IDS)
      && sameAnimationTokens(beforeHydration, hydrated, WIPE_IDS),
  'fast Ladder hydration replaced the entry wipe or exposed ready Ladder behind its held die',
  { beforeHydration, hydrated });
  const fastSettled = fast.probeResult?.settled;
  check(fastSettled?.onlineOn
      && fastSettled.ready.hidden === false
      && !fastSettled.ready.deferred && fastSettled.ready.painted
      && fastSettled.ready.visibility === 'visible' && !fastSettled.ready.inert
      && fastSettled.loader.hidden === true
      && !fastSettled.loader.held && !fastSettled.loader.painted
      && fastSettled.loader.width === 0 && fastSettled.loader.height === 0
      && fastSettled.ladder.rows > 0 && fastSettled.ladder.visibleRows > 0
      && fastSettled.ladder.slots > 0 && fastSettled.ladder.pending === 0
      && fastSettled.ladder.own && fastSettled.ladder.scrollTop > 0
      && fastSettled.ladder.ownInViewport
      && fastSettled.ladder.ownCentreError <= 80
      && fastSettled.ids.length === 0 && fastSettled.beamCount === 0
      && fastSettled.transientCount === 0
      && exactIds(fastSettled.calls.map((call) => call.id).sort(), WIPE_IDS),
  'fast Ladder hydration did not settle once into clean ready content', fastSettled);
  check(fast.errs.length === 0, 'page errors during fast Ladder hydration', fast.errs);

  /* Back can interrupt that held frame. Wait until the die is genuinely
     painted, commit Back, then require both the correct mid-flight source and
     a fully cleaned Home landing. */
  const interrupted = await visitChromium({
    dataDelay: 60,
    skipStandardProbes: true,
    returnAfterProbe: true,
    initScript: RECORD_PAGE_MOTION,
    probe: async (page) => {
      await resetMotionAudit(page);
      await page.click('#btnLadder');
      await page.waitForFunction(() => {
        const loader = document.querySelector('#onLoading .ldwait');
        return document.getElementById('onLadder')?.hidden === false
          && document.getElementById('onLoading')?.classList.contains('page-motion-loader-hold')
          && document.getElementById('kbroot')?.classList.contains('page-motion-active')
          && Number(loader ? getComputedStyle(loader).opacity : 0) > .05;
      }, null, { timeout: 1000 });
      const held = await readMotionState(page);
      /* The held frame lives only until the entry wipe lands (~80ms after the
         die paints). Under gate load a click round trip outruns it and Back
         lands on a settled page; freeze the wipe so Back always interrupts. */
      await page.evaluate(() => document.getAnimations({ subtree: true })
        .filter((animation) => /^kb-(page|duel)-/.test(animation.id))
        .forEach((animation) => animation.pause()));
      await page.click('#btnOnlineBack');
      const departing = await motionSample(page, { progress: .03 });
      await page.waitForSelector('#ovStart.on', { timeout: 15000 });
      await waitForMotionIdle(page);
      const landed = await readMotionState(page);
      return { held, departing, landed };
    },
  });
  out.pageNavigationMotion.backDuringHold = interrupted.probeResult;
  const held = interrupted.probeResult?.held;
  check(held?.loader.held && held.loader.painted && held.ready.deferred && !held.ready.painted
      && held.backInteractive,
    'the Back interruption fixture never painted the held die over deferred Ladder', held);
  const departing = interrupted.probeResult?.departing;
  check(departing?.direction === 'back'
      && departing.sourceId === 'ovOnline'
      && departing.targetId === 'ovStart'
      && departing.sourceContainsLoader
      && departing.loader.held && departing.loader.painted
      && departing.ready.deferred && !departing.ready.painted
      && exactIds(departing.ids, BACK_IDS),
  'Back during hydration does not wipe out the visible held die with the shared Back timeline',
  departing);
  const landed = interrupted.probeResult?.landed;
  check(landed?.homeOn && !landed.onlineOn
      && !landed.active && landed.ids.length === 0
      && landed.beamCount === 0 && landed.transientCount === 0
      && !landed.loader.held && !landed.ready.deferred,
  'Back during hydration did not land cleanly on Home', landed);
  check(interrupted.errs.length === 0, 'page errors during Back from held hydration', interrupted.errs);

  /* The Ladder can itself own Profile's way back. If Profile immediately opens
     Ladder again, Back during that fast hydration is a real route — not an
     owner repaint — and must reverse the held die into the list without
     nesting a second temporary anchor or losing the saved reading place. */
  const ladderOwnedBack = await visitChromium({
    named: true,
    ladderNearBottom: true,
    viewport: { width: 390, height: 844 },
    dataDelay: 60,
    skipStandardProbes: true,
    returnAfterProbe: true,
    initScript: RECORD_PAGE_MOTION,
    probe: async (page) => {
      await waitForMotionIdle(page);
      await page.click('#btnLadder');
      await page.waitForSelector('#onLadderList .lrow.me', { state: 'visible', timeout: 15000 });
      await waitForMotionIdle(page);
      /* Move off the default bottom clamp before saving. A fresh Ladder opening
         would return to the clamp, so only the own-row closure's VirtualPlace
         restoration can land back on this offset. */
      await page.evaluate(async () => {
        const body = document.querySelector('#ovOnline .pbody');
        if (!(body instanceof HTMLElement)) throw new Error('Ladder scroller is missing');
        body.scrollTop = Math.max(0, body.scrollTop - 140);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const place = await page.evaluate(() => {
        const body = document.querySelector('#ovOnline .pbody');
        const own = document.querySelector('#onLadderList .lrow.me');
        if (!(body instanceof HTMLElement) || !(own instanceof HTMLElement)) {
          throw new Error('Ladder place is missing');
        }
        const bodyBox = body.getBoundingClientRect();
        const ownBox = own.getBoundingClientRect();
        return {
          scrollTop: body.scrollTop,
          maximum: Math.max(0, body.scrollHeight - body.clientHeight),
          ownTop: ownBox.top - bodyBox.top,
          ownVisible: ownBox.bottom > bodyBox.top && ownBox.top < bodyBox.bottom,
        };
      });
      await page.click('#onLadderList .lrow.me');
      await page.waitForSelector('#onAccount:not([hidden])', { timeout: 15000 });
      await waitForMotionIdle(page);

      await resetMotionAudit(page);
      await page.click('#btnLadder');
      await page.waitForFunction(() => {
        const loader = document.querySelector('#onLoading .ldwait');
        return document.getElementById('onLadder')?.hidden === false
          && document.getElementById('onLoading')?.classList.contains('page-motion-loader-hold')
          && document.getElementById('kbroot')?.classList.contains('page-motion-active')
          && Number(loader ? getComputedStyle(loader).opacity : 0) > .05;
      }, null, { timeout: 1000 });
      const held = await readMotionState(page);
      await page.click('#btnOnlineBack');
      const departing = await motionSample(page, { delay: 0, progress: .03 });
      await waitForMotionIdle(page);
      const settled = await readMotionState(page);
      const restored = await page.evaluate(() => {
        const body = document.querySelector('#ovOnline .pbody');
        const own = document.querySelector('#onLadderList .lrow.me');
        if (!(body instanceof HTMLElement) || !(own instanceof HTMLElement)) return null;
        const bodyBox = body.getBoundingClientRect();
        const ownBox = own.getBoundingClientRect();
        return {
          scrollTop: body.scrollTop,
          maximum: Math.max(0, body.scrollHeight - body.clientHeight),
          ownTop: ownBox.top - bodyBox.top,
          ownVisible: ownBox.bottom > bodyBox.top && ownBox.top < bodyBox.bottom,
        };
      });
      return { place, held, departing, settled, restored };
    },
  });
  out.pageNavigationMotion.ladderOwnedBack = ladderOwnedBack.probeResult;
  const owned = ladderOwnedBack.probeResult;
  check(owned?.place.ownVisible && owned.place.maximum - owned.place.scrollTop >= 80,
    'the Ladder-owned Back fixture did not save a distinct visible reading place', owned?.place);
  check(owned?.held.panelDom.loaderNodes === 1
      && owned.held.panelDom.ladderNodes === 1 && owned.held.panelDom.loaderUnderLayer,
  'fast Ladder hydration did not hold one real loader node', owned?.held);
  check(owned?.departing.direction === 'back'
      && owned.departing.sourceId === 'onLoading'
      && owned.departing.targetId === 'onLadder'
      && exactIds(owned.departing.ids, BACK_IDS)
      && owned.departing.panelDom.layers === 1
      && owned.departing.panelDom.loaderNodes === 1
      && owned.departing.panelDom.ladderNodes === 1
      && owned.departing.panelDom.loaderUnderLayer
      && owned.departing.ready.visibility === 'visible'
      && owned.departing.ready.painted,
  'Ladder-owned immediate Back did not reverse the one held loader into Ladder', owned?.departing);
  check(owned?.restored?.ownVisible
      && Math.abs(owned.restored.scrollTop - owned.place.scrollTop) <= 3
      && Math.abs(owned.restored.ownTop - owned.place.ownTop) <= 3
      && owned.settled.panelDom.layers === 0
      && owned.settled.panelDom.loaderNodes === 1
      && owned.settled.panelDom.ladderNodes === 1
      && owned.settled.panelDom.loaderUnderBody
      && owned.settled.panelDom.ladderUnderBody
      && owned.settled.transientCount === 0,
  'Ladder-owned Back lost its saved place or failed to restore the real panel nodes', {
    place: owned?.place,
    restored: owned?.restored,
    settled: owned?.settled,
  });
  check(ladderOwnedBack.errs.length === 0,
    'page errors during Ladder-owned immediate Back', ladderOwnedBack.errs);

  /* Direct panels and a loading Back use the same compositor. Source and
     target must occupy the same viewport instead of stacking in pbody flow. */
  const subpage = await visitChromium({
    dataDelay: 350,
    skipStandardProbes: true,
    initScript: RECORD_PAGE_MOTION,
    probe: async (page) => {
      await page.click('#btnAvatar');
      const forward = await motionSample(page);
      await waitForMotionIdle(page);
      await page.click('#btnOnlineBack');
      /* Profile is already cached by the time Avatar opened, so Back wipes
         straight back into it. There is no loading page to wait for. */
      await page.waitForFunction(
        () => document.getElementById('kbroot')?.classList.contains('page-motion-active'),
        null, { timeout: 1000 });
      const back = await motionSample(page, { delay: 0 });
      await page.waitForFunction(() => document.getElementById('onAccount')?.hidden === false,
        null, { timeout: 15000 });
      await waitForMotionIdle(page);
      return { forward, back, settled: await readMotionState(page) };
    },
  });
  out.pageNavigationMotion.profileAvatar = subpage.probeResult;
  check(subpage.probeResult?.forward.direction === 'forward'
      && subpage.probeResult.forward.sourceId === 'onAccount'
      && subpage.probeResult.forward.targetId === 'onAvatar'
      && exactIds(subpage.probeResult.forward.ids, WIPE_IDS)
      && overlapsViewport(subpage.probeResult.forward),
  'Profile and Avatar do not overlap as one forward page transition',
  subpage.probeResult?.forward);
  check(subpage.probeResult?.back.direction === 'back'
      && subpage.probeResult.back.sourceId === 'onAvatar'
      && subpage.probeResult.back.targetId === 'onAccount'
      && !subpage.probeResult.back.loader.painted
      && exactIds(subpage.probeResult.back.ids, BACK_IDS)
      && overlapsViewport(subpage.probeResult.back),
  'Avatar Back does not wipe straight back into the cached Profile',
  subpage.probeResult?.back);
  check(subpage.probeResult?.settled.transientCount === 0
      && subpage.probeResult.settled.ids.length === 0,
  'Profile and Avatar navigation left compositor state behind', subpage.probeResult?.settled);
  check(subpage.errs.length === 0, 'page errors during Profile and Avatar motion', subpage.errs);
}
