// The permanent SILVER equipment unlock and delayed first-rune tutorial share
// one owner: the real Profile rune seat and its canonical equipment sheet.
import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import {
  bounded,
  readDeck,
  readModeShape,
  REPORT,
  silverProgression,
} from './group-transition-fixtures.mjs';
import {
  installProgressionRoutes,
  showTransitionResult,
} from './group-transition-harness.mjs';
import { waitForOverlayTransitions } from '../../support/overlay-transitions.mjs';

const COPY = RESOURCES.en;

async function silverNoRuneProbe(page) {
  const matchId = '90000000-0000-4000-8000-000000000004';
  const progression = await installProgressionRoutes(page, silverProgression(
    '91000000-0000-4000-8000-000000000004', matchId,
  ));
  await showTransitionResult(page, { ...REPORT, matchId });
  await page.click('#gtNext');
  const final = await readDeck(page);
  const shape = await readModeShape(page);
  const acknowledgementsBeforeContinue = progression.acknowledgements.length;
  await page.click('#gtNext');
  await bounded(progression.acknowledged,
    'the no-rune SILVER Continue did not acknowledge progression');
  await page.waitForTimeout(50);
  return {
    final,
    shape,
    acknowledgementsBeforeContinue,
    acknowledgements: progression.acknowledgements.length,
    onlineOpen: await page.$eval('#ovOnline', (overlay) => overlay.classList.contains('on')),
    guideVisible: await page.locator('#accRuneGuide').count(),
  };
}

async function silverOwnedRuneProbe(page) {
  const matchId = '90000000-0000-4000-8000-000000000005';
  const progression = await installProgressionRoutes(page, silverProgression(
    '91000000-0000-4000-8000-000000000005', matchId,
  ));
  await showTransitionResult(page, { ...REPORT, matchId });
  await page.click('#gtNext');
  const final = await readDeck(page);
  const shape = await readModeShape(page);
  await page.click('#gtNext');
  await page.waitForSelector('#onAccount:not([hidden]) #accRuneGuide', { timeout: 10000 });
  await page.waitForFunction(() => document.activeElement?.id === 'accSeat');
  const guided = await page.evaluate(() => {
    const seat = document.getElementById('accSeat');
    const guide = document.getElementById('accRuneGuide');
    const head = document.querySelector('#ovOnline .shead');
    const box = seat?.getBoundingClientRect();
    const style = seat ? getComputedStyle(seat) : null;
    return {
      profileVisible: document.getElementById('onAccount')?.hidden === false,
      resultStillOpen: document.getElementById('ovEnd')?.classList.contains('on') ?? false,
      resultInert: document.getElementById('ovEnd')?.inert ?? false,
      guideTitle: guide?.querySelector('.acc-rune-guide-title')?.textContent?.trim() ?? '',
      guideBody: guide?.querySelector('.acc-rune-guide-body')?.textContent?.trim() ?? '',
      seatVisible: !seat?.hidden && !!box && box.width > 0 && box.height > 0,
      seatSize: box ? { width: box.width, height: box.height } : null,
      seatFocused: document.activeElement === seat,
      describedBy: seat?.getAttribute('aria-describedby') ?? '',
      highlighted: seat?.classList.contains('acc-rune-guide-target') ?? false,
      animation: style?.animationName ?? '',
      headerInert: head?.inert ?? false,
    };
  });
  const acknowledgementsBeforeSeat = progression.acknowledgements.length;
  await page.click('#accSeat');
  await page.waitForSelector('.faceoff #accSeatEquip', { timeout: 10000 });
  await bounded(progression.acknowledged,
    'the owned-rune SILVER guide did not acknowledge after the seat tap');
  const completed = await page.evaluate(() => ({
    guidePresent: !!document.getElementById('accRuneGuide'),
    profileVisible: document.getElementById('onAccount')?.hidden === false,
    resultInert: document.getElementById('ovEnd')?.inert ?? false,
    equipmentSheet: !!document.querySelector('.faceoff #accSeatEquip'),
    duplicateRuneCards: document.querySelectorAll('.faceoff .accrune').length,
    acknowledgementsVisible: true,
  }));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.faceoff #accSeatEquip', { state: 'detached' });
  await page.click('#btnOnlineBack');
  await page.waitForFunction(() => !document.getElementById('ovOnline')?.classList.contains('on'));
  /* Back runs the shared Neon Wipe, which borrows inert on the incoming
     result until it lands (src/ui/page-motion.ts). Judge the restored result
     where the player can act on it. */
  await waitForOverlayTransitions(page, '#ovOnline');
  const returned = await page.evaluate(() => ({
    resultOpen: document.getElementById('ovEnd')?.classList.contains('on') ?? false,
    resultInert: document.getElementById('ovEnd')?.inert ?? true,
    onlineOpen: document.getElementById('ovOnline')?.classList.contains('on') ?? false,
  }));
  return {
    final,
    shape,
    guided,
    acknowledgementsBeforeSeat,
    acknowledgements: progression.acknowledgements.length,
    completed,
    returned,
  };
}

