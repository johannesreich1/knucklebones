/* WHAT A STRUCK COIN DOES ON THE GRID. The authored press/strike/ring
   keyframes and easings, the 144ms landing anchor, the 1584ms cleanup, 1px
   centring, the attacker heat, and the nameplate cluster BO2 may not move.

   The pair and the landscape triple are ONE responsibility on purpose: both
   pin the same authored 108ms stagger, and splitting them would write that
   constant into two files. Together they are what a struck coin does at two
   victims and at three — the triple also proving the cadence EXTENDS rather
   than stretching, on the second face style and the responsive table's
   shape. */
import { close, easingNumbers } from './bounty-mint-contract.mjs';

export async function runBountyMintStrikeScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, sidePage } = suite;
  /* Ordinary BOUNTY: only the two matching dice in the struck column receive
     a coin. A matching die elsewhere controls for a face-wide DOM query. */
  await newGame({ spell: '', mode: 5 });
  check(await waitChoose(), 'game never reached choose (BO2 pair)');
  await table([[], [], []], [[4, 4, 2], [4], [1, 4]], 4);
  out.bountyPair = await page.evaluate(async () => {
    const k = window.__kb;
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const plateBefore = {
      plate: rect('#plateBot'), who: rect('#plateBot .who'), right: rect('#plateBot .pright'),
    };
    const observedAt = (root, ready) => new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (!ready()) return;
        observer.disconnect(); resolve(performance.now());
      });
      observer.observe(root, { childList: true, subtree: true }); });
    const topBoard = document.getElementById('topBoard');
    const placement = observedAt(document.getElementById('botBoard'), () =>
      !!document.querySelector('#botBoard .col[data-col="0"] .die[data-v="4"]'));
    const minted = observedAt(topBoard, () => topBoard.querySelectorAll('.bounty-mint').length === 2);
    const move = k.place(1, 0);
    for (let i = 0; i < 180 && document.querySelectorAll('.bounty-mint').length !== 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    const expectedHeatProbe = document.createElement('i');
    expectedHeatProbe.style.color = 'var(--p1-mx2,var(--gold))';
    document.getElementById('kbroot').appendChild(expectedHeatProbe);
    const expectedHeat = getComputedStyle(expectedHeatProbe).color;
    expectedHeatProbe.remove();
    const slots = [...document.querySelectorAll('.bounty-mint-slot')]
      .sort((a, b) => Number(a.dataset.bountyOrder) - Number(b.dataset.bountyOrder));
    const liveAnimations = slots.flatMap((slot) => slot.getAnimations({ subtree: true }));
    await Promise.all(liveAnimations.map((animation) => animation.ready));
    const placementStart = await placement;
    const mintedAt = await minted;
    const victims = slots.map((slot) => {
      const die = slot.querySelector(':scope > .die');
      const stamp = slot.querySelector(':scope > .bounty-mint');
      const press = die?.getAnimations().find((animation) => animation.animationName === 'bounty-mint-press');
      const strike = stamp?.getAnimations().find((animation) => animation.animationName === 'bounty-mint-strike');
      const ring = slot.getAnimations({ subtree: true })
        .find((animation) => animation.animationName === 'bounty-mint-ring');
      const timing = (animation) => {
        const value = animation?.effect?.getTiming();
        return value ? { duration: Number(value.duration), delay: Number(value.delay),
          easing: value.easing, fill: value.fill } : null;
      };
      const frame = (value) => {
        const matrix = new DOMMatrixReadOnly(String(value.transform || 'none'));
        const brightness = String(value.filter || '').match(/brightness\(([\d.]+)\)/);
        return {
          offset: Number(value.computedOffset ?? value.offset),
          sx: Math.hypot(matrix.m11, matrix.m12),
          sy: Math.hypot(matrix.m21, matrix.m22),
          opacity: value.opacity === undefined ? null : Number(value.opacity),
          brightness: brightness ? Number(brightness[1]) : null,
          easing: value.easing,
        };
      };
      const pressFrames = press?.effect?.getKeyframes().map(frame) || [];
      const strikeFrames = strike?.effect?.getKeyframes().map((value) => ({
        offset: Number(value.computedOffset ?? value.offset),
        transform: String(value.transform), opacity: Number(value.opacity), easing: value.easing,
      })) || [];
      const ringFrames = ring?.effect?.getKeyframes().map((value) => ({
        offset: Number(value.computedOffset ?? value.offset), opacity: Number(value.opacity), easing: value.easing,
      })) || [];
      const pressTiming = timing(press), strikeTiming = timing(strike), ringTiming = timing(ring);
      /* Refresh-tick animation startTime varies by OS. Measure the authored
         DOM mark plus catch-up delay on one performance clock instead. */
      const activeStart = (value) => value ? mintedAt + value.delay - placementStart : null;
      const clock = { press: activeStart(pressTiming), strike: activeStart(strikeTiming),
        ring: activeStart(ringTiming) };
      if (strike && strikeTiming) {
        strike.pause();
        strike.currentTime = strikeTiming.delay + 360;
      }
      const sr = slot.getBoundingClientRect();
      const mr = stamp?.getBoundingClientRect();
      return {
        order: Number(slot.dataset.bountyOrder), source: slot.dataset.bountySource,
        col: slot.closest('.col')?.dataset.col,
        delay: parseFloat(slot.style.getPropertyValue('--bounty-delay')),
        heat: stamp ? getComputedStyle(stamp).color : null,
        centreError: mr ? Math.max(
          Math.abs(sr.x + sr.width / 2 - (mr.x + mr.width / 2)),
          Math.abs(sr.y + sr.height / 2 - (mr.y + mr.height / 2)),
        ) : 999,
        flatten: !!die?.classList.contains('bounty-flatten'),
        dying: !!die?.classList.contains('dying'),
        icon: !!stamp?.querySelector('.mico'),
        clock, press: pressTiming, strike: strikeTiming, ring: ringTiming,
        pressFrames, strikeFrames, ringFrames,
      };
    });
    const during = {
      stamps: document.querySelectorAll('.bounty-mint').length,
      offGrid: [...document.querySelectorAll('.bounty-mint')]
        .filter((stamp) => !stamp.closest('#topBoard,#botBoard')).length,
      unstampedMatch: document.querySelector('#topBoard .col[data-col="1"] .die[data-v="4"]')
        ?.closest('.slot')?.classList.contains('bounty-mint-slot') || false,
    };
    const cleared = observedAt(topBoard, () => !document.querySelector('.bounty-mint'));
    await move;
    const cleanupOffset = await cleared - placementStart;
    await new Promise((resolve) => setTimeout(resolve, 220)); // beyond the existing plate bump
    const plateAfter = {
      plate: rect('#plateBot'), who: rect('#plateBot .who'), right: rect('#plateBot .pright'),
    };
    return {
      expectedHeat, victims, during, plateBefore, plateAfter, cleanupOffset,
      boards: JSON.stringify(k.S.boards), bounty: JSON.stringify(k.S.bounty),
      feedback: [...document.querySelectorAll('.pts')].map((element) => element.textContent),
      tally: document.getElementById('btyBot').textContent,
      residue: document.querySelectorAll('.bounty-mint,.bounty-mint-slot,.bounty-flatten').length,
    };
  });
  const pair = out.bountyPair;
  check(pair.during.stamps === 2 && pair.victims.length === 2
      && String(pair.victims.map((victim) => victim.order)) === '0,1'
      && pair.victims.every((victim) => victim.col === '0' && victim.source === 'ordinary'
        && victim.flatten && !victim.dying && victim.icon)
      && !pair.during.unstampedMatch && pair.during.offGrid === 0,
    'BO2 marked something other than the two authoritative grid victims', pair);
  check(pair.victims.every((victim) => victim.centreError <= 1 && victim.heat === pair.expectedHeat),
    'BO2 coin is not centred within 1px or does not wear the attacker heat', pair.victims);
  check(close(pair.victims[1].delay - pair.victims[0].delay, 108, 2)
      && pair.victims.every((victim) => victim.press?.duration === 432
        && victim.strike?.duration === 1296 && victim.ring?.duration === 1296
        && victim.press.easing === 'linear' && victim.strike.easing === 'linear'
        && victim.ring.easing === 'linear'
        && victim.pressFrames.every((frame) => easingNumbers(frame.easing) === '0.4,0,0.2,1')
        && victim.strikeFrames.every((frame) => easingNumbers(frame.easing) === '0.2,1.4,0.4,1')
        && victim.ringFrames.every((frame) => frame.easing === 'ease-out')
        && victim.press.fill === 'both' && victim.strike.fill === 'both' && victim.ring.fill === 'both'),
    'BO2 visible animations lost their exact durations, stagger, fill, or easings', pair.victims);
  check(close(pair.cleanupOffset, 1584, 35) && pair.victims.every((victim, order) => {
    const stagger = order * 108;
    return close(victim.clock.press, 144 + stagger, 20)
      && close(victim.clock.strike, 144 + stagger, 20)
      && close(victim.clock.ring, 144 + stagger, 20);
  }), 'BO2 is not anchored 144ms after landing or cleaned at 1584ms', pair);
  check(pair.victims.every((victim) => {
    const frames = victim.pressFrames;
    return frames.length === 3 && close(frames[1].offset, 1 / 3, .001)
      && close(frames[1].sx, 1.06, .01) && close(frames[1].sy, .72, .01)
      && frames[1].brightness === 2.6 && close(frames[2].sx, 1.1, .01)
      && close(frames[2].sy, .08, .01) && frames[2].brightness === 3
      && frames[2].opacity === 0;
  }), 'BO2 victim press no longer uses the authored squash/flatten frames', pair.victims);
  check(pair.victims.every((victim) => {
    const frames = victim.strikeFrames;
    return String(frames.map((frame) => +frame.offset.toFixed(6)))
        === '0,0.138889,0.277778,0.722222,1'
      && frames[0].transform.includes('scale(2.1)') && frames[0].opacity === 0
      && frames[1].transform.includes('scale(0.92)') && frames[1].opacity === 1
      && frames[2].transform.includes('scale(1)') && frames[3].transform.includes('scale(1)')
      && frames[4].transform.includes('-58%') && frames[4].transform.includes('scale(0.9)')
      && frames[4].opacity === 0;
  }), 'BO2 coin no longer lands, holds, and lifts on the authored frames', pair.victims);
  check(pair.victims.every((victim) => String(victim.ringFrames.map((frame) =>
    `${+frame.offset.toFixed(6)}:${frame.opacity}`)) === '0:0,0.138889:1,1:0'),
  'BO2 seat ring no longer lands and fades on the authored coin beats', pair.victims);
  const geometryDelta = (before, after) => Math.max(
    Math.abs(before.x - after.x), Math.abs(before.y - after.y),
    Math.abs(before.width - after.width), Math.abs(before.height - after.height),
  );
  check(pair.boards === '[[[2],[4],[1,4]],[[4],[],[]]]' && pair.bounty === '[0,2]'
      && pair.feedback.includes('+2 ✦') && pair.tally === '✦2' && pair.residue === 0,
    'BO2 visuals disagreed with the board/bank or removed existing point feedback', pair);
  check(geometryDelta(pair.plateBefore.plate, pair.plateAfter.plate) <= 1
      && geometryDelta(pair.plateBefore.who, pair.plateAfter.who) <= 1
      && geometryDelta(pair.plateBefore.right, pair.plateAfter.right) <= 1,
    'BO2 moved the existing nameplate/score cluster', { before: pair.plateBefore, after: pair.plateAfter });

  /* Three victims prove the cadence extends rather than stretching. Numerals
     in landscape cover the second face style and responsive table shape. */
  const landscape = await sidePage({ name: 'BO2 landscape numerals', w: 844, h: 390 });
  try {
    await newGame({ spell: '', mode: 5 }, landscape.page);
    check(await waitChoose(landscape.page), 'game never reached choose (BO2 landscape triple)');
    await table([[], [], []], [[4, 4, 4], [], []], 4, landscape.page);
    out.bountyTriple = await landscape.page.evaluate(async () => {
      document.getElementById('kbroot').classList.add('numerals');
      const k = window.__kb;
      const move = k.place(1, 0);
      for (let i = 0; i < 180 && document.querySelectorAll('.bounty-mint').length !== 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
      const victims = [...document.querySelectorAll('.bounty-mint-slot')]
        .sort((a, b) => Number(a.dataset.bountyOrder) - Number(b.dataset.bountyOrder))
        .map((slot) => {
          const stamp = slot.querySelector(':scope > .bounty-mint');
          const animation = stamp.getAnimations()
            .find((item) => item.animationName === 'bounty-mint-strike');
          const timing = animation.effect.getTiming();
          animation.pause(); animation.currentTime = Number(timing.delay) + 360;
          const sr = slot.getBoundingClientRect(), mr = stamp.getBoundingClientRect();
          return {
            order: Number(slot.dataset.bountyOrder),
            delay: parseFloat(slot.style.getPropertyValue('--bounty-delay')),
            duration: Number(timing.duration),
            centreError: Math.max(
              Math.abs(sr.x + sr.width / 2 - (mr.x + mr.width / 2)),
              Math.abs(sr.y + sr.height / 2 - (mr.y + mr.height / 2)),
            ),
            numeral: getComputedStyle(slot.querySelector('.num')).display !== 'none',
          };
        });
      await move;
      return { victims, board: JSON.stringify(k.S.boards[0]), bounty: JSON.stringify(k.S.bounty),
        residue: document.querySelectorAll('.bounty-mint,.bounty-mint-slot,.bounty-flatten').length };
    });
    const triple = out.bountyTriple;
    check(triple.victims.length === 3 && triple.victims.every((victim, index) =>
      victim.order === index && victim.duration === 1296 && victim.centreError <= 1 && victim.numeral)
        && close(triple.victims[1].delay - triple.victims[0].delay, 108, 2)
        && close(triple.victims[2].delay - triple.victims[1].delay, 108, 2),
      'BO2 triple did not continue the 108ms cadence in landscape numerals', triple);
    check(triple.board === '[[],[],[]]' && triple.bounty === '[0,3]' && triple.residue === 0,
      'BO2 triple did not settle cleanly on authoritative state', triple);
  } finally {
    await landscape.ctx.close();
  }
}
