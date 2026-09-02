// DEMOTION MUST FEEL LIKE THE SAME LIVING LADDER MOVING DOWN.
//
// This scenario owns what the promotion deck cannot prove: SILVER settles
// visibly into IVORY without retracting the permanent historical rune unlock,
// and BadRandolf's historical-SILVER re-promotion from 1,259 paints one
// centered page without dead navigation. It also pins a named normal-motion
// promotion animation; the
// reduced-motion sibling alone would pass if all motion vanished.
import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import {
  installProgressionRoutes,
  showTransitionResult,
} from './group-transition-harness.mjs';

const COPY = RESOURCES.en;
const PLAYER_ID = '00000000-0000-4000-8000-00000000beef';
const REPORT = {
  won: false,
  draw: false,
  forfeit: false,
  my: 31,
  their: 48,
  delta: -1,
  opp: 'NovaComet992',
  oppAvatar: 'die:3:mg',
  oppRating: 1301,
};

const progression = ({ id, matchId, ...overrides }) => ({
  id,
  player_id: PLAYER_ID,
  source_match_id: matchId,
  points_before: 1260,
  points_after: 1259,
  apex_before: false,
  apex_after: false,
  pool_tier_before: 'ivory',
  pool_tier_after: 'ivory',
  equipped_rune_before: 'ward',
  equipped_rune_after: 'ward',
  random_rune_mode_before: false,
  random_rune_mode_after: false,
  rune_seat_active_before: true,
  rune_seat_active_after: true,
  curve_version: 1,
  outcome_grants: [],
  weekly_unlocked_before: false,
  weekly_unlocked_after: false,
  neon_medal_granted: false,
  seen_at: null,
  ...overrides,
});

async function open(page, row, report = {}) {
  await installProgressionRoutes(page, row);
  await showTransitionResult(page, { ...REPORT, matchId: row.source_match_id, ...report });
}

const runningNames = (page) => page.$eval('#ovGroupTransition', (overlay) =>
  overlay.getAnimations({ subtree: true })
    .filter((animation) => animation.playState === 'pending'
      || animation.playState === 'running')
    .map((animation) => animation.animationName || animation.transitionProperty));

async function promotionMotionProbe(page) {
  const matchId = '90000000-0000-4000-8000-000000000101';
  await open(page, progression({
    id: '91000000-0000-4000-8000-000000000101',
    matchId,
    points_before: 287,
    points_after: 333,
    pool_tier_before: 'bone',
    pool_tier_after: 'bone',
    equipped_rune_before: null,
    equipped_rune_after: null,
    rune_seat_active_before: false,
    rune_seat_active_after: false,
  }), { won: true, delta: 46 });
  return {
    title: await page.$eval('#gtBody h2', (title) => title.textContent?.trim() ?? ''),
    names: await runningNames(page),
  };
}

