// A GROUP CROSSING IS A MANDATORY DECK OVER THE RANKED RESULT.
//
// This drives the owner-only progression row through PostgREST, opens the real
// ranked result hook, and then uses only player inputs: buttons, keyboard,
// backdrop, and a touch-pointer swipe. It deliberately does not call a deck
// method or mutate its index. The feature-slide shape also pins the owner's
// simplification: icon, title, text — no second explanatory illustration.
import {
  assertPromotionTransition,
  assertV2MilestoneTransition,
} from './group-transition-assertions.mjs';
import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import {
  bounded,
  EVENT_ID,
  MATCH_ID,
  PROGRESSION,
  readDeck,
  readLivingRing,
  readModeShape,
  REPORT,
  V2_CATCH_UP_PROGRESSION,
  swipe,
} from './group-transition-fixtures.mjs';
import {
  installProgressionRoutes,
  showTransitionResult,
} from './group-transition-harness.mjs';
import { runGroupTransitionRuneScenarios } from './group-transition-rune-scenarios.mjs';

async function promotionProbe(page) {
  const routes = await installProgressionRoutes(page, PROGRESSION);
  await showTransitionResult(page, REPORT);
  const opened = await readDeck(page);

  /* Mandatory means the ordinary dismissal idioms do nothing. The backdrop
     event is dispatched on the wash itself so this cannot accidentally click
     a button inside the deck. */
  await page.keyboard.press('Escape');
  await page.locator('#ovGroupTransition').evaluate((overlay) => {
    overlay.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 61, pointerType: 'touch',
      isPrimary: true, clientX: 3, clientY: 3, button: 0, buttons: 1,
    }));
    overlay.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, cancelable: true, pointerId: 61, pointerType: 'touch',
      isPrimary: true, clientX: 3, clientY: 3, button: 0, buttons: 0,
    }));
    overlay.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, clientX: 3, clientY: 3,
    }));
  });
  await page.waitForTimeout(100);
  const refusedDismissal = await readDeck(page);

  /* Slide 1 -> 2 by button. Slide 2 -> 3 -> 2 by actual horizontal pointer
     streams, then both Back and Next finish the button path to the last page. */
  await page.click('#gtNext');
  const rowSwitch = { deck: await readDeck(page), shape: await readModeShape(page) };
  await swipe(page, 'left');
  const rowMultiplySwipe = { deck: await readDeck(page), shape: await readModeShape(page) };
  await swipe(page, 'right');
  const rowSwitchAgain = await readDeck(page);
  await page.click('#gtNext');
  const beforeBackClick = await readDeck(page);
  if (!beforeBackClick.back.visible) {
    throw new Error(`Back was not available after advancing: ${JSON.stringify({
      rowSwitch,
      rowMultiplySwipe,
      rowSwitchAgain,
      beforeBackClick,
    })}`);
  }
  await page.click('#gtBack');
  const backToRowSwitch = await readDeck(page);
  await page.click('#gtNext');
  await page.click('#gtNext');
  const bounty = { deck: await readDeck(page), shape: await readModeShape(page) };
  const acknowledgementsBeforeContinue = routes.acknowledgements.length;
  const stillMandatory = await page.$eval('#ovGroupTransition', (overlay) =>
    overlay.classList.contains('on'));

  await swipe(page, 'left');
  await bounded(routes.acknowledged,
    'Continue did not acknowledge the ranked progression event');
  await page.waitForFunction(() => {
    const overlay = document.getElementById('ovGroupTransition');
    return !overlay?.classList.contains('on');
  }, null, { timeout: 7000 });
  await page.waitForTimeout(50);
  const continued = await page.evaluate(() => ({
    transitionOpen: document.getElementById('ovGroupTransition')?.classList.contains('on') ?? false,
    resultOpen: document.getElementById('ovEnd')?.classList.contains('on') ?? false,
    resultInert: document.getElementById('ovEnd')?.inert ?? true,
    focus: document.activeElement?.id ?? '',
  }));
  return {
    opened,
    refusedDismissal,
    rowSwitch,
    rowMultiplySwipe,
    rowSwitchAgain,
    backToRowSwitch,
    bounty,
    acknowledgementsBeforeContinue,
    stillMandatory,
    continued,
    reads: routes.reads,
    acknowledgements: routes.acknowledgements,
  };
}

