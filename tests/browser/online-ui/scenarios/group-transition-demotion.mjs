// DEMOTION MUST FEEL LIKE THE SAME LIVING LADDER MOVING DOWN.
//
// This scenario owns what the promotion deck cannot prove: SILVER settles
// visibly into IVORY, the equipped rune rests without implying that permanent
// variety was lost, and a one-page repeat crossing does not invite a swipe to
// a page that does not exist. It also pins a named normal-motion promotion
// animation; the reduced-motion sibling alone would pass if all motion vanished.
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
  rune_seat_active_after: false,
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
    const oldArc = ring?.querySelector('.gt-oldarc');
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
      step: document.querySelector('#gtBody .gt-step')?.textContent?.trim() ?? '',
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
  const resting = await page.evaluate(() => {
    const body = document.getElementById('gtBody');
    const visible = (element) => {
      if (!element) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    };
    return {
      title: body?.querySelector('h2')?.textContent?.trim() ?? '',
      text: body?.querySelector('p')?.textContent?.trim() ?? '',
      svgs: body?.querySelectorAll('svg').length ?? -1,
      icons: body?.querySelectorAll('.gt-feature-icon').length ?? -1,
      extraMedia: body?.querySelectorAll(
        'img, picture, canvas, video, .die, [class*="viz"], [class*="diagram"]',
      ).length ?? -1,
      dots: document.getElementById('gtDots')?.children.length ?? -1,
      current: [...(document.getElementById('gtDots')?.children ?? [])]
        .findIndex((dot) => dot.hasAttribute('aria-current')),
      primary: document.getElementById('gtNext')?.textContent?.trim() ?? '',
      backVisible: visible(document.getElementById('gtBack')),
    };
  });
  return { group, resting };
}

async function singlePageProbe(page) {
  const matchId = '90000000-0000-4000-8000-000000000103';
  await open(page, progression({
    id: '91000000-0000-4000-8000-000000000103',
    matchId,
    points_before: 2050,
    points_after: 2000,
    equipped_rune_before: 'ward',
    equipped_rune_after: 'ward',
    rune_seat_active_before: true,
    rune_seat_active_after: true,
  }));
  await page.evaluate(() => new Promise((resolve) => {
    window.dispatchEvent(new Event('resize'));
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const opened = await page.evaluate(() => {
    const hint = document.getElementById('gtSwipe');
    const style = hint ? getComputedStyle(hint) : null;
    const box = hint?.getBoundingClientRect();
    const visible = !!hint && !!box && box.width > 0 && box.height > 0
      && style?.display !== 'none' && style?.visibility !== 'hidden'
      && Number(style?.opacity) !== 0;
    return {
      title: document.querySelector('#gtBody h2')?.textContent?.trim() ?? '',
      dots: document.getElementById('gtDots')?.children.length ?? -1,
      primary: document.getElementById('gtNext')?.textContent?.trim() ?? '',
      hint: hint?.textContent?.trim() ?? '',
      hintVisible: visible,
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
      && group.step.includes('SILVER') && group.step.includes('IVORY')
      && group.dots === 2 && group.tierColor === group.ivory
      && group.oldColor === group.silver && group.ringVisible
      && group.ringUsesIvory && group.oldArcUsesSilver
      && group.names.includes('gt-avatar-down') && group.names.includes('gt-old-down'),
    'SILVER did not visibly settle downward into the IVORY material', group);
  const resting = demotion.probeResult?.resting;
  const restingCopy = COPY.online.groupTransition.runeRestingBody
    .replace('{{rune}}', COPY.game.runes.ward.name);
  check(resting?.title === COPY.online.groupTransition.runeRestingTitle
      && resting.text === restingCopy
      && resting.text.includes('permanent modes') && resting.text.includes('Rune Ritual')
      && resting.svgs === 1 && resting.icons === 1 && resting.extraMedia === 0
      && resting.dots === 2 && resting.current === 1
      && resting.primary === COPY.common.actions.continue && resting.backVisible,
    'the demotion did not explain the resting rune with icon, title, and retained-access text',
    resting);
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
    'a one-page demotion kept a dead swipe hint or lost result focus/orientation on Continue',
    single.probeResult);
  check(single.errs.length === 0,
    'page errors during one-page demotion', single.errs);
}
