import { holdAndCancel, pressingClass } from '../../support/press-feedback.mjs';

const near = (actual, expected) => Math.abs(actual - expected) <= .01;
const restored = (sample) => near(sample.resting, 1) && near(sample.released, 1);

export async function runMenuPressFeedbackScenarios(suite) {
  const { browser, devices, F, out, check, markExperienced } = suite;
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
  await markExperienced(ctx);
  const page = await ctx.newPage();
  await page.goto(F);
  await page.waitForTimeout(400);

  const home = await holdAndCancel(page, '#btnVsCpu');
  check(near(home.held, .96) && restored(home),
    'Home button lost its existing press strength or resting transform', home);

  await page.evaluate(() => window.__kb.openPractice());
  const segment = await holdAndCancel(page, '#modeSeg button[data-m="duo"]');
  const mode = await holdAndCancel(page, '#modePick button');
  const spell = await holdAndCancel(page, '#spellPick button');
  const selectedMode = await page.locator('#modeSeg button.on').getAttribute('data-m');
  check(near(segment.held, .97) && restored(segment) && selectedMode === 'cpu',
    'cancelled Offline segment press changed selection or lacked feedback', { segment, selectedMode });
  check(near(mode.held, .92) && restored(mode),
    'game-mode picker lost its stronger press feedback', mode);
  check(near(spell.held, .92) && restored(spell),
    'spell picker lost its stronger press feedback', spell);

  await page.click('#btnPracticeBack');
  await page.click('#btnSettingsHome');
  const settingsBack = await holdAndCancel(page, '#btnSettingsBack');
  const hue = await holdAndCancel(page, '#p1Pick button:enabled');
  const disabled = await holdAndCancel(page, '#p1Pick button:disabled');
  check(near(settingsBack.held, .9) && restored(settingsBack),
    'Settings icon lost its stronger press feedback', settingsBack);
  check(near(hue.held, .9) && restored(hue),
    'enabled hue control lost its stronger press feedback', hue);
  check(near(disabled.held, 1) && restored(disabled),
    'disabled overlay button animated', disabled);

  const classPress = await pressingClass(page, '#sndSeg button:enabled');
  check(near(classPress.held, .97) && restored(classPress),
    'the shared .pressing state does not match native overlay feedback', classPress);

  out.menuPressFeedback = { home, segment, mode, spell, settingsBack, hue, disabled, classPress };
  await ctx.close();
}