async function v2MilestoneProbe(page) {
  const routes = await installProgressionRoutes(page, V2_CATCH_UP_PROGRESSION);
  await showTransitionResult(page, {
    ...REPORT,
    matchId: V2_CATCH_UP_PROGRESSION.source_match_id,
    delta: V2_CATCH_UP_PROGRESSION.points_after - V2_CATCH_UP_PROGRESSION.points_before,
  });
  const opened = await readDeck(page);
  const slides = [];
  for (let index = 0; index < opened.dots.count; index++) {
    slides.push({ deck: await readDeck(page), shape: await readModeShape(page) });
    if (index < opened.dots.count - 1) await page.click('#gtNext');
  }
  const acknowledgementsBeforeContinue = routes.acknowledgements.length;
  await page.click('#gtNext');
  await bounded(routes.acknowledged,
    'the v2 milestone deck did not acknowledge on its final NEON medal');
  await page.waitForFunction(() =>
    !document.getElementById('ovGroupTransition')?.classList.contains('on'));
  return {
    slides,
    acknowledgementsBeforeContinue,
    acknowledgements: routes.acknowledgements,
  };
}

async function reducedMotionProbe(page) {
  const matchId = '90000000-0000-4000-8000-000000000002';
  const profileRing = await readLivingRing(page, '#accRing');
  await installProgressionRoutes(page, {
    ...PROGRESSION,
    id: '91000000-0000-4000-8000-000000000002',
    source_match_id: matchId,
  });
  await showTransitionResult(page, { ...REPORT, matchId });
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const transitionRing = await readLivingRing(page, '.gt-ring');
  const state = await page.evaluate(() => {
    const overlay = document.getElementById('ovGroupTransition');
    const body = document.getElementById('gtBody');
    return {
      open: !!overlay?.classList.contains('on'),
      title: body?.querySelector('h1, h2, h3')?.textContent?.trim() ?? '',
      running: overlay?.getAnimations({ subtree: true })
        .filter((animation) => animation.playState === 'pending'
          || animation.playState === 'running')
        .map((animation) => animation.animationName || animation.transitionProperty) ?? [],
    };
  });
  return { ...state, profileRing, transitionRing };
}

async function apexProfileProbe(page) {
  return page.evaluate(() => {
    const ring = document.getElementById('accRing');
    const peak = ring?.querySelector('.lpeak');
    return {
      group: document.getElementById('accGroup')?.textContent?.trim() ?? '',
      rank: document.getElementById('accRank')?.textContent?.trim() ?? '',
      peak: document.getElementById('accPeak')?.textContent?.trim() ?? '',
      fill: ring ? getComputedStyle(ring).getPropertyValue('--p').trim() : '',
      hasPeakNotch: ring?.classList.contains('haspeak') ?? false,
      peakOpacity: peak ? getComputedStyle(peak).opacity : '',
    };
  });
}

