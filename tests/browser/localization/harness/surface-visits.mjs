/* WHERE each localized surface lives, and how to reach it through the real UI.
 *
 * The third of this suite's three measuring concerns: layout-inspection.mjs is
 * HOW a surface is measured, surface-readiness.mjs is WHEN one is ready to be
 * measured, and this is WHERE it is — the clicks, the seeded state and the
 * cleanup that put Home, the Learn tree, Settings, the practice pickers, the
 * tutorial prompt, the pass-phone card, the result screen and the RANDOM x2
 * reveal on screen. Every export hands back an inspected snapshot, so callers
 * assert on surfaces without learning the route to any of them.
 *
 * These helpers run as one walk and hand the page to each other in a known
 * state; each precondition below was invisible while they shared a file with
 * their only caller, so it is written down rather than left to be rediscovered.
 */
import {
  checkReachableTargets,
  frame,
  inspectSurface as inspect,
} from './layout-inspection.mjs';
import { waitForSurface } from './surface-readiness.mjs';
import {
  prepareCollectedRandomTwoReveal,
  restoreCollectedRunes,
} from '../../support/random-two-reveal.mjs';

/** Leaves Settings open, scrolled to the language picker. */
export async function openSettings(page) {
  await page.evaluate(() => window.__kb.goHome());
  await waitForSurface(page, '#ovStart', '#btnSettingsHome');
  await page.click('#btnSettingsHome');
  await waitForSurface(page, '#ovSettings', '#languagePicker');
  await page.locator('#languagePicker').scrollIntoViewIfNeeded();
  await frame(page);
}

/** Walks Home -> Learn hub -> Rules/Modes/Spells and back to Home. The hub
    reachability check runs inside the walk because it can only be made while
    the learn hub is the surface on screen. */
export async function inspectLearningSurfaces(page, check, label) {
  await page.evaluate(() => window.__kb.goHome());
  await waitForSurface(page, '#ovStart', '#btnLearn');
  const home = await inspect(page, '#ovStart', [
    '.eyebrow', '.sub2', '#homeChip', '#btnOnline', '#btnBoardHome',
    '#btnSettingsHome', '.quiet .cap', '#btnVsCpu', '#btnDuoHome', '#btnLearn',
  ]);
  await page.click('#btnLearn');
  await waitForSurface(page, '#ovLearn', '#btnLearnRules');
  const hub = await inspect(page, '#ovLearn .pbody', [
    '.learnrow', '.lname', '.lblurb',
  ]);
  await checkReachableTargets(page, check, `learn-hub-${label}`,
    ['#btnLearnTut', '#btnLearnRules', '#btnLearnModes', '#btnLearnSpells']);

  await page.click('#btnLearnRules');
  await waitForSurface(page, '#ovRules', '.rules h3');
  const rules = await inspect(page, '#ovRules .pbody', [
    '.rules h3', '.rules p',
  ]);
  await page.click('[data-learn-back="ovRules"]');
  await frame(page);

  await page.click('#btnLearnModes');
  await waitForSurface(page, '#ovModes', '.modecard');
  const modes = await inspect(page, '#ovModes .pbody', [
    '.modecard',
    '.mcname', '.mcblurb', '.mcdetail',
  ]);
  await page.click('[data-learn-back="ovModes"]');
  await frame(page);

  await page.click('#btnLearnSpells');
  await waitForSurface(page, '#ovSpells', '.modecard');
  const runes = await inspect(page, '#ovSpells .pbody', [
    '.modecard',
    '.mcname', '.mcblurb', '.mcdetail',
  ]);
  await page.click('[data-learn-back="ovSpells"]');
  await frame(page);
  await page.click('#btnLearnBack');
  await waitForSurface(page, '#ovStart', '#btnLearn');
  return { home, hub, rules, modes, runes };
}

/** PRECONDITION: Settings is open (openSettings, plus any settings toggling
    the caller does); this leaves it through #btnSettingsBack before opening
    the practice pickers. */
export async function inspectSetup(page) {
  await page.click('#btnSettingsBack');
  await page.evaluate(() => { window.__kb.openPractice(); });
  await page.click('#modeSeg button[data-m="duo"]');
  await page.locator('#modePick').scrollIntoViewIfNeeded();
  await page.locator('#modePick').evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'center' }));
  await frame(page);
  const mode = await inspect(page, '#modePick', ['button']);
  const modeInfo = [];
  for (let index = 0; index < await page.locator('#modePick button').count(); index++) {
    await page.locator('#modePick button').nth(index).click();
    await frame(page);
    modeInfo.push(await inspect(page, '#modePickInfo', [':scope']));
  }
  await page.locator('#spellPick').scrollIntoViewIfNeeded();
  await page.locator('#spellPick').evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'center' }));
  await frame(page);
  const rune = await inspect(page, '#spellPick', ['button']);
  const runeInfo = [];
  for (let index = 0; index < await page.locator('#spellPick button').count(); index++) {
    await page.locator('#spellPick button').nth(index).click();
    await frame(page);
    runeInfo.push(await inspect(page, '#spellPickInfo', [':scope']));
  }
  return { mode, modeInfo, rune, runeInfo };
}

