// The mandatory league deck has no scrolling fallback. This matrix pins the
// supported mobile envelope: every semantic element remains inside the card,
// and the artwork itself scales down before the 44px actions ever do.
import {
  installProgressionRoutes,
  showTransitionResult,
} from './group-transition-harness.mjs';

const MATCH_ID = '90000000-0000-4000-8000-000000000008';
const PROGRESSION = {
  id: '91000000-0000-4000-8000-000000000008',
  player_id: '00000000-0000-4000-8000-00000000beef',
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
  curve_version: 1,
  outcome_grants: [],
  weekly_unlocked_before: false,
  weekly_unlocked_after: false,
  neon_medal_granted: false,
  seen_at: null,
};
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

const VIEWPORTS = [
  { name: 'narrow-portrait', width: 280, height: 653 },
  { name: 'short-portrait', width: 320, height: 480 },
  { name: 'small-portrait', width: 320, height: 568 },
  { name: 'android-portrait', width: 360, height: 640 },
  { name: 'compact-iphone', width: 375, height: 667 },
  { name: 'modern-iphone', width: 390, height: 844 },
  { name: 'large-mobile', width: 430, height: 932 },
];

const settleLayout = (page) => page.evaluate(() => new Promise((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(resolve))));

const measureSlide = (page, viewport, slide) => page.evaluate(({ viewport: expected, slideIndex }) => {
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
  const inside = (child, parent, tolerance = 1) => !!child && !!parent
    && child.left >= parent.left - tolerance && child.right <= parent.right + tolerance
    && child.top >= parent.top - tolerance && child.bottom <= parent.bottom + tolerance;
  const overlay = document.getElementById('ovGroupTransition');
  const deck = overlay?.querySelector('.gt-deck');
  const body = document.getElementById('gtBody');
  const actions = deck?.querySelector('.gt-actions');
  const deckBox = rect(deck);
  const bodyBox = rect(body);
  const structural = [...(deck?.querySelectorAll(
    ':scope > .gt-head, :scope > .gt-body, :scope > .gt-swipe, :scope > .gt-dots, :scope > .gt-actions',
  ) ?? [])].filter(visible).map((element) => ({
    className: element.className,
    box: rect(element),
  }));
  const semantic = [...(body?.querySelectorAll(
    '.gt-ring, .gt-overline, .gt-group, .gt-copy, .gt-feature-icon, h2, p',
  ) ?? [])].filter(visible).map((element) => ({
    className: element.className || element.tagName.toLowerCase(),
    box: rect(element),
  }));
  const deckStyle = deck ? getComputedStyle(deck) : null;
  const bodyStyle = body ? getComputedStyle(body) : null;
  return {
    viewport: { name: expected.name, width: innerWidth, height: innerHeight },
    slide: slideIndex,
    deck: deckBox,
    body: bodyBox,
    structuralOutside: structural.filter(({ box }) => !inside(box, deckBox)),
    semanticOutside: semantic.filter(({ box }) => !inside(box, bodyBox)),
    overflow: {
      overlayY: overlay ? getComputedStyle(overlay).overflowY : '',
      deckY: deckStyle?.overflowY ?? '',
      bodyY: bodyStyle?.overflowY ?? '',
    },
    scrollPosition: {
      overlay: overlay?.scrollTop ?? -1,
      deck: deck?.scrollTop ?? -1,
      body: body?.scrollTop ?? -1,
    },
    buttons: [...(actions?.querySelectorAll('button') ?? [])]
      .filter(visible).map((button) => rect(button)),
    ringWidth: rect(body?.querySelector('.gt-ring'))?.width ?? null,
    iconWidth: rect(body?.querySelector('.gt-feature-icon'))?.width ?? null,
  };
}, { viewport, slideIndex: slide });

async function responsiveProbe(page) {
  await installProgressionRoutes(page, PROGRESSION);
  await showTransitionResult(page, REPORT);
  const measurements = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await settleLayout(page);
    for (let slide = 0; slide < 4; slide++) {
      measurements.push(await measureSlide(page, viewport, slide));
      if (slide < 3) {
        await page.click('#gtNext');
        await settleLayout(page);
      }
    }
    for (let slide = 3; slide > 0; slide--) {
      await page.click('#gtBack');
      await settleLayout(page);
    }
  }
  return measurements;
}

export async function runGroupTransitionResponsiveScenarios({ visit, out, check }) {
  const run = await visit({
    named: true,
    locale: 'de-DE',
    viewport: { width: 430, height: 932 },
    skipStandardProbes: true,
    probe: responsiveProbe,
  });
  const measurements = run.probeResult ?? [];
  const failures = measurements.filter((entry) => {
    const deck = entry.deck;
    return !deck || deck.top < -1 || deck.left < -1
      || deck.right > entry.viewport.width + 1 || deck.bottom > entry.viewport.height + 1
      || entry.structuralOutside.length || entry.semanticOutside.length
      || ['auto', 'scroll'].includes(entry.overflow.overlayY)
      || ['auto', 'scroll'].includes(entry.overflow.deckY)
      || ['auto', 'scroll'].includes(entry.overflow.bodyY)
      || Object.values(entry.scrollPosition).some((position) => Math.abs(position) > 1)
      || !entry.buttons.length || entry.buttons.some((box) => !box || box.height < 44);
  });
  const shortPortrait = measurements.filter(({ viewport }) =>
    viewport.name === 'short-portrait');
  const shortArtwork = shortPortrait.every(({ ringWidth, iconWidth }) =>
    (ringWidth === null || ringWidth <= 150) && (iconWidth === null || iconWidth <= 78));
  out.groupTransitionResponsive = {
    viewports: VIEWPORTS,
    slidesMeasured: measurements.length,
    failures,
    shortPortrait: shortPortrait.map(({ slide, ringWidth, iconWidth }) => ({
      slide, ringWidth, iconWidth,
    })),
  };
  check(measurements.length === VIEWPORTS.length * 4 && failures.length === 0,
    'the mandatory league modal clipped or became scrollable in the mobile viewport matrix',
    { measured: measurements.length, failures });
  check(shortArtwork,
    'the short portrait kept full-size artwork instead of removing space responsively',
    out.groupTransitionResponsive.shortPortrait);
  check(run.errs.length === 0,
    'page errors during responsive league modal matrix', run.errs);
}