async function compactLayoutProbe(page) {
  const matchId = '90000000-0000-4000-8000-000000000003';
  await installProgressionRoutes(page, {
    ...V2_CATCH_UP_PROGRESSION,
    id: '91000000-0000-4000-8000-000000000003',
    source_match_id: matchId,
  });
  await showTransitionResult(page, { ...REPORT, matchId });
  /* The longest new translated milestone is the actual pressure case: reach
     OBSIDIAN's weekly slide in the same multi-boundary deck. */
  for (let index = 0; index < 6; index++) await page.click('#gtNext');
  await page.waitForFunction(() =>
    document.getElementById('gtBody')?.querySelector('h2')?.textContent?.trim());
  return page.evaluate(() => {
    const rect = (element) => {
      const box = element?.getBoundingClientRect();
      return box ? {
        top: box.top, right: box.right, bottom: box.bottom, left: box.left,
        width: box.width, height: box.height,
      } : null;
    };
    const deck = document.querySelector('.gt-deck');
    const body = document.getElementById('gtBody');
    const actions = document.querySelector('.gt-actions');
    const swipe = document.getElementById('gtSwipe');
    const swipeBox = rect(swipe);
    const swipeStyle = swipe ? getComputedStyle(swipe) : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      deck: rect(deck),
      deckOverflow: deck ? deck.scrollHeight - deck.clientHeight : null,
      body: rect(body),
      bodyOverflow: body ? body.scrollHeight - body.clientHeight : null,
      icon: rect(body?.querySelector('.gt-feature-icon')),
      title: rect(body?.querySelector('h2')),
      titleLabel: body?.querySelector('h2')?.textContent?.trim() ?? '',
      paragraph: rect(body?.querySelector('p')),
      paragraphLabel: body?.querySelector('p')?.textContent?.trim() ?? '',
      actions: rect(actions),
      swipe: {
        label: swipe?.textContent?.trim() ?? '',
        visible: !!swipeBox && swipeBox.width > 0 && swipeBox.height > 0
          && swipeStyle?.display !== 'none' && swipeStyle?.visibility !== 'hidden'
          && Number(swipeStyle?.opacity) !== 0,
      },
      landscape: document.getElementById('kbroot')?.classList.contains('land') ?? false,
      buttonHeights: [...(actions?.querySelectorAll('button') ?? [])]
        .filter((button) => !button.hidden)
        .map((button) => button.getBoundingClientRect().height),
    };
  });
}