async function firstRuneRewardProbe(page, routes) {
  const matchId = '11111111-1111-4111-8111-111111111111';
  routes.makeRuneUnseen('ward');
  const progression = await installProgressionRoutes(page, {
    ...silverProgression('91000000-0000-4000-8000-000000000006', matchId),
    points_before: 1300,
    points_after: 1340,
    rune_seat_active_before: true,
  });
  await page.evaluate((report) => {
    window.__kb.S.played = true;
    window.__kbResult(report);
  }, { ...REPORT, matchId, delta: 40 });
  await page.waitForSelector('.rune-reward-sheet .focard', { timeout: 10000 });
  const modal = await page.evaluate(() => {
    const sheet = document.querySelector('.rune-reward-sheet .focard');
    return {
      resultOpen: document.getElementById('ovEnd')?.classList.contains('on') ?? false,
      inlineRewardHidden: document.getElementById('endFeature')?.hidden ?? false,
      kicker: sheet?.querySelector('.rune-reward-sheet__kicker')?.textContent?.trim() ?? '',
      title: sheet?.querySelector('.rune-reward-sheet__title')?.textContent?.trim() ?? '',
      action: sheet?.querySelector('.rune-reward-sheet__continue')?.textContent?.trim() ?? '',
    };
  });
  await page.click('.rune-reward-sheet__continue');
  await page.waitForSelector('#onAccount:not([hidden]) #accRuneGuide', { timeout: 10000 });
  await page.waitForFunction(() => document.activeElement?.id === 'accSeat');
  const guided = await page.evaluate(() => ({
    guideTitle: document.querySelector('.acc-rune-guide-title')?.textContent?.trim() ?? '',
    guideBody: document.querySelector('.acc-rune-guide-body')?.textContent?.trim() ?? '',
    seatFocused: document.activeElement?.id === 'accSeat',
    seatHighlighted: document.getElementById('accSeat')
      ?.classList.contains('acc-rune-guide-target') ?? false,
  }));
  const runeAcknowledgementsBeforeSeat = routes.acknowledgeCalls();
  const progressionAcknowledgementsBeforeSeat = progression.acknowledgements.length;
  await page.click('#accSeat');
  await page.waitForSelector('.faceoff #accSeatEquip', { timeout: 10000 });
  await bounded(routes.acknowledgeStarted,
    'the first rune was not acknowledged after the real equipment seat opened');
  return {
    modal,
    guided,
    runeAcknowledgementsBeforeSeat,
    runeAcknowledgementsAfterSeat: routes.acknowledgeCalls(),
    progressionAcknowledgementsBeforeSeat,
    equipmentSheet: await page.locator('.faceoff #accSeatEquip').count(),
    guidePresent: await page.locator('#accRuneGuide').count(),
  };
}

