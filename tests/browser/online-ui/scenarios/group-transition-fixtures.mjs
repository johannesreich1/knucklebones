// Shared data and player-visible deck readers for group-transition scenarios.
export const PLAYER_ID = '00000000-0000-4000-8000-00000000beef';
export const MATCH_ID = '90000000-0000-4000-8000-000000000001';
export const EVENT_ID = '91000000-0000-4000-8000-000000000001';
export const REPORT = {
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
export const PROGRESSION = {
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

export const silverProgression = (id, matchId) => ({
  ...PROGRESSION,
  id,
  source_match_id: matchId,
  points_before: 1240,
  points_after: 1300,
  pool_tier_before: 'ivory',
  pool_tier_after: 'ivory',
});

export const bounded = (promise, message, timeout = 7000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeout)),
]);

export const readDeck = (page) => page.evaluate(() => {
  const overlay = document.getElementById('ovGroupTransition');
  const dialog = overlay?.querySelector('.gt-deck');
  const body = document.getElementById('gtBody');
  const dotsRoot = document.getElementById('gtDots');
  const dots = [...(dotsRoot?.children ?? [])];
  const rect = (element) => {
    const box = element?.getBoundingClientRect();
    return box ? {
      top: box.top, right: box.right, bottom: box.bottom, left: box.left,
      width: box.width, height: box.height,
    } : null;
  };
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
  const kicker = document.getElementById('gtKicker');
  const pageLabel = document.getElementById('gtPage');
  const head = dialog?.querySelector('.gt-head');
  const points = body?.querySelector('.gt-step');
  const deckStyle = dialog ? getComputedStyle(dialog) : null;
  const actions = dialog?.querySelector('.gt-actions');
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
    kicker: {
      visible: visible(kicker),
      label: kicker?.textContent?.trim() ?? '',
      box: rect(kicker),
    },
    page: {
      label: pageLabel?.textContent?.trim() ?? '',
      box: rect(pageLabel),
      headBox: rect(head),
    },
    points: {
      visible: visible(points),
      label: points?.textContent?.trim() ?? '',
      box: rect(points),
    },
    layout: {
      deck: rect(dialog),
      paddingTop: deckStyle ? Number.parseFloat(deckStyle.paddingTop) : null,
      paddingBottom: deckStyle ? Number.parseFloat(deckStyle.paddingBottom) : null,
      buttonHeights: [...(actions?.querySelectorAll('button') ?? [])]
        .filter((button) => !button.hidden)
        .map((button) => button.getBoundingClientRect().height),
    },
    title: body?.querySelector('h1, h2, h3')?.textContent?.trim() ?? '',
    paragraph: body?.querySelector('p')?.textContent?.trim() ?? '',
  };
});

export async function swipe(page, direction) {
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

export const readModeShape = (page) => page.evaluate(() => {
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
