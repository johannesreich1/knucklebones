// A GROUP CROSSING IS A MANDATORY DECK OVER THE RANKED RESULT.
//
// This drives the owner-only progression row through PostgREST, opens the real
// ranked result hook, and then uses only player inputs: buttons, keyboard,
// backdrop, and a touch-pointer swipe. It deliberately does not call a deck
// method or mutate its index. The feature-slide shape also pins the owner's
// simplification: icon, title, text — no second explanatory illustration.
import { assertPromotionTransition } from './group-transition-assertions.mjs';
import {
  bounded,
  EVENT_ID,
  MATCH_ID,
  PROGRESSION,
  readDeck,
  readModeShape,
  REPORT,
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

async function reducedMotionProbe(page) {
  const matchId = '90000000-0000-4000-8000-000000000002';
  await installProgressionRoutes(page, {
    ...PROGRESSION,
    id: '91000000-0000-4000-8000-000000000002',
    source_match_id: matchId,
  });
  await showTransitionResult(page, { ...REPORT, matchId });
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => {
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
}

async function compactLayoutProbe(page) {
  const matchId = '90000000-0000-4000-8000-000000000003';
  await installProgressionRoutes(page, {
    ...PROGRESSION,
    id: '91000000-0000-4000-8000-000000000003',
    source_match_id: matchId,
  });
  await showTransitionResult(page, { ...REPORT, matchId });
  await page.click('#gtNext');
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
    return {
      viewport: { width: innerWidth, height: innerHeight },
      deck: rect(deck),
      deckOverflow: deck ? deck.scrollHeight - deck.clientHeight : null,
      body: rect(body),
      bodyOverflow: body ? body.scrollHeight - body.clientHeight : null,
      icon: rect(body?.querySelector('.gt-feature-icon')),
      title: rect(body?.querySelector('h2')),
      paragraph: rect(body?.querySelector('p')),
      actions: rect(actions),
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
  check(reduced.errs.length === 0,
    'page errors during reduced-motion group transition', reduced.errs);

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
      && c.actions.bottom <= c.deck.bottom
      && !c.landscape
      && c.buttonHeights.length === 2
      && c.buttonHeights.every((height) => height >= 44),
    'the German icon/title/text slide clipped or lost its 44px controls in a short portrait viewport',
    c);
  check(compact.errs.length === 0,
    'page errors during compact group transition', compact.errs);

  await runGroupTransitionRuneScenarios({ visit, out, check });
}