export async function showTutorial(page) {
  await page.evaluate(() => {
    window.__kb.newGame({ tutorial: true });
    window.__kb.S.gen++; // hold the localized welcome prompt and cancel its roll
  });
  await page.waitForFunction(() => !document.getElementById('coach')?.hidden);
  await frame(page);
  return inspect(page, '#coach', ['#coachMsg', '#coachHint']);
}

/** Shows the pass-phone card and takes it back down again. */
export async function showPassPhone(page) {
  await page.evaluate(() => {
    const game = window.__kb;
    game.S.mode = 'duo';
    game.S.seat = 'pass';
    game.S.bottom = 1;
    game.applySides();
    const coach = document.getElementById('coach');
    if (coach) coach.hidden = true;
    const who = document.getElementById('passWho');
    if (who) who.textContent = game.nameOf(0);
    document.getElementById('ovPass')?.classList.add('on');
  });
  await waitForSurface(page, '#ovPass', '#passWho');
  const surface = await inspect(page, '#ovPass', [
    '#passWho', '.hint', '.mini', '.tapline',
  ]);
  await page.evaluate(() => document.getElementById('ovPass')?.classList.remove('on'));
  await frame(page);
  return surface;
}

/** Plays the last die of a settled duel. Deliberately leaves #ovEnd on: the
    caller measures the result screen, then dismisses it. */
export async function showResult(page) {
  await page.evaluate(async () => {
    const game = window.__kb;
    const state = game.S;
    state.mode = 'duo';
    state.seat = 'face';
    state.starter = 1;
    state.timer = 0;
    game.newGame();
    state.gen++; // cancel the delayed opening roll; this test places the last die
    state.turn = 1;
    state.bottom = 1;
    state.phase = 'choose';
    state.busy = false;
    state.die = 6;
    state.boards[0] = [[1], [2], [3]];
    state.boards[1] = [[6, 6, 6], [5, 5, 5], [4, 4]];
    game.applySides();
    game.renderAll(false);
    game.setStageDie(6);
    await game.place(1, 2);
  });
  await page.waitForSelector('#ovEnd.on', { timeout: 8000 });
  await frame(page);
  return inspect(page, '#ovEnd', [
    '#endTitle', '#endSub', '#endYouLbl', '#endCpuLbl', '#endMeta',
    '#btnAgain:not([hidden])', '#btnEndQuiet:not([hidden])', '#btnShare:not([hidden])',
  ]);
}

/** Borrows two collected runes and pins Math.random for the RANDOM x2 draw,
    then restores both. Preparation and restoration stay in one function; split
    apart they would leak a stubbed page into whatever ran next. */
export async function inspectReveal(page) {
  /* CPU practice exposes only collected runes. Lend exactly two: enough for
     RANDOM x2, while Rune Trial correctly remains unavailable. */
  const previousRuneCache = await prepareCollectedRandomTwoReveal(page);
  /* Playwright sends the bound pointerdown/up pair here, so the action does
     not depend on tap()'s guarded click-only fallback. */
  await page.click('#btnPlay');
  await page.evaluate(() => {
    Math.random = window.__kbTestOriginalRandom;
    delete window.__kbTestOriginalRandom;
  });
  /* Reduced motion lands the dial synchronously, so `hunting` can correctly
     disappear before Playwright's first observation; the landed dial remains. */
  await page.waitForSelector('#ovWheel.on .dial', { timeout: 8000 });
  await page.waitForTimeout(80);
  await frame(page);
  const wheel = await inspect(page, '#ovWheel', ['#wheelTitle', '#wheelStage', '.dial']);
  await page.waitForSelector('#ovWheel.dealing .rdealt.up', { timeout: 15000 });
  /* Reduced motion deliberately retains the 60ms stage handoff transition.
     Measure the readable resting frame, not its scaled first paint. */
  await page.waitForTimeout(80);
  await frame(page);
  const deal = await inspect(page, '#ovWheel', [
    '#wheelTitle', '#wheelTitle .wtitlecopy', '#wheelOwner',
    '.rfelt', '.rdealt', '.rface .rlbl', '#wheelName', '#wheelBlurb',
  ]);
  await page.waitForSelector('#ovWheel.holding', { timeout: 15000 });
  await page.waitForTimeout(80);
  await frame(page);
  const held = await inspect(page, '#ovWheel', [
    '#wheelTitle', '#wheelTitle .wtitlecopy', '#wheelOwner',
    '#wheelSettled .wowner', '#wheelSettled .wpill', '#wheelSettled .wblurb',
    '#wheelName', '#wheelBlurb',
    '#wheelHold b', '#wheelHold span',
  ]);
  await page.locator('#ovWheel').dispatchEvent('pointerdown');
  await page.waitForFunction(() => !document.getElementById('ovWheel')?.classList.contains('on'));
  await page.evaluate(() => { window.__kb.S.gen++; });
  await restoreCollectedRunes(page, previousRuneCache);
  return { wheel, deal, held };
}