export async function runGroupTransitionRuneScenarios({ visit, out, check }) {
  const silverNoRune = await visit({
    named: true,
    runes: [],
    standingPoints: 1300,
    skipStandardProbes: true,
    probe: silverNoRuneProbe,
  });
  out.groupTransitionSilverNoRune = silverNoRune.probeResult;
  const empty = silverNoRune.probeResult;
  check(empty?.final?.title === COPY.online.groupTransition.runesUnlockedTitle
      && empty.final.paragraph === COPY.online.groupTransition.runesUnlockedBody
      && empty.final.primary.label === COPY.common.actions.continue
      && empty.final.swipe.visible
      && empty.final.swipe.label === COPY.online.groupTransition.swipeExplore
      && empty.shape.modeIcons === 1 && empty.shape.extraMedia === 0
      && !`${empty.shape.title} ${empty.shape.text}`.includes(COPY.game.runes.ward.name)
      && empty.acknowledgementsBeforeContinue === 0
      && empty.acknowledgements === 1
      && !empty.onlineOpen && empty.guideVisible === 0,
    'a SILVER promotion without a rune offered equipment instead of a plain Continue',
    empty);
  check(silverNoRune.errs.length === 0,
    'page errors during no-rune SILVER transition', silverNoRune.errs);

  const silverOwned = await visit({
    named: true,
    runes: ['ward'],
    equippedRune: null,
    standingPoints: 1300,
    skipStandardProbes: true,
    probe: silverOwnedRuneProbe,
  });
  out.groupTransitionSilverOwnedRune = silverOwned.probeResult;
  const owned = silverOwned.probeResult;
  check(owned?.final?.title === COPY.online.groupTransition.runesUnlockedTitle
      && owned.final.paragraph === COPY.online.groupTransition.runesUnlockedBody
      && owned.final.primary.label === COPY.online.groupTransition.openProfile
      && owned.final.swipe.visible
      && owned.final.swipe.label === COPY.online.groupTransition.swipeExplore
      && owned.shape.modeIcons === 1 && owned.shape.extraMedia === 0
      && !`${owned.shape.title} ${owned.shape.text}`.includes(COPY.game.runes.ward.name)
      && owned.acknowledgementsBeforeSeat === 0,
    'an owned-rune SILVER promotion named a specific rune or skipped its Profile handoff',
    owned);
  check(owned?.guided?.profileVisible && owned.guided.resultStillOpen
      && owned.guided.resultInert
      && owned.guided.guideTitle === COPY.online.profile.runeGuideSeatTitle
      && owned.guided.guideBody === COPY.online.profile.runeGuideSeatBody
      && owned.guided.seatVisible && owned.guided.seatSize.width >= 44
      && owned.guided.seatSize.height >= 44 && owned.guided.seatFocused
      && owned.guided.describedBy === 'accRuneGuideBody'
      && owned.guided.highlighted && owned.guided.animation !== 'none'
      && owned.guided.headerInert,
    'Profile did not focus and visibly teach the real 44px rune seat', owned?.guided);
  check(owned?.acknowledgements === 1 && !owned.completed.guidePresent
      && owned.completed.profileVisible && owned.completed.resultInert
      && owned.completed.equipmentSheet
      && owned.completed.duplicateRuneCards === 0
      && owned.returned.resultOpen && !owned.returned.resultInert && !owned.returned.onlineOpen,
    'the seat tap did not complete progression into the canonical equipment sheet',
    { completed: owned?.completed, returned: owned?.returned });
  check(silverOwned.errs.length === 0,
    'page errors during owned-rune SILVER tutorial', silverOwned.errs);

  const firstRune = await visit({
    named: true,
    runes: [],
    standingPoints: 1340,
    skipStandardProbes: true,
    probe: firstRuneRewardProbe,
  });
  out.firstRuneEquipmentTutorial = firstRune.probeResult;
  const first = firstRune.probeResult;
  check(first?.modal?.resultOpen && first.modal.inlineRewardHidden
      && first.modal.kicker === COPY.online.result.newRune
      && first.modal.title === COPY.game.runes.ward.name
      && first.modal.action === COPY.online.profile.equipRune,
    'the first rune did not arrive as a modal with an Equip rune action', first?.modal);
  check(first?.guided?.guideTitle === COPY.online.profile.runeGuideSeatTitle
      && first.guided.guideBody === COPY.online.profile.runeGuideSeatBody
      && first.guided.seatFocused && first.guided.seatHighlighted
      && first.runeAcknowledgementsBeforeSeat === 0
      && first.runeAcknowledgementsAfterSeat === 1
      && first.progressionAcknowledgementsBeforeSeat === 1
      && first.equipmentSheet === 1 && first.guidePresent === 0,
    'the first-rune modal did not hand off to the real equipped-rune seat', first);
  check(firstRune.errs.length === 0,
    'page errors during first-rune equipment tutorial', firstRune.errs);
}