export async function runGroupTransitionScenarios({ visit, out, check }) {
  const promotion = await visit({
    named: true,
    skipStandardProbes: true,
    probe: promotionProbe,
  });
  const seen = promotion.probeResult;
  out.groupTransition = seen;
  assertPromotionTransition({
    check,
    seen,
    errs: promotion.errs,
    eventId: EVENT_ID,
    matchId: MATCH_ID,
  });

  const v2Milestones = await visit({
    named: true,
    motion: 'reduce',
    skipStandardProbes: true,
    probe: v2MilestoneProbe,
  });
  out.groupTransitionV2Milestones = v2Milestones.probeResult;
  assertV2MilestoneTransition({
    check,
    seen: v2Milestones.probeResult,
    errs: v2Milestones.errs,
    eventId: V2_CATCH_UP_PROGRESSION.id,
  });

  const reduced = await visit({
    named: true,
    motion: 'reduce',
    skipStandardProbes: true,
    probe: reducedMotionProbe,
  });
  out.groupTransitionReducedMotion = reduced.probeResult;
  check(reduced.probeResult?.open && reduced.probeResult.title
      && reduced.probeResult.running.length === 0,
    'reduced motion did not paint the final group truth as an animation-free still',
    reduced.probeResult);
  const profileRing = reduced.probeResult?.profileRing;
  const transitionRing = reduced.probeResult?.transitionRing;
  check(profileRing?.anatomy.join(',') === 'lring,lhalo,lorbit'
      && transitionRing?.anatomy.join(',') === 'lring,lhalo,lorbit'
      && JSON.stringify(profileRing.fill.edges) === JSON.stringify(transitionRing.fill.edges)
      && JSON.stringify(profileRing.halo.edges) === JSON.stringify(transitionRing.halo.edges)
      && JSON.stringify(profileRing.orbit.edges) === JSON.stringify(transitionRing.orbit.edges)
      && profileRing.fill.mask === transitionRing.fill.mask
      && profileRing.halo.mask === transitionRing.halo.mask
      && profileRing.ring.width === profileRing.ring.height
      && transitionRing.ring.width === transitionRing.ring.height
      && profileRing.halo.pointerEvents === 'none'
      && profileRing.orbit.pointerEvents === 'none'
      && profileRing.halo.display !== 'none'
      && profileRing.orbit.display !== 'none'
      && profileRing.halo.visibility === 'visible'
      && profileRing.orbit.visibility === 'visible'
      && profileRing.halo.opacity > 0
      && profileRing.orbit.opacity > 0
      && transitionRing.halo.display !== 'none'
      && transitionRing.orbit.display !== 'none'
      && transitionRing.halo.visibility === 'visible'
      && transitionRing.orbit.visibility === 'visible'
      && transitionRing.halo.opacity > 0
      && transitionRing.orbit.opacity > 0
      && profileRing.avatarHit,
    'Profile and the transition no longer share one non-blocking living-ring anatomy',
    { profileRing, transitionRing });
  check(profileRing?.playerAndMaterialDiffer && profileRing.fill.usesPlayer
      && !profileRing.fill.usesMaterial
      && profileRing.halo.usesMaterial && profileRing.orbit.usesMaterial
      && transitionRing?.playerAndMaterialDiffer && !transitionRing.fill.usesPlayer
      && transitionRing.fill.usesMaterial
      && transitionRing.halo.usesMaterial && transitionRing.orbit.usesMaterial,
    'Profile progress did not keep the user colour while the ring material kept its league colour',
    { profileRing, transitionRing });
  check(reduced.errs.length === 0,
    'page errors during reduced-motion group transition', reduced.errs);

  /* NEON is the top 1%, not the 4,350-point fallback. Rank two of two hundred
     is therefore NEON even at GOLD points. The league name already sits above
     the player name; the RANK fact keeps the real numeric ladder position.
     With no upper cap, the living ring is complete and cannot place a
     high-score notch on a made-up scale; the exact season high score remains
     the right-most PEAK fact below it. */
  const apex = await visit({
    named: true,
    motion: 'reduce',
    ladderBoard: { population: 200, myRank: 2 },
    standingPoints: 2494,
    standingPeak: 2610,
    skipStandardProbes: true,
    probe: apexProfileProbe,
  });
  out.groupTransitionApexProfile = apex.probeResult;
  check(apex.probeResult?.group === RESOURCES.en.online.ladder.groups.neon.name
      && apex.probeResult.rank === '#2'
      && apex.probeResult.fill === '1'
      && !apex.probeResult.hasPeakNotch && apex.probeResult.peakOpacity === '0'
      && apex.probeResult.peak === '2,610',
    'second-place NEON did not show a full unbounded ring and a separate numeric season peak',
    apex.probeResult);
  check(apex.errs.length === 0,
    'page errors during the second-place NEON Profile', apex.errs);

  const compact = await visit({
    named: true,
    locale: 'de-DE',
    viewport: { width: 320, height: 480 },
    skipStandardProbes: true,
    probe: compactLayoutProbe,
  });
  out.groupTransitionCompact = compact.probeResult;
  const c = compact.probeResult;
  check(c?.deck && c.body && c.icon && c.title && c.paragraph && c.actions
      && c.deck.top >= 0 && c.deck.left >= 0
      && c.deck.right <= c.viewport.width && c.deck.bottom <= c.viewport.height
      && c.deckOverflow <= 1 && c.bodyOverflow <= 1
      && c.icon.top >= c.body.top && c.paragraph.bottom <= c.body.bottom
      && c.titleLabel === RESOURCES.de.online.groupTransition.weeklyUnlockedTitle
      && c.paragraphLabel === RESOURCES.de.online.groupTransition.weeklyUnlockedBody
      && c.actions.bottom <= c.deck.bottom
      && c.swipe.visible
      && c.swipe.label === RESOURCES.de.online.groupTransition.swipeExplore
      && !c.landscape
      && c.buttonHeights.length === 2
      && c.buttonHeights.every((height) => height >= 44),
    'the German icon/title/text slide clipped or lost its 44px controls in a short portrait viewport',
    c);
  check(compact.errs.length === 0,
    'page errors during compact group transition', compact.errs);

  await runGroupTransitionRuneScenarios({ visit, out, check });
}
