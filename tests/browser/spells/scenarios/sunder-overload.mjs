export async function runSunderOverloadScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, guard, sidePage } = suite;

  /* SU6 asks the real destruction planner before it marks anything. This one
     scene carries all three answers: two matching dice truly doomed, matching
     dice spared by a Ward, and matching dice silent behind COLUMN SHIELD. */
  await newGame({ spell: 'sunder', mode: 3 });
  check(await waitChoose(), 'game never reached choose (SU6 preview)');
  await table([[], [], []], [[4, 4], [4, 2], [4, 1, 4]], 4);
  await guard(1, 0);
  await page.evaluate(() => { void window.__kb.spells.cast('sunder', -1); });
  await page.waitForTimeout(140);
  out.sunderPreview = await page.evaluate(async () => {
    const describeEmber = (ember) => {
      const host = ember.parentElement;
      const animation = ember.getAnimations().find((item) => item.animationName === 'su6ember');
      const timing = animation?.effect?.getTiming();
      const frames = animation?.effect?.getKeyframes().map((frame) => {
        const matrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
        return {
          offset: +(frame.computedOffset ?? frame.offset).toFixed(2),
          x: +matrix.m41.toFixed(1), y: +matrix.m42.toFixed(1),
          scale: +Math.hypot(matrix.m11, matrix.m12).toFixed(2),
          easing: frame.easing,
        };
      }) || [];
      const style = getComputedStyle(ember);
      return {
        x: +(parseFloat(style.left) / host.clientWidth).toFixed(2),
        y: +(parseFloat(style.top) / host.clientHeight).toFixed(2),
        name: animation?.animationName || 'none', duration: timing?.duration || 0,
        delay: timing?.delay || 0, effectEasing: timing?.easing || '',
        infinite: timing?.iterations === Infinity, frames,
      };
    };
    const columns = [...document.querySelectorAll('#topBoard .col')].map((col) => ({
      doomed: col.querySelectorAll('.die.sunder-doomed').length,
      values: [...col.querySelectorAll('.die.sunder-doomed')].map((die) => die.dataset.v),
      identities: [...col.querySelectorAll('.die.sunder-doomed')]
        .map((die) => [...die.classList].filter((name) => /^(p[12]|m[23])$/.test(name)).sort().join(':')),
    }));
    const stage = document.getElementById('dieStage');
    const outline = getComputedStyle(stage, '::after');
    const marked = [...document.querySelectorAll('.die.sunder-doomed')];
    const victims = marked.map((die) => {
      const slot = die.parentElement;
      const overlay = die.querySelector(':scope > .sunder-embers');
      const slotStyle = getComputedStyle(slot);
      return {
        tile: {
          background: slotStyle.backgroundColor,
          image: slotStyle.backgroundImage,
          border: slotStyle.borderTopColor,
          shadow: slotStyle.boxShadow,
          before: getComputedStyle(slot, '::before').content,
          after: getComputedStyle(slot, '::after').content,
        },
        overlayCount: die.querySelectorAll(':scope > .sunder-embers').length,
        overlaySize: overlay ? [overlay.offsetWidth, overlay.offsetHeight] : [0, 0],
        dieSize: [die.offsetWidth, die.offsetHeight],
        heat: overlay ? getComputedStyle(overlay).boxShadow : 'none',
        embers: overlay ? [...overlay.querySelectorAll(':scope > i')].map(describeEmber) : [],
      };
    });
    const warningBefore = marked.map((die) => getComputedStyle(die).transform);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const warningAfter = marked.map((die) => getComputedStyle(die).transform);
    return {
      columns,
      charged: stage.classList.contains('sundered'),
      outline: { content: outline.content, style: outline.borderStyle },
      stageAnimations: stage.getAnimations({ subtree: true }).map((a) => a.animationName).sort(),
      victimAnimations: marked.flatMap((die) => die.getAnimations().map((a) => a.animationName)),
      warningMoved: marked.map((_, index) => warningBefore[index] !== warningAfter[index]),
      victims,
      wards: JSON.stringify(window.__kb.S.charm.wards),
      armed: window.__kb.S.charm.sunder[1],
    };
  });
  check(String(out.sunderPreview.columns.map((c) => c.doomed)) === '2,0,0',
    'SU6 marked dice that Ward/Column Shield will spare, or missed real victims', out.sunderPreview);
  check(out.sunderPreview.columns[0].identities.every((identity) => identity === 'm2:p2'),
    'SU6 replaced the doomed dice owner/multiplier identity', out.sunderPreview.columns[0]);
  check(out.sunderPreview.charged && out.sunderPreview.outline.content === 'none'
      && out.sunderPreview.outline.style === 'none'
      && out.sunderPreview.stageAnimations.includes('su6swell')
      && out.sunderPreview.stageAnimations.includes('su6haze')
      && !out.sunderPreview.stageAnimations.includes('su6strain'),
    'the die in hand kept its removed dashed outline or lost the remaining overcharge', out.sunderPreview);
  check(out.sunderPreview.victimAnimations.includes('su6tremor')
      && out.sunderPreview.warningMoved.every(Boolean) && out.sunderPreview.armed,
    'the authoritative victims did not begin failing when SUNDER committed', out.sunderPreview);
  const transparent = (color) => {
    if (color === 'transparent') return true;
    const alpha = color.match(/(?:,|\/)\s*([\d.]+)\s*\)$/);
    return !!alpha && Number(alpha[1]) <= .005;
  };
  check(out.sunderPreview.victims.every((victim) => transparent(victim.tile.background)
      && victim.tile.image === 'none' && transparent(victim.tile.border)
      && victim.tile.shadow === 'none' && victim.tile.before === 'none'
      && victim.tile.after === 'none'),
    'a doomed die kept the grid tile or a separate SUNDER outline behind its tremor',
    out.sunderPreview.victims);
  check(out.sunderPreview.victims.every((victim) => victim.overlayCount === 1
      && String(victim.overlaySize) === String(victim.dieSize) && victim.heat !== 'none'
      && victim.embers.length === 2
      && Math.abs(victim.embers[0].x - .28) <= .03 && Math.abs(victim.embers[0].y - .62) <= .03
      && Math.abs(victim.embers[1].x - .66) <= .03 && Math.abs(victim.embers[1].y - .74) <= .03
      && victim.embers.every((ember) => ember.name === 'su6ember' && ember.duration === 2200
        && ember.effectEasing === 'linear' && ember.infinite
        && String(ember.frames.map((frame) => frame.offset)) === '0,0.15,1'
        && ember.frames.every((frame) => frame.easing === 'ease-out')
        && ember.frames[2].x === -7 && ember.frames[2].y === -34)
      && victim.embers[0].delay === 0 && victim.embers[1].delay === 1050),
    'SU6 did not cover the whole die with its two independently timed ember paths',
    out.sunderPreview.victims);

  /* The selected SU6 study holds the same failure warning until placement:
     after several cycles every marked die must still be visibly trembling. */
  await page.waitForTimeout(1050);
  out.sunderHeld = await page.evaluate(async () => {
    const marked = [...document.querySelectorAll('.die.sunder-doomed')];
    const before = marked.map((die) => getComputedStyle(die).transform);
    await new Promise((resolve) => setTimeout(resolve, 120));
    return marked.map((die, index) => ({
      moved: getComputedStyle(die).transform !== before[index],
      tremor: die.getAnimations().filter((a) => a.animationName === 'su6tremor').map((a) => a.playState),
    }));
  });
  check(out.sunderHeld.length === 2 && out.sunderHeld.every((die) => die.moved
      && die.tremor.includes('running')),
    'SU6 stopped its failure warning before the charged die was played', out.sunderHeld);

  /* Placement finishes the same visual language: the already-marked pair
     collapses with a stagger, the Warded column gets the one real contact copy,
     and every transient marker is gone before the next turn. */
  out.sunderRelease = await page.evaluate(async () => {
    const k = window.__kb;
    const describeFail = (die) => {
      const animation = die.getAnimations().find((item) => item.animationName === 'su6fail');
      if (!animation) return null;
      const timing = animation.effect.getTiming();
      return {
        duration: timing.duration, delay: timing.delay, easing: timing.easing, fill: timing.fill,
        frames: animation.effect.getKeyframes().map((frame) => {
          const matrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
          const brightness = String(frame.filter || '').match(/brightness\(([\d.]+)\)/);
          return {
            time: Math.round(Number(frame.computedOffset ?? frame.offset) * Number(timing.duration)),
            scale: +Math.hypot(matrix.m11, matrix.m12).toFixed(2),
            opacity: frame.opacity === undefined ? null : Number(frame.opacity),
            brightness: brightness ? Number(brightness[1]) : null,
            easing: frame.easing,
          };
        }),
      };
    };
    const readBeat = (die, animation, time) => {
      animation.currentTime = time;
      const style = getComputedStyle(die);
      const matrix = new DOMMatrixReadOnly(style.transform);
      const brightness = style.filter.match(/brightness\(([\d.]+)\)/);
      const overlay = die.querySelector(':scope > .sunder-embers');
      const dieRect = die.getBoundingClientRect();
      const overlayRect = overlay?.getBoundingClientRect();
      return {
        time, opacity: Number(style.opacity),
        scale: +Math.hypot(matrix.m11, matrix.m12).toFixed(2),
        brightness: brightness ? Number(brightness[1]) : 1,
        overlayError: overlayRect ? Math.max(
          Math.abs(overlayRect.x - dieRect.x), Math.abs(overlayRect.y - dieRect.y),
          Math.abs(overlayRect.width - dieRect.width), Math.abs(overlayRect.height - dieRect.height),
        ) : 999,
      };
    };
    const alphaOf = (color) => {
      if (color === 'transparent') return 0;
      const alpha = color.match(/(?:,|\/)\s*([\d.]+)\s*\)$/);
      return alpha ? Number(alpha[1]) : 1;
    };
    const describeRestore = (slot) => {
      const animation = slot.getAnimations().find((item) => item.transitionProperty === 'background-color');
      if (!animation) return null;
      const timing = animation.effect.getTiming();
      return {
        duration: timing.duration, delay: timing.delay, easing: timing.easing, fill: timing.fill,
      };
    };
    const readRestoreBeat = (slot, transitions, dieAnimation, time) => {
      transitions.forEach((transition) => { transition.currentTime = time; });
      dieAnimation.currentTime = time;
      const style = getComputedStyle(slot);
      const normal = getComputedStyle(document.querySelector('#topBoard .col[data-col="1"] .slot'));
      const dieStyle = getComputedStyle(slot.querySelector('.die.sunder-collapse'));
      return {
        time,
        backgroundAlpha: alphaOf(style.backgroundColor),
        borderAlpha: alphaOf(style.borderTopColor),
        normalBackgroundAlpha: alphaOf(normal.backgroundColor),
        normalBorderAlpha: alphaOf(normal.borderTopColor),
        dieOpacity: Number(dieStyle.opacity),
        diePresent: !!slot.querySelector('.die.sunder-collapse'),
      };
    };
    let maxCollapse = 0, sawFail = false, sawWardGhost = false;
    let failEffects = null, shine = null, restoreEffects = null, restoreBeats = null;
    let particles = false, flash = false, boardShake = false;
    const placement = k.place(1, 0);
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 30));
      const collapsing = [...document.querySelectorAll('.die.sunder-collapse')];
      maxCollapse = Math.max(maxCollapse, collapsing.length);
      sawFail ||= collapsing.some((die) => die.getAnimations().some((a) => a.animationName === 'su6fail'));
      sawWardGhost ||= !!document.querySelector('.ward-strike-ghost');
      particles ||= !!document.querySelector('#fx .particle');
      flash ||= document.getElementById('flash').getAnimations()
        .some((animation) => animation.playState === 'running');
      boardShake ||= document.getElementById('app').getAnimations()
        .some((animation) => animation.playState === 'running');
      if (!failEffects && collapsing.length === 2) {
        failEffects = collapsing.map(describeFail);
        const restoring = [...document.querySelectorAll('.sunder-returning-slot')];
        restoreEffects = restoring.map(describeRestore);
        const firstSlot = restoring.find((slot) => slot.getAnimations()
          .find((item) => item.transitionProperty === 'background-color')?.effect?.getTiming().delay === 1900);
        const restoreTransition = firstSlot?.getAnimations()
          .find((item) => item.transitionProperty === 'background-color');
        const restoreTransitions = firstSlot?.getAnimations()
          .filter((item) => item.transitionProperty);
        const firstDie = firstSlot?.querySelector('.die.sunder-collapse');
        const firstDieAnimation = firstDie?.getAnimations()
          .find((item) => item.animationName === 'su6fail');
        if (firstSlot && restoreTransition && restoreTransitions?.length && firstDieAnimation) {
          const originalRestoreTimes = restoreTransitions.map((transition) => transition.currentTime);
          const originalDieTime = firstDieAnimation.currentTime;
          restoreTransitions.forEach((transition) => transition.pause());
          firstDieAnimation.pause();
          restoreBeats = [
            readRestoreBeat(firstSlot, restoreTransitions, firstDieAnimation, 1900),
            readRestoreBeat(firstSlot, restoreTransitions, firstDieAnimation, 1970),
            readRestoreBeat(firstSlot, restoreTransitions, firstDieAnimation, 2120),
          ];
          restoreTransitions.forEach((transition, index) => {
            transition.currentTime = originalRestoreTimes[index];
          });
          firstDieAnimation.currentTime = originalDieTime;
          restoreTransitions.forEach((transition) => transition.play());
          firstDieAnimation.play();
        }
        const first = collapsing.find((die) => die.getAnimations()
          .find((item) => item.animationName === 'su6fail')?.effect?.getTiming().delay === 0);
        const animation = first.getAnimations().find((item) => item.animationName === 'su6fail');
        animation.pause();
        shine = [readBeat(first, animation, 1612), readBeat(first, animation, 2028)];
        animation.play();
      }
    }
    await placement;
    return {
      maxCollapse, sawFail, sawWardGhost, failEffects, shine, restoreEffects, restoreBeats,
      particles, flash, boardShake,
      theirs: JSON.stringify(k.S.boards[0]),
      wards: JSON.stringify(k.S.charm.wards),
      armed: k.S.charm.sunder[1],
      charged: document.getElementById('dieStage').classList.contains('sundered'),
      residue: document.querySelectorAll('.sunder-doomed,.sunder-doomed-slot,.sunder-returning-slot,.sunder-collapse,.sunder-embers,.ward-strike-ghost').length,
    };
  });
  check(out.sunderRelease.maxCollapse === 2 && out.sunderRelease.sawFail
      && out.sunderRelease.failEffects?.length === 2
      && String(out.sunderRelease.failEffects.map((effect) => effect.delay).sort((a, b) => a - b)) === '0,160'
      && out.sunderRelease.failEffects.every((effect) => effect.duration === 2600
        && effect.easing === 'linear' && effect.fill === 'both'
        && effect.frames.every((frame) => frame.easing === 'ease-in')
        && String(effect.frames.map((frame) => frame.time)) === '0,780,1144,1404,1612,2028,2600'
        && effect.frames[4].scale >= 1.15 && effect.frames[4].brightness === 2.4
        && effect.frames[4].opacity === 1 && effect.frames[5].scale <= .19
        && effect.frames[5].brightness === 3 && effect.frames[5].opacity === 0),
    'SU6 did not collapse its marked pair as a staggered continuation', out.sunderRelease);
  check(out.sunderRelease.shine?.[0]?.brightness >= 2.3
      && out.sunderRelease.shine[0].scale >= 1.12 && out.sunderRelease.shine[0].opacity >= .99
      && out.sunderRelease.shine[0].overlayError < .75
      && out.sunderRelease.shine[1].brightness >= 2.9
      && out.sunderRelease.shine[1].scale <= .25 && out.sunderRelease.shine[1].opacity <= .02
      && out.sunderRelease.shine[1].overlayError < .75,
    'SU6 missed the whole-die local shine or left its embers behind during collapse',
    out.sunderRelease.shine);
  check(out.sunderRelease.restoreEffects?.length === 2
      && String(out.sunderRelease.restoreEffects.map((effect) => effect.delay).sort((a, b) => a - b))
        === '1900,2060'
      && out.sunderRelease.restoreEffects.every((effect) => effect.duration === 220
        && effect.easing === 'ease-out')
      && out.sunderRelease.restoreBeats?.length === 3
      && out.sunderRelease.restoreBeats.every((beat) => beat.diePresent)
      && out.sunderRelease.restoreBeats[0].backgroundAlpha <= .005
      && out.sunderRelease.restoreBeats[1].backgroundAlpha > .005
      && out.sunderRelease.restoreBeats[1].backgroundAlpha < .028
      && out.sunderRelease.restoreBeats[1].dieOpacity > .02
      && Math.abs(out.sunderRelease.restoreBeats[2].backgroundAlpha
        - out.sunderRelease.restoreBeats[2].normalBackgroundAlpha) <= .002
      && Math.abs(out.sunderRelease.restoreBeats[2].borderAlpha
        - out.sunderRelease.restoreBeats[2].normalBorderAlpha) <= .005
      && out.sunderRelease.restoreBeats[2].dieOpacity <= .02,
    'SU6 did not quickly fade each grid tile back underneath the final collapse beat',
    { effects: out.sunderRelease.restoreEffects, beats: out.sunderRelease.restoreBeats });
  check(!out.sunderRelease.particles && !out.sunderRelease.flash && !out.sunderRelease.boardShake,
    'SU6 introduced a centre burst, screen flash or board shake when its existing warning released',
    out.sunderRelease);
  check(out.sunderRelease.sawWardGhost,
    'SUNDER did not send its real Ward-blocked strike into the clasp', out.sunderRelease);
  check(out.sunderRelease.theirs === '[[],[4,2],[4,1,4]]'
      && JSON.parse(out.sunderRelease.wards)[0][1] === 0,
    'SU6 visuals disagreed with the authoritative Ward/Shield outcome', out.sunderRelease);
  check(!out.sunderRelease.armed && !out.sunderRelease.charged && out.sunderRelease.residue === 0,
    'SU6 leaked its charge or doomed markers into the next turn', out.sunderRelease);

  /* A widened strike is one event, not three ordinary column destructions in
     sequence. Every unprotected victim starts the same globally staggered
     collapse before any board repaint can remove another column's warning. */
  await newGame({ spell: 'sunder' });
  check(await waitChoose(), 'game never reached choose (SU6 widened collapse)');
  await table([[], [], []], [[4, 4], [4, 2], [1, 4]], 4);
  await guard(1, 0);
  await page.evaluate(() => window.__kb.spells.cast('sunder', -1));
  out.sunderWideRelease = await page.evaluate(async () => {
    const k = window.__kb;
    const targets = [...document.querySelectorAll('.die.sunder-doomed')];
    const warningTransforms = targets.map((die) => getComputedStyle(die).transform);
    const animated = targets.map(() => false);
    const visiblyChanged = targets.map(() => false);
    let firstCollapse = null, maxCollapse = 0, delays = null, returnDelays = null;
    const placement = k.place(1, 0);
    for (let i = 0; i < 160; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const collapsing = [...document.querySelectorAll('.die.sunder-collapse')];
      if (collapsing.length && firstCollapse === null) firstCollapse = collapsing.length;
      maxCollapse = Math.max(maxCollapse, collapsing.length);
      if (!delays && collapsing.length === 3) delays = collapsing.map((die) =>
        die.getAnimations().find((animation) => animation.animationName === 'su6fail')
          ?.effect?.getTiming().delay ?? -1);
      if (!returnDelays && collapsing.length === 3) {
        returnDelays = [...document.querySelectorAll('.sunder-returning-slot')].map((slot) =>
          Math.round(slot.getAnimations()
            .find((animation) => animation.transitionProperty === 'background-color')
            ?.effect?.getTiming().delay ?? -1));
      }
      targets.forEach((die, index) => {
        const collapsingNow = die.getAnimations().some((a) => a.animationName === 'su6fail');
        animated[index] ||= collapsingNow;
        const style = getComputedStyle(die);
        visiblyChanged[index] ||= collapsingNow
          && (style.transform !== warningTransforms[index] || Number(style.opacity) < .98);
      });
    }
    await placement;
    return {
      targets: targets.length, firstCollapse, maxCollapse, animated, visiblyChanged, delays, returnDelays,
      theirs: JSON.stringify(k.S.boards[0]),
      wards: JSON.stringify(k.S.charm.wards),
      residue: document.querySelectorAll('.sunder-doomed,.sunder-doomed-slot,.sunder-returning-slot,.sunder-collapse,.sunder-embers').length,
    };
  });
  check(out.sunderWideRelease.targets === 3 && out.sunderWideRelease.firstCollapse === 3
      && out.sunderWideRelease.maxCollapse === 3
      && out.sunderWideRelease.animated.every(Boolean)
      && out.sunderWideRelease.visiblyChanged.every(Boolean)
      && String(out.sunderWideRelease.delays?.sort((a, b) => a - b)) === '0,160,320'
      && String(out.sunderWideRelease.returnDelays?.sort((a, b) => a - b)) === '1900,2060,2220',
    'SU6 did not animate every widened victim as one visible staggered collapse', out.sunderWideRelease);
  check(out.sunderWideRelease.theirs === '[[],[4,2],[1]]'
      && JSON.parse(out.sunderWideRelease.wards)[0][1] === 0
      && out.sunderWideRelease.residue === 0,
    'SU6 widened collapse disagreed with its authoritative outcomes or leaked presentation', out.sunderWideRelease);

  /* SINGLE STRIKE is another visible-planner trap: of two matching dice only
     logical index zero (the centre-nearest die) is genuinely doomed. */
  await newGame({ spell: 'sunder', mode: 4 });
  check(await waitChoose(), 'game never reached choose (SU6 single strike)');
  await table([[], [], []], [[4, 6, 4], [], []], 4);
  await page.evaluate(() => { void window.__kb.spells.cast('sunder', -1); });
  await page.waitForTimeout(160);
  out.sunderSingle = await page.evaluate(() => {
    const marked = [...document.querySelectorAll('#topBoard .col[data-col="0"] .die.sunder-doomed')];
    return { count: marked.length, slot: marked[0]?.parentElement?.dataset.slot,
      all: [...document.querySelectorAll('#topBoard .col[data-col="0"] .die')]
        .map((die) => ({ v: die.dataset.v, slot: die.parentElement.dataset.slot,
          doomed: die.classList.contains('sunder-doomed') })) };
  });
  check(out.sunderSingle.count === 1 && out.sunderSingle.slot === '2',
    'SU6 marked more than SINGLE STRIKE can destroy, or chose the outer match', out.sunderSingle);

  /* A cast may be abandoned by starting another duel. The charged stage is
     presentation, not durable game state, and must disappear synchronously
     with resetSpells rather than tinting the next opening roll. */
  await newGame({ spell: 'nudge' });
  out.sunderRestart = await page.evaluate(() => ({
    charged: document.getElementById('dieStage').classList.contains('sundered'),
    residue: document.querySelectorAll('.sunder-doomed,.sunder-doomed-slot,.sunder-returning-slot,.sunder-collapse,.sunder-embers').length,
    marks: JSON.stringify(window.__kb.S.charm.sunder),
  }));
  check(!out.sunderRestart.charged && out.sunderRestart.residue === 0
      && out.sunderRestart.marks === '[false,false]',
    'a restarted game inherited SUNDER presentation or charm state', out.sunderRestart);

  /* Reduced motion keeps the exact static warning but runs no tremor, swell,
     haze, ember, or collapse choreography. Protected matches stay unmarked. */
  const reduced = await sidePage({ name: 'SU6 reduced', w: 390, h: 844,
    opts: { reducedMotion: 'reduce' } });
  try {
    await newGame({ spell: 'sunder', mode: 3 }, reduced.page);
    check(await waitChoose(reduced.page), 'game never reached choose (SU6 reduced)');
    await table([[], [], []], [[4, 4], [4, 2], [4, 1, 4]], 4, reduced.page);
    await guard(1, 0, reduced.page);
    await reduced.page.evaluate(() => window.__kb.spells.cast('sunder', -1));
    out.sunderReduced = await reduced.page.evaluate(async () => {
      /* The shared reduced-motion policy retains one 60ms property settle.
         Sample its resting pixels, not the old tile at transition time zero. */
      await new Promise((resolve) => setTimeout(resolve, 140));
      const marked = [...document.querySelectorAll('.die.sunder-doomed')];
      const stage = document.getElementById('dieStage');
      const transparent = (color) => {
        if (color === 'transparent') return true;
        const alpha = color.match(/(?:,|\/)\s*([\d.]+)\s*\)$/);
        return !!alpha && Number(alpha[1]) <= .005;
      };
      const staticDetails = marked.map((die) => {
        const slotStyle = getComputedStyle(die.parentElement);
        return {
          transform: getComputedStyle(die).transform,
          background: slotStyle.backgroundColor,
          border: slotStyle.borderTopColor,
          emberOpacity: [...die.querySelectorAll(':scope > .sunder-embers > i')]
            .map((ember) => Number(getComputedStyle(ember).opacity)),
        };
      });
      return {
        reduced: window.__kb.reduced,
        columns: [...document.querySelectorAll('#topBoard .col')]
          .map((col) => col.querySelectorAll('.die.sunder-doomed').length),
        charged: stage.classList.contains('sundered'),
        running: [...stage.getAnimations({ subtree: true }),
          ...marked.flatMap((die) => die.getAnimations({ subtree: true }))]
          /* Board repaint may still be finishing its universal 60ms pip
             transition. Only SU6-owned motion is forbidden by this contract. */
          .filter((animation) => String(animation.animationName || '').startsWith('su6')
            && animation.playState === 'running').length,
        staticDetails,
        staticWarning: staticDetails.every((detail) => detail.transform !== 'none'
          && transparent(detail.background) && transparent(detail.border)
          && detail.emberOpacity.length === 2 && detail.emberOpacity.every((opacity) => opacity >= .8)),
      };
    });
    check(out.sunderReduced.reduced && String(out.sunderReduced.columns) === '2,0,0'
        && out.sunderReduced.charged && out.sunderReduced.running === 0
        && out.sunderReduced.staticWarning,
      'SU6 reduced motion lost its exact static warning or kept moving', out.sunderReduced);
    out.sunderReducedRelease = await reduced.page.evaluate(async () => {
      const k = window.__kb;
      await k.place(1, 0);
      return {
        theirs: JSON.stringify(k.S.boards[0]),
        wards: JSON.stringify(k.S.charm.wards),
        armed: k.S.charm.sunder[1],
        residue: document.querySelectorAll(
          '.sunder-doomed,.sunder-doomed-slot,.sunder-returning-slot,.sunder-collapse,.sunder-embers,.ward-strike-ghost').length,
        running: [...document.querySelectorAll('.sunder-doomed-slot,.sunder-returning-slot,.sunder-doomed,.sunder-embers')]
          .flatMap((node) => node.getAnimations({ subtree: true }))
          .filter((animation) => String(animation.animationName || '').startsWith('su6')
            && animation.playState === 'running').length,
      };
    });
    check(out.sunderReducedRelease.theirs === '[[],[4,2],[4,1,4]]'
        && JSON.parse(out.sunderReducedRelease.wards)[0][1] === 0
        && !out.sunderReducedRelease.armed && out.sunderReducedRelease.residue === 0
        && out.sunderReducedRelease.running === 0,
      'SU6 reduced motion did not resolve immediately and cleanly after placement',
      out.sunderReducedRelease);
  } finally {
    await reduced.ctx.close();
  }
}
