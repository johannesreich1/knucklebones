import { SPELLS } from '../../../../src/core/spells.ts';
import {
  resultRewardFaceoffOcclusionProbe,
  resultRewardProfileOcclusionProbe,
  runNextDuelRewardScenario,
} from './rune-reward-occlusion.mjs';
import { runRuneRewardRaceScenarios } from './rune-reward-races.mjs';

const REPORT = {
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

async function profileRuneProbe(page) {
  const collection = await page.evaluate(() => {
    const visible = (element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const slots = [...document.querySelectorAll('#accRuneGrid .accrune')].map((slot) => {
      const box = slot.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return {
        rune: slot.dataset.rune,
        tag: slot.tagName,
        label: slot.getAttribute('aria-label'),
        disabled: slot.getAttribute('aria-disabled'),
        nativeDisabled: slot.disabled,
        tabIndex: slot.tabIndex,
        collected: slot.classList.contains('collected'),
        locked: slot.classList.contains('locked'),
        visible: visible(slot),
        centreHit: slot === hit || slot.contains(hit),
        height: box.height,
        opacity: getComputedStyle(slot).opacity,
      };
    });
    const title = document.getElementById('accRunesTitle');
    const count = document.getElementById('accRuneCount');
    const root = document.getElementById('kbroot');
    return {
      count: count?.textContent?.trim(),
      titleFontSize: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
      countFontSize: count ? parseFloat(getComputedStyle(count).fontSize) : 0,
      labelMinimum: root
        ? parseFloat(getComputedStyle(root).getPropertyValue('--font-label-min'))
        : 0,
      gridLabel: document.getElementById('accRuneGrid')?.getAttribute('aria-label'),
      slots,
    };
  });

  const readSheet = () => page.evaluate(() => {
    const overlay = document.querySelector('.faceoff.libsheet');
    const card = overlay?.querySelector('.focard');
    const detail = overlay?.querySelector('.mcdetail');
    const meta = overlay?.querySelector('.mcmeta');
    const detailBox = detail?.getBoundingClientRect();
    const metaBox = meta?.getBoundingClientRect();
    return {
      open: !!overlay && !!card,
      rosterOpen: !!document.querySelector('#ovSpells.on'),
      classes: overlay?.className ?? '',
      role: card?.getAttribute('role'),
      modal: card?.getAttribute('aria-modal'),
      label: card?.getAttribute('aria-label'),
      name: overlay?.querySelector('.mcname')?.textContent?.trim() ?? '',
      blurb: overlay?.querySelector('.mcblurb')?.textContent?.trim() ?? '',
      detail: detail?.textContent?.trim() ?? '',
      meta: meta?.textContent?.trim() ?? '',
      metaHidden: meta?.hidden ?? null,
      metaSeparate: !!detailBox && !!metaBox && metaBox.top > detailBox.bottom,
      metaBorder: meta ? getComputedStyle(meta).borderTopWidth : '',
      icon: !!overlay?.querySelector('.mchead svg'),
      hued: card?.classList.contains('hued') ?? false,
    };
  });

  await page.click('#accRuneGrid .accrune[data-rune="fate"]');
  await page.waitForSelector('.faceoff.libsheet .focard', { timeout: 5000 });
  await page.waitForTimeout(380);
  const unlocked = await readSheet();
  unlocked.expectedMeta = await page.evaluate(() => `Unlocked at ${new Intl.DateTimeFormat(
    document.documentElement.lang,
    { dateStyle: 'medium', timeStyle: 'short' },
  ).format(new Date('2026-08-01T00:00:00Z'))}`);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.faceoff.libsheet', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(50);
  unlocked.focusRestored = await page.evaluate(() =>
    document.activeElement?.matches('#accRuneGrid .accrune[data-rune="fate"]'));

  await page.focus('#accRuneGrid .accrune[data-rune="nudge"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.faceoff.libsheet .focard', { timeout: 5000 });
  await page.waitForTimeout(380);
  const locked = await readSheet();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['de-DE'] });
    window.dispatchEvent(new Event('languagechange'));
  });
  await page.waitForFunction(() => document.documentElement.dataset.locale === 'de');
  locked.localized = await readSheet();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.faceoff.libsheet', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(50);
  locked.focusRestored = await page.evaluate(() =>
    document.activeElement?.matches('#accRuneGrid .accrune[data-rune="nudge"]'));
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] });
    window.dispatchEvent(new Event('languagechange'));
  });
  await page.waitForFunction(() => document.documentElement.dataset.locale === 'en');

  return { ...collection, unlocked, locked };
}