async function demotionProbe(page) {
  const matchId = '90000000-0000-4000-8000-000000000102';
  await open(page, progression({
    id: '91000000-0000-4000-8000-000000000102',
    matchId,
  }));
  const group = await page.evaluate(() => {
    const root = document.getElementById('kbroot');
    const overlay = document.getElementById('ovGroupTransition');
    const deck = overlay?.querySelector('.gt-deck');
    const ring = document.querySelector('.gt-ring');
    const lring = ring?.querySelector('.lring');
    const oldArc = ring?.querySelector('.loldarc');
    const kicker = document.getElementById('gtKicker');
    const kickerBox = kicker?.getBoundingClientRect();
    const kickerStyle = kicker ? getComputedStyle(kicker) : null;
    const color = (scope, variable) => {
      const chip = document.createElement('i');
      chip.style.color = `var(${variable})`;
      scope?.appendChild(chip);
      const value = getComputedStyle(chip).color;
      chip.remove();
      return value;
    };
    const compact = (value) => value.replaceAll(' ', '');
    const ivory = color(root, '--g-ivory');
    const silver = color(root, '--g-silver');
    const ringFill = lring ? getComputedStyle(lring).backgroundImage : '';
    const oldFill = oldArc ? getComputedStyle(oldArc).backgroundImage : '';
    return {
      demotionClass: !!deck?.classList.contains('gt-demotion'),
      title: document.querySelector('#gtBody h2')?.textContent?.trim() ?? '',
      stepPresent: !!document.querySelector('#gtBody .gt-step'),
      kicker: {
        label: kicker?.textContent?.trim() ?? '',
        visible: !!kickerBox && kickerBox.width > 0 && kickerBox.height > 0
          && kickerStyle?.display !== 'none' && kickerStyle?.visibility !== 'hidden'
          && Number(kickerStyle?.opacity) !== 0,
        box: kickerBox ? { width: kickerBox.width, height: kickerBox.height } : null,
      },
      dots: document.getElementById('gtDots')?.children.length ?? -1,
      tierColor: color(deck, '--gt-tier'),
      oldColor: color(deck, '--gt-old'),
      ivory,
      silver,
      ringVisible: !!lring && lring.getBoundingClientRect().width > 0
        && ringFill !== 'none',
      ringUsesIvory: compact(ringFill).includes(compact(ivory)),
      oldArcUsesSilver: compact(oldFill).includes(compact(silver)),
      names: overlay?.getAnimations({ subtree: true })
        .filter((animation) => animation.playState === 'pending'
          || animation.playState === 'running')
        .map((animation) => animation.animationName || animation.transitionProperty) ?? [],
    };
  });

  await page.click('#gtNext');
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const closed = await page.evaluate(() => ({
    transitionOpen: document.getElementById('ovGroupTransition')?.classList.contains('on') ?? false,
    visibleTitle: document.querySelector('#gtBody h2')?.textContent?.trim() ?? '',
    focus: document.activeElement?.id ?? '',
    resultOpen: document.getElementById('ovEnd')?.classList.contains('on') ?? false,
    resultInert: document.getElementById('ovEnd')?.inert ?? true,
  }));
  return { group, closed };
}

