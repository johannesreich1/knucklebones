import { holdAndCancel } from '../../support/press-feedback.mjs';
import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { LOCALE_REGISTRY } from '../../../../src/i18n/locale.ts';

const near = (actual, expected) => Math.abs(actual - expected) <= .01;

const readGlint = (page, selector, sample = false) => page.evaluate(([target, shouldSample]) => {
  const button = document.querySelector(target);
  if (!(button instanceof HTMLButtonElement)) return null;
  const animations = button.getAnimations({ subtree: true });
  const glint = animations.find((animation) => animation.animationName === 'primaryGlint');
  const effect = glint?.effect;
  const timing = effect?.getTiming();
  const pseudoStyle = () => getComputedStyle(button, '::after');
  const readFrame = (progress) => {
    if (!glint || typeof timing?.duration !== 'number') return null;
    glint.pause();
    glint.currentTime = timing.duration * progress;
    const style = pseudoStyle();
    return { opacity: Number(style.opacity), position: parseFloat(style.backgroundPositionX) };
  };
  const frames = shouldSample ? {
    resultTheatre: readFrame(typeof timing?.duration === 'number' ? 1900 / timing.duration : 0),
    rest: readFrame(.70),
    crossing: readFrame(.80),
    exit: readFrame(.88),
  } : null;
  if (glint && shouldSample) glint.play();
  const style = getComputedStyle(button);
  const pseudo = pseudoStyle();
  const rect = button.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return {
    content: pseudo.content,
    animationName: pseudo.animationName,
    duration: typeof timing?.duration === 'number' ? timing.duration : null,
    pseudoElement: effect?.pseudoElement ?? null,
    playState: glint?.playState ?? null,
    overflow: style.overflow,
    borderRadius: style.borderRadius,
    pseudoBorderRadius: pseudo.borderRadius,
    backgroundImage: pseudo.backgroundImage,
    backgroundSize: pseudo.backgroundSize,
    pointerEvents: pseudo.pointerEvents,
    hit: hit === button || button.contains(hit),
    width: rect.width,
    frames,
  };
}, [selector, sample]);

const readPlayAction = (page, selector) => page.evaluate((target) => {
  const button = document.querySelector(target);
  if (!(button instanceof HTMLButtonElement)) return null;
  const icon = button.querySelector(':scope > .btn-leading-icon');
  const label = button.querySelector(':scope > .btn-label');
  const buttonRect = button.getBoundingClientRect();
  const iconRect = icon?.getBoundingClientRect();
  const labelRect = label?.getBoundingClientRect();
  const groupLeft = Math.min(iconRect?.left ?? Infinity, labelRect?.left ?? Infinity);
  const groupRight = Math.max(iconRect?.right ?? -Infinity, labelRect?.right ?? -Infinity);
  const svg = icon?.querySelector('svg');
  const die = svg?.querySelector('rect');
  return {
    label: (label?.textContent ?? button.textContent ?? '').trim(),
    buttonText: (button.textContent ?? '').trim(),
    iconPresent: !!icon && !icon.hidden && !!svg,
    iconBeforeLabel: !!icon && !!label
      && [...button.children].indexOf(icon) < [...button.children].indexOf(label),
    ariaHidden: icon?.getAttribute('aria-hidden') ?? null,
    iconId: icon?.getAttribute('data-icon') ?? null,
    pipCount: icon?.querySelectorAll('circle').length ?? 0,
    pips: [...(icon?.querySelectorAll('circle') ?? [])]
      .map((pip) => [pip.getAttribute('cx'), pip.getAttribute('cy'), pip.getAttribute('r')]),
    cant: icon?.querySelector('g')?.getAttribute('transform') ?? null,
    viewBox: svg?.getAttribute('viewBox') ?? null,
    die: die ? [die.getAttribute('x'), die.getAttribute('y'), die.getAttribute('width'),
      die.getAttribute('height'), die.getAttribute('rx')] : null,
    iconSize: iconRect ? [iconRect.width, iconRect.height] : null,
    iconCentreError: iconRect
      ? +((iconRect.top + iconRect.height / 2)
        - (buttonRect.top + buttonRect.height / 2)).toFixed(2)
      : null,
    gap: iconRect && labelRect ? +(labelRect.left - iconRect.right).toFixed(2) : null,
    groupCentreError: Number.isFinite(groupLeft) && Number.isFinite(groupRight)
      ? +((groupLeft + groupRight) / 2 - (buttonRect.left + buttonRect.width / 2)).toFixed(2)
      : null,
    fits: button.scrollWidth <= button.clientWidth,
  };
}, selector);

