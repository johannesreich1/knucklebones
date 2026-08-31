import {
  firstRuneFaceoffOcclusionProbe,
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
  const delayedReward = await page.evaluate(() => {
    const card = document.getElementById('endFeature');
    const copy = card?.querySelector('.endfeature-copy');
    const kicker = copy?.querySelector('small');
    const title = copy?.querySelector('b');
    const plateName = document.querySelector('#endPlates .nm2');
    const root = document.getElementById('kbroot');
    const size = (element) => element ? parseFloat(getComputedStyle(element).fontSize) : 0;
    return {
      title: title?.textContent?.trim(),
      kicker: kicker?.textContent?.trim(),
      /* THE CARD IS THE CONTROL: one button, no CTA of its own, and the rule
         text behind the tap rather than printed in the row. */
      tag: card?.tagName,
      opensDialog: card?.getAttribute('aria-haspopup'),
      buttons: card?.querySelectorAll('button').length,
      copyLines: copy?.childElementCount,
      chevron: copy?.nextElementSibling?.className,
      labelMinimum: root
        ? parseFloat(getComputedStyle(root).getPropertyValue('--font-label-min'))
        : 0,
      kickerSize: size(kicker),
      titleSize: size(title),
      plateNameSize: size(plateName),
      featureVisible: card?.hidden === false,
      opacity: getComputedStyle(card).opacity,
      animations: card.getAnimations().map(({ playState }) => playState),
    };
  });
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
      continueLabel: card.querySelector('.rune-reward-sheet__continue')?.textContent?.trim(),
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

  await page.click('.rune-reward-sheet__continue');
  await page.waitForSelector('.rune-reward-sheet', { state: 'detached', timeout: 15000 });
  await page.waitForTimeout(300);
  const recoveredContinue = await page.evaluate(() => ({
    accountVisible: document.getElementById('onAccount')?.hidden === false,
    rewardSheetOpen: !!document.querySelector('.rune-reward-sheet'),
    guideOpen: !!document.getElementById('accRuneGuide'),
    equipmentSheet: !!document.querySelector('.faceoff #accSeatEquip'),
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
    recoveredContinue,
    acknowledgeCalls: routes.acknowledgeCalls(),
  };
}

async function entryRewardProbe(page, routes) {
  const beforeClick = await page.evaluate(() => {
    const card = document.querySelector('.rune-reward-sheet .focard');
    const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
    return {
      /* the sheet pops over the already-searching queue, never over the die */
      queueSearching: document.getElementById('onQueue')?.hidden === false
        && document.querySelector('#onQueue .qmsg')?.textContent?.trim() === 'Looking for an opponent',
      loadingHidden: document.getElementById('onLoading')?.hidden === true,
      kicker: card.querySelector('.rune-reward-sheet__kicker')?.textContent?.trim(),
      title: card.querySelector('.rune-reward-sheet__title')?.textContent?.trim(),
      continueLabel: card.querySelector('.rune-reward-sheet__continue')?.textContent?.trim(),
      transformY: matrix.m42,
      animations: card.getAnimations().map(({ playState }) => playState),
    };
  });
  const joinCallsBeforeClick = routes.joinCalls();
  const acknowledgementsBeforeClick = routes.acknowledgeCalls();
  await page.click('.rune-reward-sheet__continue');
  await page.waitForSelector('#onAccount:not([hidden]) #accRuneGuide', { timeout: 15000 });
  await page.waitForFunction(() => document.activeElement?.id === 'accSeat');
  const acknowledgementsBeforeSeat = routes.acknowledgeCalls();
  await page.click('#accSeat');
  await page.waitForSelector('.faceoff #accSeatEquip', { timeout: 15000 });
  await Promise.race([
    routes.acknowledgeStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'the entry first rune was not acknowledged after its seat opened',
    )), 5000)),
  ]);
  const completed = {
    beforeClick, joinCallsBeforeClick, acknowledgementsBeforeClick,
    acknowledgementsBeforeSeat,
    acknowledgementsAfterSeat: routes.acknowledgeCalls(),
    joinsAfterSeat: routes.joinCalls(),
    accountVisible: await page.$eval('#onAccount', (element) => !element.hidden),
    equipmentSheet: await page.locator('.faceoff #accSeatEquip').count(),
  };
  /* `door: play` owns a standard queue cleanup after this probe. Return there
     only after capturing the tutorial's terminal equipment sheet. */
  await page.keyboard.press('Escape');
  await page.waitForSelector('.faceoff #accSeatEquip', { state: 'detached', timeout: 15000 });
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  await page.click('#btnOnline');
  await page.waitForSelector('#onQueue:not([hidden])', { timeout: 15000 });
  return completed;
}

/* The profile rune collection grid and its shared detail sheet moved to
   profile-rune-sheet.mjs; this file keeps the reward delivery and recovery
   races around the ranked result screen. */