async function resultRewardRecoveryProbe(page, routes) {
  routes.makeRuneUnseen('fate');
  routes.deferNextRuneResponse();
  await page.evaluate((report) => window.__kbResult(report), REPORT);
  await Promise.all([
    page.waitForSelector('#ovEnd.on', { timeout: 15000 }),
    Promise.race([
      routes.runeRequestStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error(
        'the delayed result collection request never started',
      )), 5000)),
    ]),
  ]);
  const pending = await page.evaluate(() => {
    const overlay = document.getElementById('ovEnd');
    const box = overlay?.getBoundingClientRect();
    const visible = (selector) => {
      const element = document.querySelector(selector);
      const bounds = element?.getBoundingClientRect();
      return !!bounds && bounds.width > 0 && bounds.height > 0;
    };
    return {
      resultVisible: !!overlay?.classList.contains('on') && !!box && box.width > 0 && box.height > 0,
      title: document.getElementById('endTitle')?.textContent?.trim(),
      score: `${document.getElementById('endYou')?.textContent}:${document.getElementById('endCpu')?.textContent}`,
      featureHidden: document.getElementById('endFeature')?.hidden,
      nextVisible: visible('#btnAgain'),
      homeVisible: visible('#btnEndQuiet'),
    };
  });

  await page.click('#btnEndQuiet');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  routes.releaseRuneResponse();
  await Promise.race([
    routes.runeRequestFinished,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'the released result collection request never finished',
    )), 5000)),
  ]);
  await page.waitForTimeout(100);
  const afterNavigation = await page.evaluate(() => ({
    resultOpen: document.getElementById('ovEnd')?.classList.contains('on'),
    homeOpen: document.getElementById('ovStart')?.classList.contains('on'),
    featureHidden: document.getElementById('endFeature')?.hidden,
    featureText: document.getElementById('endFeature')?.textContent?.trim(),
  }));

  await page.evaluate((report) => window.__kbResult({
    ...report, won: false, my: report.their, their: report.my,
  }), REPORT);
  await page.waitForSelector('#ovEnd.on', { timeout: 15000 });
  await page.waitForTimeout(250);
  const lossWithOlderReward = await page.evaluate(() => ({
    title: document.getElementById('endTitle')?.textContent?.trim(),
    featureHidden: document.getElementById('endFeature')?.hidden,
    featureText: document.getElementById('endFeature')?.textContent?.trim(),
  }));
  await page.click('#btnEndQuiet');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });

  await page.evaluate((report) => window.__kbResult(report), REPORT);
  await page.waitForSelector('#ovEnd.on #endFeature:not([hidden])', { timeout: 15000 });
  const delayedReward = await page.evaluate(() => ({
    title: document.querySelector('#endFeature .endfeature-copy b')?.textContent?.trim(),
    kicker: document.querySelector('#endFeature .endfeature-copy small')?.textContent?.trim(),
    action: document.querySelector('#endFeature .endfeature-action')?.textContent?.trim(),
    featureVisible: document.getElementById('endFeature')?.hidden === false,
    opacity: getComputedStyle(document.getElementById('endFeature')).opacity,
    animations: document.getElementById('endFeature').getAnimations()
      .map(({ playState }) => playState),
  }));
  const acknowledgementsDuringDelay = routes.acknowledgeCalls();
  await page.click('#btnEndQuiet');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  await page.waitForTimeout(2100);
  const afterDelayedClose = {
    homeOpen: await page.$eval('#ovStart', (element) => element.classList.contains('on')),
    acknowledgeCalls: routes.acknowledgeCalls(),
  };

  await page.click('#homeChip');
  await page.waitForSelector('.rune-reward-sheet .focard', { timeout: 15000 });
  const recoveredArrival = await page.evaluate(() => {
    const card = document.querySelector('.rune-reward-sheet .focard');
    const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
    return {
      kicker: card.querySelector('.rune-reward-sheet__kicker')?.textContent?.trim(),
      title: card.querySelector('.rune-reward-sheet__title')?.textContent?.trim(),
      action: card.querySelector('.rune-reward-sheet__try')?.textContent?.trim(),
      transformY: matrix.m42,
      animations: card.getAnimations().map(({ playState }) => playState),
    };
  });
  const acknowledgementsBeforeSheetLanded = routes.acknowledgeCalls();
  await Promise.race([
    routes.acknowledgeStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'the recovered rune reward was not acknowledged after its sheet landed',
    )), 5000)),
  ]);
  const recoveredPresented = await page.evaluate(() => {
    const card = document.querySelector('.rune-reward-sheet .focard');
    const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
    return {
      transformY: matrix.m42,
      animations: card.getAnimations().map(({ playState }) => playState),
      focusedInside: card.contains(document.activeElement),
    };
  });
  const acknowledgementsAfterSheetLanded = routes.acknowledgeCalls();

  await page.click('.rune-reward-sheet__try');
  await page.waitForFunction(() => {
    const state = window.__kb.S;
    return state.mode === 'cpu' && state.diff === 'medium' && state.scoring === 0;
  }, null, { timeout: 15000 });
  const tryoutStarted = await page.evaluate(() => ({
    mode: window.__kb.S.mode,
    difficulty: window.__kb.S.diff,
    scoring: window.__kb.S.scoring,
    hands: window.__kb.S.spellCharges.map((hand) => Object.keys(hand)),
  }));
  await page.evaluate(async () => {
    const game = window.__kb;
    game.S.gen++;
    game.S.boards[1] = [[6, 6, 6], [6, 6, 6], [6, 6]];
    game.S.boards[0] = [[1], [1], [1]];
    game.S.turn = 1;
    game.S.bottom = 1;
    game.S.phase = 'choose';
    game.S.busy = false;
    game.S.die = 6;
    game.renderAll(false);
    game.applySides();
    game.setStageDie(6, 1);
    await game.place(1, 2);
  });
  await page.waitForSelector('#ovEnd.on', { timeout: 15000 });
  const tryoutResult = await page.evaluate(() => ({
    action: document.getElementById('btnAgain')?.textContent?.trim(),
    quietHidden: document.getElementById('btnEndQuiet')?.hidden,
  }));
  await page.click('#btnAgain');
  await page.waitForSelector('#ovOnline.on #onAccount:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(300);
  const rankedReturn = await page.evaluate(() => ({
    accountVisible: document.getElementById('onAccount')?.hidden === false,
    rewardSheetOpen: !!document.querySelector('.rune-reward-sheet'),
  }));
  return {
    pending,
    afterNavigation,
    lossWithOlderReward,
    delayedReward,
    acknowledgementsDuringDelay,
    afterDelayedClose,
    recoveredArrival,
    acknowledgementsBeforeSheetLanded,
    recoveredPresented,
    acknowledgementsAfterSheetLanded,
    tryoutStarted,
    tryoutResult,
    rankedReturn,
    acknowledgeCalls: routes.acknowledgeCalls(),
  };
}