export async function runPrimaryCtaGlintScenarios(suite) {
  const { browser, devices, F, out, check, markExperienced } = suite;
  const context = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true,
    isMobile: true, locale: 'en-US' });
  await markExperienced(context);
  const page = await context.newPage();
  await page.goto(F);
  await page.waitForTimeout(400);

  const home = await readGlint(page, '#btnOnline', true);
  const homeAction = await readPlayAction(page, '#btnOnline');
  const hiddenPractice = await readGlint(page, '#btnPlay');
  const press = await holdAndCancel(page, '#btnOnline');
  const disabled = await page.evaluate(() => {
    const button = document.getElementById('btnOnline');
    button.disabled = true;
    const pseudo = getComputedStyle(button, '::after');
    const result = {
      content: pseudo.content,
      animationName: pseudo.animationName,
      animations: button.getAnimations({ subtree: true }).map((animation) => animation.animationName),
    };
    button.disabled = false;
    return result;
  });

  /* Static translation repaint used to own the whole button textContent. The
     selected die is a stable sibling of the copy, so changing language must
     repaint the label without erasing, moving, or absorbing the icon. */
  await page.click('#btnSettingsHome');
  await page.waitForTimeout(320);
  await page.click('#languageNext');
  await page.waitForTimeout(120);
  await page.click('#btnSettingsBack');
  await page.waitForTimeout(320);
  const localizedHomeAction = await readPlayAction(page, '#btnOnline');

  await page.evaluate(() => window.__kb.openPractice());
  const coveredHome = await readGlint(page, '#btnOnline');
  const practice = await readGlint(page, '#btnPlay');
  const practiceAction = await readPlayAction(page, '#btnPlay');
  await page.click('#modeSeg button[data-m="duo"]');
  await page.waitForTimeout(120);
  const duoPracticeAction = await readPlayAction(page, '#btnPlay');

  await page.evaluate(() => window.__kb.showEnd({
    outcome: 'win',
    title: 'VICTORY',
    sub: 'You out-rolled the machine',
    you: { score: 41, label: 'You' },
    them: { score: 33, label: 'AI' },
    again: { label: 'Next duel', icon: 'play', run() {} },
    quiet: { label: 'Change setup', run() {} },
    delay: 0,
  }));
  await page.waitForTimeout(40);
  const coveredPractice = await readGlint(page, '#btnPlay');
  const result = await readGlint(page, '#btnAgain');
  const resultAction = await readPlayAction(page, '#btnAgain');
  const quietAction = await readPlayAction(page, '#btnEndQuiet');

  /* #btnAgain is also tutorial Finish. A fixed icon on the element would lie
     in that state, and the tuned play cadence belongs with the selected icon. */
  await page.evaluate(() => window.__kb.showEnd({
    outcome: 'win',
    title: 'VICTORY',
    sub: 'Tutorial complete',
    you: { score: 41, label: 'You' },
    them: { score: 33, label: 'AI' },
    again: { label: 'Finish', run() {} },
    delay: 0,
  }));
  await page.waitForTimeout(40);
  const finish = await readGlint(page, '#btnAgain');
  const finishAction = await readPlayAction(page, '#btnAgain');

  out.primaryCtaGlint = {
    home, homeAction, localizedHomeAction, hiddenPractice, press, disabled,
    coveredHome, practice, practiceAction, duoPracticeAction, coveredPractice, result, resultAction,
    quietAction, finish, finishAction,
  };
  check(home?.animationName === 'primaryGlint' && home.duration === 4600
    && home.pseudoElement === '::after' && home.playState === 'running'
    && home.overflow === 'visible' && home.borderRadius === home.pseudoBorderRadius
    && home.backgroundImage.includes('0.21')
    && home.backgroundSize === '260% 100%' && home.pointerEvents === 'none' && home.hit,
  'Home primary CTA does not run one rounded, non-blocking glass glint', home);
  check(home?.frames?.resultTheatre?.opacity === 0 && home.frames.rest?.opacity === 0
    && home.frames.crossing?.opacity > .95 && home.frames.exit?.opacity > .95
    && home.frames.crossing.position - home.frames.exit.position > 50,
  'primary CTA glint lost its long rest or full-width crossing', home?.frames);
  check(near(press.held, .96) && near(press.resting, 1) && near(press.released, 1),
    'glass glint changed the primary CTA press response', press);
  check(disabled.content === 'none' && disabled.animationName === 'none'
    && !disabled.animations.includes('primaryGlint'),
  'a disabled primary CTA still advertises itself with a glint', disabled);
  check(hiddenPractice?.animationName === 'none' && coveredHome?.animationName === 'none'
    && practice?.animationName === 'primaryGlint' && practice.duration === 5200
    && practice.backgroundImage.includes('0.15')
    && coveredPractice?.animationName === 'none'
    && result?.animationName === 'primaryGlint' && result.duration === 4600
    && result.backgroundImage.includes('0.21')
    && finish?.animationName === 'primaryGlint' && finish.duration === 5200
    && finish.backgroundImage.includes('0.15'),
  'the glint did not follow the visible topmost two-colour primary action', {
    hiddenPractice, coveredHome, practice, coveredPractice, result, finish,
  });
  const selectedIcon = (action, label) => action?.label === label && action.buttonText === label
    && action.iconPresent
    && action.iconBeforeLabel && action.ariaHidden === 'true' && action.iconId === 'play'
    && action.pipCount === 3 && action.cant === 'rotate(-8 12 12)'
    && action.viewBox === '0 0 24 24'
    && JSON.stringify(action.die) === JSON.stringify(['4.5', '4.5', '15', '15', '3.4'])
    && JSON.stringify(action.pips) === JSON.stringify([
      ['8.5', '8.5', '1.25'], ['12', '12', '1.25'], ['15.5', '15.5', '1.25'],
    ])
    && action.iconSize?.every((size) => size === 25)
    && action.gap === 11 && Math.abs(action.groupCentreError) <= .5
    && Math.abs(action.iconCentreError) <= .5 && action.fits;
  check(selectedIcon(homeAction, 'Play ranked match'),
    'the main-menu play label does not keep the selected canted die in front', homeAction);
  check(selectedIcon(localizedHomeAction, RESOURCES.pt.game.home.playRanked),
  'locale repaint erased or moved the main-menu play icon', { homeAction, localizedHomeAction });
  check(practiceAction?.label === RESOURCES.pt.game.practice.playVersusAi
    && practiceAction.buttonText === RESOURCES.pt.game.practice.playVersusAi
    && !practiceAction.iconPresent
    && duoPracticeAction?.label === RESOURCES.pt.game.practice.playDuel
    && duoPracticeAction.buttonText === RESOURCES.pt.game.practice.playDuel
    && !duoPracticeAction.iconPresent,
  'the unselected offline action changed label or received the main-menu icon', {
    practiceAction, duoPracticeAction,
  });
  check(selectedIcon(resultAction, 'Next duel'),
    'the result Next duel label does not keep the selected canted die in front', resultAction);
  check(quietAction?.label === 'Change setup' && !quietAction.iconPresent,
    'the result secondary action received a play icon', quietAction);
  check(finishAction?.label === 'Finish' && !finishAction.iconPresent,
    'tutorial Finish received the Next duel icon', finishAction);
  await context.close();

  /* The icon consumes 36px with its gap. Prove every shipped Home label still
     fits and stays optically centred on the narrowest supported phone. */
  const compactContext = await browser.newContext({ viewport: { width: 320, height: 568 },
    hasTouch: true, isMobile: true, deviceScaleFactor: 2, locale: 'en-US' });
  await markExperienced(compactContext);
  const compactPage = await compactContext.newPage();
  await compactPage.goto(F);
  await compactPage.waitForTimeout(400);
  const compactLocales = [];
  for (let index = 0; index < LOCALE_REGISTRY.length; index++) {
    const locale = LOCALE_REGISTRY[index];
    compactLocales.push({ locale: locale.id, action: await readPlayAction(compactPage, '#btnOnline') });
    if (index === LOCALE_REGISTRY.length - 1) break;
    await compactPage.click('#btnSettingsHome');
    await compactPage.waitForTimeout(300);
    await compactPage.click('#languageNext');
    const next = LOCALE_REGISTRY[index + 1];
    await compactPage.waitForFunction((id) => document.documentElement.dataset.locale === id, next.id);
    await compactPage.click('#btnSettingsBack');
    await compactPage.waitForTimeout(300);
  }
  out.primaryCtaCompactLocales = compactLocales;
  check(compactLocales.every(({ locale, action }) =>
    selectedIcon(action, RESOURCES[locale].game.home.playRanked)),
  'a 320px localized main-menu play label clips or loses the selected die', compactLocales);
  await compactContext.close();

  const reducedContext = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true,
    isMobile: true, reducedMotion: 'reduce', locale: 'en-US' });
  await markExperienced(reducedContext);
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(F);
  await reducedPage.waitForTimeout(400);
  const reduced = await readGlint(reducedPage, '#btnOnline');
  const reducedAction = await readPlayAction(reducedPage, '#btnOnline');
  out.primaryCtaGlintReduced = { glint: reduced, action: reducedAction };
  check(reduced?.content === 'none' && reduced.animationName === 'none'
    && reduced.playState === null,
  'reduced motion still creates or runs the primary CTA sheen', reduced);
  check(selectedIcon(reducedAction, 'Play ranked match'),
    'reduced motion removed or moved the static play icon', reducedAction);
  await reducedContext.close();
}