export async function runRuneTrialUiScenarios({ visit, out, check }) {
  const result = await visit({
    named: true,
    runes: ['ward', 'fate'],
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
      && result.probeResult.delayedReward.opacity === '0'
      && result.probeResult.delayedReward.animations.some((state) =>
        state === 'pending' || state === 'running')
      && result.probeResult.acknowledgementsDuringDelay === 0
      && result.probeResult.afterDelayedClose?.homeOpen
      && result.probeResult.afterDelayedClose.acknowledgeCalls === 0,
    'closing during the delayed result reward acknowledged a card the player had not seen',
    result.probeResult);
  /* The card is the door and the rune's rules live behind it: one button, two
     lines, and type that outranks the plates it sits under. */
  check(result.probeResult?.delayedReward?.tag === 'BUTTON'
      && result.probeResult.delayedReward.opensDialog === 'dialog'
      && result.probeResult.delayedReward.buttons === 0
      && result.probeResult.delayedReward.copyLines === 2
      && result.probeResult.delayedReward.chevron === 'chev'
      && result.probeResult.delayedReward.labelMinimum >= 10
      && result.probeResult.delayedReward.kickerSize
        >= result.probeResult.delayedReward.labelMinimum
      && result.probeResult.delayedReward.titleSize
        > result.probeResult.delayedReward.plateNameSize,
    'the result reward card kept a CTA, an inline explanation, or shrunken type',
    result.probeResult?.delayedReward);
  check(result.probeResult?.recoveredArrival?.kicker === 'NEW RUNE'
      && result.probeResult.recoveredArrival.title === 'FATE'
      && result.probeResult.recoveredArrival.continueLabel === 'Continue'
      && result.probeResult.recoveredArrival.transformY > 0
      && result.probeResult.acknowledgementsBeforeSheetLanded === 0
      && Math.abs(result.probeResult.recoveredPresented?.transformY ?? 99) < 1
      && !result.probeResult.recoveredPresented?.animations.some((state) =>
        state === 'pending' || state === 'running')
      && result.probeResult.recoveredPresented?.focusedInside
      && result.probeResult.acknowledgementsAfterSheetLanded === 1,
    'profile recovery did not present the durable later rune before acknowledging it',
    result.probeResult);
  check(result.probeResult?.recoveredContinue?.accountVisible
      && !result.probeResult.recoveredContinue.rewardSheetOpen
      && !result.probeResult.recoveredContinue.guideOpen
      && !result.probeResult.recoveredContinue.equipmentSheet
      && result.probeResult.acknowledgeCalls === 1,
    'recovered later-rune Continue opened the first-rune equipment tutorial',
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
  check(entryReward.probeResult?.beforeClick?.queueSearching
      && entryReward.probeResult.beforeClick.loadingHidden
      && entryReward.probeResult.beforeClick.kicker === 'NEW RUNE'
      && entryReward.probeResult.beforeClick.title === 'WARD'
      && entryReward.probeResult.beforeClick.continueLabel === 'Equip rune'
      && entryReward.probeResult.beforeClick.transformY > 0
      && entryReward.probeResult.joinCallsBeforeClick === 0
      && entryReward.probeResult.acknowledgementsBeforeClick === 0
      && entryReward.probeResult.acknowledgementsBeforeSeat === 0
      && entryReward.probeResult.acknowledgementsAfterSeat === 1
      && entryReward.probeResult.joinsAfterSeat === 0
      && entryReward.probeResult.accountVisible
      && entryReward.probeResult.equipmentSheet === 1,
    'authenticated first-rune recovery skipped the mandatory equipment tutorial',
    entryReward.probeResult);
  check(entryReward.errs.length === 0, 'page errors during authenticated reward recovery', entryReward.errs);

  const profileOcclusion = await visit({
    named: true,
    runes: ['ward', 'fate'],
    skipStandardProbes: true,
    probe: resultRewardProfileOcclusionProbe,
  });
  out.runeRewardProfileOcclusion = profileOcclusion.probeResult;
  check(profileOcclusion.probeResult?.whileCovered?.onlineVisible
      && profileOcclusion.probeResult.whileCovered.profileLoading
      && profileOcclusion.probeResult.whileCovered.resultStillMounted
      && !profileOcclusion.probeResult.whileCovered.rewardOwnsHit
      && profileOcclusion.probeResult.acknowledgementsWhileCovered === 0
      && profileOcclusion.probeResult.beforeContinue?.action === 'Continue'
      && profileOcclusion.probeResult.beforeContinue.acknowledgements === 1
      && profileOcclusion.probeResult.acknowledgementsAfterContinue === 1
      && profileOcclusion.probeResult.guidePresent === 0,
    'a result reward was acknowledged underneath Profile instead of recovering on top',
    profileOcclusion.probeResult);
  check(profileOcclusion.errs.length === 0, 'page errors during Profile reward occlusion',
    profileOcclusion.errs);

  const faceoffOcclusion = await visit({
    named: true,
    runes: ['ward', 'fate'],
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

  const firstRuneOcclusion = await visit({
    named: true,
    runes: [],
    skipStandardProbes: true,
    probe: firstRuneFaceoffOcclusionProbe,
  });
  out.firstRuneFaceoffOcclusion = firstRuneOcclusion.probeResult;
  check(firstRuneOcclusion.probeResult?.whileCovered?.faceoffOpen
      && !firstRuneOcclusion.probeResult.whileCovered.rewardSheetOpen
      && firstRuneOcclusion.probeResult.whileCovered.acknowledgements === 0
      && firstRuneOcclusion.probeResult.resumed?.title === 'FATE'
      && firstRuneOcclusion.probeResult.resumed.action === 'Equip rune'
      && firstRuneOcclusion.probeResult.resultInertDuringGuide
      && firstRuneOcclusion.probeResult.acknowledgementsBeforeSeat === 0
      && firstRuneOcclusion.probeResult.acknowledgementsAfterSeat === 1,
    'a covered result discarded the delayed first-rune equipment tutorial',
    firstRuneOcclusion.probeResult);
  check(firstRuneOcclusion.errs.length === 0,
    'page errors during covered first-rune recovery', firstRuneOcclusion.errs);
  await runNextDuelRewardScenario({ visit, out, check });
  await runRuneRewardRaceScenarios({ visit, out, check });
}