async function singlePageProbe(page) {
  const matchId = '90000000-0000-4000-8000-000000000103';
  await open(page, progression({
    id: '91000000-0000-4000-8000-000000000103',
    matchId,
    points_before: 1259,
    points_after: 1300,
    equipped_rune_before: 'ward',
    equipped_rune_after: 'ward',
    rune_seat_active_before: true,
    rune_seat_active_after: true,
  }), { won: true, delta: 41 });
  await page.evaluate(() => new Promise((resolve) => {
    window.dispatchEvent(new Event('resize'));
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const opened = await page.evaluate(() => {
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
      const elementStyle = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && elementStyle.display !== 'none'
        && elementStyle.visibility !== 'hidden' && Number(elementStyle.opacity) !== 0;
    };
    const hint = document.getElementById('gtSwipe');
    const pageLabel = document.getElementById('gtPage');
    const deck = document.querySelector('.gt-deck');
    const dots = document.getElementById('gtDots');
    const activeDot = dots?.querySelector('i[aria-current="true"]');
    const primary = document.getElementById('gtNext');
    return {
      title: document.querySelector('#gtBody h2')?.textContent?.trim() ?? '',
      dots: document.getElementById('gtDots')?.children.length ?? -1,
      primary: document.getElementById('gtNext')?.textContent?.trim() ?? '',
      hint: hint?.textContent?.trim() ?? '',
      hintVisible: visible(hint),
      page: {
        label: pageLabel?.textContent?.trim() ?? '',
        visible: visible(pageLabel),
      },
      layout: {
        viewport: { width: innerWidth, height: innerHeight },
        deck: rect(deck),
        dots: rect(dots),
        activeDot: rect(activeDot),
        currentDots: dots?.querySelectorAll('i[aria-current="true"]').length ?? -1,
        primary: rect(primary),
      },
      landscape: document.getElementById('kbroot')?.classList.contains('land') ?? false,
    };
  });
  await page.click('#gtNext');
  await page.waitForFunction(() =>
    !document.getElementById('ovGroupTransition')?.classList.contains('on'));
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const closed = await page.evaluate(() => ({
    focus: document.activeElement?.id ?? '',
    landscape: document.getElementById('kbroot')?.classList.contains('land') ?? false,
    resultOpen: document.getElementById('ovEnd')?.classList.contains('on') ?? false,
    resultInert: document.getElementById('ovEnd')?.inert ?? true,
  }));
  return { ...opened, closed };
}

export async function runGroupTransitionDemotionScenarios({ visit, out, check }) {
  const promotion = await visit({ named: true, skipStandardProbes: true,
    probe: promotionMotionProbe });
  out.groupTransitionPromotionMotion = promotion.probeResult;
  check(promotion.probeResult?.title === 'BONE'
      && promotion.probeResult.names.includes('gt-avatar-up')
      && promotion.probeResult.names.includes('gt-old-up'),
    'normal motion lost the named upward living-ladder animation', promotion.probeResult);
  check(promotion.errs.length === 0,
    'page errors during normal-motion promotion', promotion.errs);

  const demotion = await visit({ named: true, skipStandardProbes: true,
    probe: demotionProbe });
  out.groupTransitionDemotion = demotion.probeResult;
  const group = demotion.probeResult?.group;
  check(group?.demotionClass && group.title === 'IVORY'
      && !group.stepPresent
      && group.kicker.visible === false
      && (!group.kicker.box
        || (group.kicker.box.width === 0 && group.kicker.box.height === 0))
      && group.dots === 1 && group.tierColor === group.ivory
      && group.oldColor === group.silver && group.ringVisible
      && group.ringUsesIvory && group.oldArcUsesSilver
      && group.names.includes('gt-avatar-down') && group.names.includes('gt-old-down'),
    'SILVER did not visibly settle downward into IVORY without a group kicker', group);
  const closed = demotion.probeResult?.closed;
  check(!closed?.transitionOpen && closed.focus === 'btnAgain'
      && closed.resultOpen && !closed.resultInert,
    'the SILVER demotion opened a resting rune page instead of returning to the result',
    closed);
  check(demotion.errs.length === 0,
    'page errors during SILVER to IVORY demotion', demotion.errs);

  const single = await visit({ named: true, viewport: { width: 568, height: 320 },
    skipStandardProbes: true,
    probe: singlePageProbe });
  out.groupTransitionSinglePage = single.probeResult;
  check(single.probeResult?.title === 'SILVER'
      && single.probeResult.dots === 1
      && single.probeResult.primary === COPY.common.actions.continue
      && (!single.probeResult.hintVisible || single.probeResult.hint === '')
      && single.probeResult.landscape
      && single.probeResult.closed?.focus === 'btnAgain'
      && single.probeResult.closed?.landscape
      && single.probeResult.closed?.resultOpen && !single.probeResult.closed?.resultInert,
    'a historical-SILVER re-promotion kept a dead swipe hint or lost result focus/orientation on Continue',
    single.probeResult);
  check(single.errs.length === 0,
    'page errors during historical-SILVER re-promotion', single.errs);

  const portrait = await visit({ named: true, viewport: { width: 390, height: 844 },
    skipStandardProbes: true,
    probe: singlePageProbe });
  out.groupTransitionSinglePagePortrait = portrait.probeResult;
  const p = portrait.probeResult;
  const deck = p?.layout?.deck;
  const dot = p?.layout?.activeDot;
  const primary = p?.layout?.primary;
  const viewport = p?.layout?.viewport;
  const primaryCenter = primary ? primary.left + primary.width / 2 : null;
  const dotCenter = dot ? dot.left + dot.width / 2 : null;
  const deckCenter = deck ? deck.left + deck.width / 2 : null;
  check(p?.title === 'SILVER'
      && p.dots === 1
      && p.primary === COPY.common.actions.continue
      && p.page.label === '1 / 1'
      && !p.page.visible
      && deck && dot && primary && viewport
      && p.layout.currentDots === 1
      && Math.abs(primaryCenter - deckCenter) <= 1
      && Math.abs(dotCenter - primaryCenter) <= 1
      && dot.bottom <= primary.top
      && primary.height >= 44
      && deck.height >= 579 && deck.height <= 581
      && Math.abs(deck.top - (viewport.height - deck.bottom)) <= 1
      && !p.landscape,
    'a one-page portrait did not hide 1 / 1, align dot and action, or tighten the modal frame',
    p);
  check(portrait.errs.length === 0,
    'page errors during one-page portrait transition', portrait.errs);
}
