// A GROUP CROSSING IS A MANDATORY DECK OVER THE RANKED RESULT.
//
// This drives the owner-only progression row through PostgREST, opens the real
// ranked result hook, and then uses only player inputs: buttons, keyboard,
// backdrop, and a touch-pointer swipe. It deliberately does not call a deck
// method or mutate its index. The feature-slide shape also pins the owner's
// simplification: icon, title, text — no second explanatory illustration.
import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { assertPromotionTransition } from './group-transition-assertions.mjs';
import {
  installProgressionRoutes,
  showTransitionResult,
} from './group-transition-harness.mjs';

const COPY = RESOURCES.en;
const PLAYER_ID = '00000000-0000-4000-8000-00000000beef';
const MATCH_ID = '90000000-0000-4000-8000-000000000001';
const EVENT_ID = '91000000-0000-4000-8000-000000000001';
const REPORT = {
  matchId: MATCH_ID,
  won: true,
  draw: false,
  forfeit: false,
  my: 48,
  their: 31,
  delta: 46,
  opp: 'NovaComet992',
  oppAvatar: 'die:3:mg',
  oppRating: 1072,
};
const PROGRESSION = {
  id: EVENT_ID,
  player_id: PLAYER_ID,
  source_match_id: MATCH_ID,
  points_before: 287,
  points_after: 333,
  apex_before: false,
  apex_after: false,
  pool_tier_before: 'stone',
  pool_tier_after: 'bone',
  equipped_rune_before: null,
  equipped_rune_after: null,
  random_rune_mode_before: false,
  random_rune_mode_after: false,
  rune_seat_active_before: false,
  rune_seat_active_after: false,
  seen_at: null,
};

const bounded = (promise, message, timeout = 7000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeout)),
]);

const readDeck = (page) => page.evaluate(() => {
  const overlay = document.getElementById('ovGroupTransition');
  const dialog = overlay?.querySelector('.gt-deck');
  const body = document.getElementById('gtBody');
  const dotsRoot = document.getElementById('gtDots');
  const dots = [...(dotsRoot?.children ?? [])];
  const visible = (element) => {
    if (!element) return false;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.display !== 'none'
      && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  };
  const result = document.getElementById('ovEnd');
  const resultAction = document.getElementById('btnAgain');
  const actionBox = resultAction?.getBoundingClientRect();
  const actionHit = actionBox ? document.elementFromPoint(
    actionBox.left + actionBox.width / 2,
    actionBox.top + actionBox.height / 2,
  ) : null;
  return {
    open: !!overlay?.classList.contains('on') && visible(dialog),
    modal: dialog?.getAttribute('role') === 'dialog'
      && dialog?.getAttribute('aria-modal') === 'true',
    focusInside: !!dialog && dialog.contains(document.activeElement),
    announcement: document.getElementById('gtAnnouncement')?.textContent?.trim() ?? '',
    closeControls: dialog?.querySelectorAll(
      '[data-close], [aria-label="Close"], .fograb, button.close',
    ).length ?? -1,
    result: {
      open: !!result?.classList.contains('on'),
      inert: !!result?.inert,
      actionHitByTransition: !!actionHit && !!overlay?.contains(actionHit),
    },
    dots: {
      count: dots.length,
      current: dots.findIndex((dot) => dot.hasAttribute('aria-current')),
      currentCount: dots.filter((dot) => dot.hasAttribute('aria-current')).length,
      label: dotsRoot?.getAttribute('aria-label') ?? '',
    },
    back: {
      visible: visible(document.getElementById('gtBack')),
      label: document.getElementById('gtBack')?.textContent?.trim() ?? '',
    },
    primary: {
      visible: visible(document.getElementById('gtNext')),
      label: document.getElementById('gtNext')?.textContent?.trim() ?? '',
    },
    title: body?.querySelector('h1, h2, h3')?.textContent?.trim() ?? '',
    paragraph: body?.querySelector('p')?.textContent?.trim() ?? '',
  };
});

async function swipe(page, direction) {
  await page.locator('#gtBody').evaluate(async (body, toward) => {
    const box = body.getBoundingClientRect();
    const fromX = toward === 'left' ? box.right - 34 : box.left + 34;
    const toX = toward === 'left' ? box.left + 34 : box.right - 34;
    const y = box.top + box.height * 0.55;
    const fire = (type, x, buttons) => body.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 47,
      pointerType: 'touch',
      isPrimary: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
    }));
    fire('pointerdown', fromX, 1);
    for (let step = 1; step <= 6; step++) {
      fire('pointermove', fromX + ((toX - fromX) * step) / 6, 1);
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    fire('pointerup', toX, 0);
  }, direction);
  await page.waitForTimeout(100);
}

const readModeShape = (page) => page.evaluate(() => {
  const body = document.getElementById('gtBody');
  const title = body?.querySelectorAll('h1, h2, h3') ?? [];
  const paragraphs = body?.querySelectorAll('p') ?? [];
  return {
    title: title[0]?.textContent?.trim() ?? '',
    text: paragraphs[0]?.textContent?.trim() ?? '',
    titles: title.length,
    paragraphs: paragraphs.length,
    svgs: body?.querySelectorAll('svg').length ?? -1,
    modeIcons: body?.querySelectorAll('svg.mico').length ?? -1,
    extraMedia: body?.querySelectorAll(
      'img, picture, canvas, video, .die, [class*="viz"], [class*="diagram"], svg:not(.mico)',
    ).length ?? -1,
  };
});

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

  await page.click('#gtNext');
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
    viewport: { width: 568, height: 320 },
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
      && c.landscape
      && c.buttonHeights.length === 2
      && c.buttonHeights.every((height) => height >= 44),
    'the German icon/title/text slide clipped or lost its 44px controls in a short landscape viewport',
    c);
  check(compact.errs.length === 0,
    'page errors during compact group transition', compact.errs);
}