async function entryRewardProbe(page, routes) {
  const beforeClick = await page.evaluate(() => {
    const card = document.querySelector('.rune-reward-sheet .focard');
    const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
    return {
      queueHidden: document.getElementById('onQueue')?.hidden,
      kicker: card.querySelector('.rune-reward-sheet__kicker')?.textContent?.trim(),
      title: card.querySelector('.rune-reward-sheet__title')?.textContent?.trim(),
      continueLabel: card.querySelector('.rune-reward-sheet__continue')?.textContent?.trim(),
      transformY: matrix.m42,
      animations: card.getAnimations().map(({ playState }) => playState),
    };
  });
  const acknowledgementsBeforeClick = routes.acknowledgeCalls();
  await page.click('.rune-reward-sheet__continue');
  await Promise.race([
    routes.acknowledgeStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'an explicit Continue did not acknowledge its rune reward',
    )), 5000)),
  ]);
  await page.waitForSelector('#onQueue:not([hidden])', { timeout: 15000 });
  return {
    beforeClick,
    acknowledgementsBeforeClick,
    acknowledgementsAfterClick: routes.acknowledgeCalls(),
    queueVisible: await page.$eval('#onQueue', (element) => !element.hidden),
  };
}

export async function runRuneTrialUiScenarios({ visit, out, check }) {
  const profile = await visit({
    named: true,
    runes: ['fate', 'ward'],
    skipStandardProbes: true,
    probe: profileRuneProbe,
  });
  out.runeCollectionProfile = profile.probeResult;
  const slots = profile.probeResult?.slots ?? [];
  check(slots.length === 6
      && JSON.stringify(slots.map(({ rune }) => rune))
        === JSON.stringify(SPELLS.map(({ id }) => id))
      && slots.every(({ visible, label }) => visible && !!label)
      && slots.filter(({ collected, disabled }) => collected && disabled === null).length === 2
      && slots.filter(({ locked, disabled }) => locked && disabled === null).length === 4
      && slots.every(({ tag, nativeDisabled, tabIndex, centreHit, height }) =>
        tag === 'BUTTON' && !nativeDisabled && tabIndex >= 0 && centreHit && height >= 44)
      && profile.probeResult?.count === '2 / 6'
      && profile.probeResult?.gridLabel?.includes('2'),
    'profile did not render canonical-order visible 44px rune buttons with owned/locked state',
    profile.probeResult);
  check(profile.probeResult?.labelMinimum >= 10
      && profile.probeResult.titleFontSize >= 10
      && profile.probeResult.countFontSize >= 10
      && profile.probeResult.titleFontSize >= profile.probeResult.labelMinimum
      && profile.probeResult.countFontSize >= profile.probeResult.labelMinimum,
    'profile rune heading and count fell below the shared compact-label minimum',
    profile.probeResult);
  const unlocked = profile.probeResult?.unlocked;
  check(unlocked?.open && unlocked.classes.includes('libsheet') && !unlocked.rosterOpen
      && unlocked.role === 'dialog' && unlocked.modal === 'true'
      && unlocked.label === 'FATE' && unlocked.name === 'FATE'
      && unlocked.blurb === 'Throw your die back and draw another.'
      && unlocked.detail.startsWith('Discard the die in hand')
      && unlocked.meta === unlocked.expectedMeta && !unlocked.metaHidden
      && unlocked.metaSeparate && unlocked.metaBorder !== '0px'
      && unlocked.icon && unlocked.hued && unlocked.focusRestored,
    'a collected profile rune did not open the shared rune sheet with its unlock timestamp',
    unlocked);
  const locked = profile.probeResult?.locked;
  check(locked?.open && locked.classes.includes('libsheet') && !locked.rosterOpen
      && locked.role === 'dialog' && locked.modal === 'true'
      && locked.label === 'NUDGE' && locked.name === 'NUDGE'
      && locked.blurb === 'LOCKED'
      && locked.detail === 'Win this rune in RUNE RITUAL to unlock it.'
      && !locked.detail.includes('one pip') && locked.meta === '' && locked.metaHidden
      && locked.icon && locked.hued && locked.focusRestored
      && locked.localized?.name === 'SCHUBS' && locked.localized.blurb === 'GESPERRT'
      && locked.localized.detail === 'Gewinne diese Rune im RUNENRITUAL, um sie freizuschalten.',
    'a locked profile rune exposed its mechanics or did not explain how to unlock it',
    locked);
  check(profile.errs.length === 0, 'page errors while rendering the rune collection profile', profile.errs);

  const result = await visit({
    named: true,
    runes: ['fate'],
    skipStandardProbes: true,
    probe: resultRewardRecoveryProbe,
  });
  out.runeRewardRace = result.probeResult;
  check(result.probeResult?.pending?.resultVisible
      && result.probeResult.pending.title === 'VICTORY'
      && result.probeResult.pending.score === '48:31'
      && result.probeResult.pending.featureHidden
      && result.probeResult.pending.nextVisible
      && result.probeResult.pending.homeVisible,
    'ranked result withheld its base screen while rune reward collection was pending',
    result.probeResult?.pending);
  check(result.probeResult?.afterNavigation?.homeOpen
      && !result.probeResult.afterNavigation.resultOpen
      && result.probeResult.afterNavigation.featureHidden
      && result.probeResult.afterNavigation.featureText === '',
    'a stale rune reward response repainted the result after Home won navigation',
    result.probeResult?.afterNavigation);
  check(result.probeResult?.lossWithOlderReward?.title === 'DEFEAT'
      && result.probeResult.lossWithOlderReward.featureHidden
      && result.probeResult.lossWithOlderReward.featureText === '',
    'an older unseen reward was misleadingly presented as earned by a loss',
    result.probeResult?.lossWithOlderReward);
  check(result.probeResult?.delayedReward?.featureVisible
      && result.probeResult.delayedReward.kicker === 'NEW RUNE'
      && result.probeResult.delayedReward.title === 'FATE'
      && result.probeResult.delayedReward.action === 'TRY IT'
      && result.probeResult.delayedReward.opacity === '0'
      && result.probeResult.delayedReward.animations.some((state) =>
        state === 'pending' || state === 'running')
      && result.probeResult.acknowledgementsDuringDelay === 0
      && result.probeResult.afterDelayedClose?.homeOpen
      && result.probeResult.afterDelayedClose.acknowledgeCalls === 0,
    'closing during the delayed result reward acknowledged a card the player had not seen',
    result.probeResult);
  check(result.probeResult?.recoveredArrival?.kicker === 'NEW RUNE'
      && result.probeResult.recoveredArrival.title === 'FATE'
      && result.probeResult.recoveredArrival.action === 'TRY IT'
      && result.probeResult.recoveredArrival.transformY > 0
      && result.probeResult.acknowledgementsBeforeSheetLanded === 0
      && Math.abs(result.probeResult.recoveredPresented?.transformY ?? 99) < 1
      && !result.probeResult.recoveredPresented?.animations.some((state) =>
        state === 'pending' || state === 'running')
      && result.probeResult.recoveredPresented?.focusedInside
      && result.probeResult.acknowledgementsAfterSheetLanded === 1,
    'profile recovery did not present the durable reward before acknowledging it',
    result.probeResult);
  check(result.probeResult?.tryoutStarted?.mode === 'cpu'
      && result.probeResult.tryoutStarted.difficulty === 'medium'
      && result.probeResult.tryoutStarted.scoring === 0
      && result.probeResult.tryoutStarted.hands.every((hand) => hand[0] === 'fate')
      && result.probeResult.tryoutResult?.action === 'Back to ranked'
      && result.probeResult.tryoutResult.quietHidden
      && result.probeResult.rankedReturn?.accountVisible
      && !result.probeResult.rankedReturn.rewardSheetOpen
      && result.probeResult.acknowledgeCalls === 1,
    'recovered TRY IT did not return to the profile or acknowledged the reward twice',
    result.probeResult);
  check(result.errs.length === 0, 'page errors during the delayed rune reward transition', result.errs);

  const entryReward = await visit({
    door: 'play',
    named: true,
    runes: ['ward'],
    unseenRunes: ['ward'],
    expectReward: true,
    skipStandardProbes: true,
    probe: entryRewardProbe,
  });
  out.runeRewardEntry = entryReward.probeResult;
  check(entryReward.probeResult?.beforeClick?.queueHidden
      && entryReward.probeResult.beforeClick.kicker === 'NEW RUNE'
      && entryReward.probeResult.beforeClick.title === 'WARD'
      && entryReward.probeResult.beforeClick.continueLabel === 'Continue'
      && entryReward.probeResult.beforeClick.transformY > 0
      && entryReward.probeResult.acknowledgementsBeforeClick === 0
      && entryReward.probeResult.acknowledgementsAfterClick === 1
      && entryReward.probeResult.queueVisible,
    'authenticated entry discarded its unseen reward or Continue failed to acknowledge before queueing',
    entryReward.probeResult);
  check(entryReward.errs.length === 0, 'page errors during authenticated reward recovery', entryReward.errs);

  const profileOcclusion = await visit({
    named: true,
    runes: ['fate'],
    skipStandardProbes: true,
    probe: resultRewardProfileOcclusionProbe,
  });
  out.runeRewardProfileOcclusion = profileOcclusion.probeResult;
  check(profileOcclusion.probeResult?.whileCovered?.onlineVisible
      && profileOcclusion.probeResult.whileCovered.profileLoading
      && profileOcclusion.probeResult.whileCovered.resultStillMounted
      && !profileOcclusion.probeResult.whileCovered.rewardOwnsHit
      && profileOcclusion.probeResult.acknowledgementsWhileCovered === 0
      && profileOcclusion.probeResult.acknowledgementsAfterContinue === 1,
    'a result reward was acknowledged underneath Profile instead of recovering on top',
    profileOcclusion.probeResult);
  check(profileOcclusion.errs.length === 0, 'page errors during Profile reward occlusion',
    profileOcclusion.errs);

  const faceoffOcclusion = await visit({
    named: true,
    runes: ['fate'],
    skipStandardProbes: true,
    probe: resultRewardFaceoffOcclusionProbe,
  });
  out.runeRewardFaceoffOcclusion = faceoffOcclusion.probeResult;
  check(faceoffOcclusion.probeResult?.whileCovered?.faceoffOpen
      && !faceoffOcclusion.probeResult.whileCovered.rewardOwnsHit
      && faceoffOcclusion.probeResult.acknowledgementsWhileCovered === 0
      && faceoffOcclusion.probeResult.acknowledgementsAfterClose === 1,
    'a result reward acknowledged underneath face-off or failed to resume after it closed',
    faceoffOcclusion.probeResult);
  check(faceoffOcclusion.errs.length === 0, 'page errors during face-off reward occlusion',
    faceoffOcclusion.errs);
  await runNextDuelRewardScenario({ visit, out, check });
  await runRuneRewardRaceScenarios({ visit, out, check });
}
