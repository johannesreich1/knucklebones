import { holdAndCancel } from '../../support/press-feedback.mjs';

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
    resultTheatre: readFrame(1900 / 5200),
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
    backgroundSize: pseudo.backgroundSize,
    pointerEvents: pseudo.pointerEvents,
    hit: hit === button || button.contains(hit),
    width: rect.width,
    frames,
  };
}, [selector, sample]);

export async function runPrimaryCtaGlintScenarios(suite) {
  const { browser, devices, F, out, check, markExperienced } = suite;
  const context = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true,
    isMobile: true, locale: 'en-US' });
  await markExperienced(context);
  const page = await context.newPage();
  await page.goto(F);
  await page.waitForTimeout(400);

  const home = await readGlint(page, '#btnOnline', true);
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

  await page.evaluate(() => window.__kb.openPractice());
  const coveredHome = await readGlint(page, '#btnOnline');
  const practice = await readGlint(page, '#btnPlay');

  await page.evaluate(() => window.__kb.showEnd({
    outcome: 'win',
    title: 'VICTORY',
    sub: 'You out-rolled the machine',
    you: { score: 41, label: 'You' },
    them: { score: 33, label: 'AI' },
    again: { label: 'Next duel', run() {} },
    quiet: { label: 'Change setup', run() {} },
  }));
  const coveredPractice = await readGlint(page, '#btnPlay');
  const result = await readGlint(page, '#btnAgain');

  out.primaryCtaGlint = {
    home, hiddenPractice, press, disabled, coveredHome, practice, coveredPractice, result,
  };
  check(home?.animationName === 'primaryGlint' && home.duration === 5200
    && home.pseudoElement === '::after' && home.playState === 'running'
    && home.overflow === 'visible' && home.borderRadius === home.pseudoBorderRadius
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
    && practice?.animationName === 'primaryGlint'
    && coveredPractice?.animationName === 'none' && result?.animationName === 'primaryGlint',
  'the glint did not follow the visible topmost two-colour primary action', {
    hiddenPractice, coveredHome, practice, coveredPractice, result,
  });
  await context.close();

  const reducedContext = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true,
    isMobile: true, reducedMotion: 'reduce', locale: 'en-US' });
  await markExperienced(reducedContext);
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(F);
  await reducedPage.waitForTimeout(400);
  const reduced = await readGlint(reducedPage, '#btnOnline');
  out.primaryCtaGlintReduced = reduced;
  check(reduced?.content === 'none' && reduced.animationName === 'none'
    && reduced.playState === null,
  'reduced motion still creates or runs the primary CTA sheen', reduced);
  await reducedContext.close();
}
