// Draft keeps public routes and Home navigation closed while Settings/auth show
// the owner-approved placeholder doors. This matrix supplies one synthetic
// opener to drive all four real in-app documents; a complete test-only fixture
// supplies the 44 static pages. Both paths run at every locale/page/mobile viewport.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pkg from 'playwright';
import { LOCALE_REGISTRY } from '../../src/i18n/locale.ts';
import { LEGAL_RELEASE } from '../../src/legal/config.ts';
import { legalDocument } from '../../src/legal/documents.ts';
import { generateLegalPageFiles } from '../../src/legal/static-pages.ts';
import { LEGAL_PAGE_IDS } from '../../src/legal/types.ts';
import { serveTree } from '../serve.mjs';
import { completeLegalFixture } from '../support/legal-fixture.ts';
import {
  expectedLegalBody,
  inspectStaticLegalMatrix,
} from './support/legal-static-page-probe.mjs';
const { chromium } = pkg;

const FILE = 'file://' + process.cwd() + '/knucklebones-neon.html';
const VIEWPORTS = [
  [320, 568, '320x568'],
  [390, 844, '390x844'],
  [568, 320, '568x320'],
  [667, 375, '667x375'],
];
const problems = [];
const errs = [];
const out = {};
const ONLY_SHEET_STACK = process.argv.includes('--only-sheet-stack');
const check = (condition, message, detail) => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const WIPE_IDS = ['kb-page-neon-beam', 'kb-page-neon-source', 'kb-page-neon-target'];
const BACK_IDS = ['kb-duel-bracket-p1', 'kb-duel-bracket-p2', ...WIPE_IDS].sort();

async function waitForMotionIdle(page) {
  await page.waitForFunction(() => {
    const managed = document.getAnimations({ subtree: true })
      .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id));
    return managed.length === 0
      && !document.getElementById('kbroot')?.classList.contains('page-motion-active')
      && !document.querySelector(
        '.page-wipe-beam,.page-motion-source,.page-motion-target,.page-motion-stage,.page-motion-cleanup',
      );
  }, null, { timeout: 1500 });
}

async function sampleMotion(page, expectedIds) {
  await page.waitForFunction((expected) => {
    const ids = document.getAnimations({ subtree: true })
      .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id))
      .map((animation) => animation.id).sort();
    return JSON.stringify(ids) === JSON.stringify(expected);
  }, [...expectedIds].sort(), { timeout: 700 });
  const reading = await page.evaluate(async () => {
    const managed = document.getAnimations({ subtree: true })
      .filter((animation) => /^(kb-page-|kb-duel-bracket-)/.test(animation.id));
    managed.forEach((animation) => {
      animation.pause();
      animation.currentTime = Number(animation.effect?.getComputedTiming().duration ?? 0) * .2;
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const source = document.querySelector('.page-motion-source');
    const target = document.querySelector('.page-motion-target');
    const beam = document.querySelector('.page-wipe-beam');
    const sheet = document.querySelector('.faceoff');
    const style = (element) => element ? getComputedStyle(element) : null;
    const signature = managed.map((animation) => ({
      id: animation.id,
      duration: Number(animation.effect?.getTiming().duration ?? 0),
      easing: animation.effect?.getTiming().easing ?? '',
      keyframes: (animation.effect?.getKeyframes() ?? []).map((frame) =>
        Object.fromEntries(['computedOffset', 'left', 'opacity', 'clipPath', 'transform']
          .filter((key) => frame[key] !== undefined)
          .map((key) => [key, frame[key]]))),
    })).sort((left, right) => left.id.localeCompare(right.id));
    const beamBox = beam?.getBoundingClientRect();
    const reading = {
      ids: signature.map(({ id }) => id),
      signature,
      direction: document.getElementById('kbroot')?.dataset.pageMotionDirection ?? '',
      sourceId: source?.id ?? '',
      targetId: target?.id ?? '',
      sourceClip: style(source)?.clipPath ?? '',
      targetClip: style(target)?.clipPath ?? '',
      sourceTransform: style(source)?.transform ?? '',
      targetTransform: style(target)?.transform ?? '',
      sourceZ: Number.parseInt(style(source)?.zIndex ?? '', 10),
      targetZ: Number.parseInt(style(target)?.zIndex ?? '', 10),
      sheetZ: Number.parseInt(style(sheet)?.zIndex ?? '', 10),
      sheetConnected: !!sheet?.isConnected,
      beam: beamBox ? {
        opacity: Number(style(beam)?.opacity ?? 0),
        width: beamBox.width,
        height: beamBox.height,
      } : null,
    };
    managed.forEach((animation) => animation.play());
    return reading;
  });
  await waitForMotionIdle(page);
  return reading;
}

async function edgeSwipe(page) {
  await page.evaluate(() => {
    const touch = (x) => new Touch({
      identifier: 19, target: document.body, clientX: x, clientY: 304,
    });
    const fire = (type, point) => document.body.dispatchEvent(new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [point],
      changedTouches: [point],
      bubbles: true,
    }));
    fire('touchstart', touch(12));
    for (const x of [30, 55, 90]) fire('touchmove', touch(x));
    fire('touchend', touch(90));
  });
}

async function inspectLegalAboveSheet(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'en-US', hasTouch: true, isMobile: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errs.push(`legal-over-sheet: ${error.message}`));
  try {
    await page.goto(FILE);
    await page.waitForTimeout(320);
    await page.evaluate(() => window.__kb.newGame());
    await page.waitForSelector('#rec .rchip[data-lib]', { state: 'visible', timeout: 3000 });
    /* Keep a real page beneath the genuine in-game badge sheet so Legal has
       both an authored page source and a nested modal to outrank. */
    await page.evaluate(() => window.__kb.goHome());
    await page.waitForFunction(() => document.getElementById('ovStart')?.classList.contains('on'));
    await page.waitForTimeout(30);
    await page.evaluate(() => document.querySelector('#rec .rchip[data-lib]').click());
    await page.waitForSelector('.faceoff .focard', { state: 'visible', timeout: 3000 });
    await page.waitForFunction(() => {
      const card = document.querySelector('.faceoff .focard');
      const transform = card && getComputedStyle(card).transform;
      return !!card && (!transform || transform === 'none'
        || Math.abs(new DOMMatrixReadOnly(transform).m42) <= 1);
    }, null, { timeout: 3000 });
    await page.evaluate(() => {
      const opener = document.createElement('button');
      opener.id = 'legalSheetOpener';
      opener.type = 'button';
      opener.className = 'linkbtn';
      opener.dataset.legalOpen = 'privacy';
      opener.textContent = 'Privacy';
      document.querySelector('.faceoff .fograb').after(opener);
      opener.focus();
    });

    const openLegal = async () => {
      await page.click('#legalSheetOpener');
      const motion = await sampleMotion(page, WIPE_IDS);
      const state = await page.evaluate(() => ({
        open: document.getElementById('ovPrivacy')?.classList.contains('on') ?? false,
        legalInert: document.getElementById('ovPrivacy')?.inert ?? null,
        sheetInert: document.querySelector('.faceoff')?.inert ?? null,
        headingFocused: document.activeElement === document.querySelector('#ovPrivacy h1'),
      }));
      return { motion, state };
    };
    const landed = () => page.evaluate(() => {
      const sheet = document.querySelector('.faceoff');
      const card = sheet?.querySelector('.focard');
      const box = card?.getBoundingClientRect();
      const hit = box && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const zLeaks = [...document.querySelectorAll('*')].filter((element) =>
        element.style?.getPropertyValue('--page-motion-z')
          || element.style?.getPropertyValue('--page-motion-base-z')).length;
      return {
        sheetConnected: !!sheet?.isConnected,
        sheetPainted: !!sheet && !!hit && sheet.contains(hit),
        sheetInert: sheet?.inert ?? null,
        legalOpen: document.getElementById('ovPrivacy')?.classList.contains('on') ?? false,
        legalInert: document.getElementById('ovPrivacy')?.inert ?? null,
        homeInert: document.getElementById('ovStart')?.inert ?? null,
        openerFocused: document.activeElement?.id === 'legalSheetOpener',
        transients: document.querySelectorAll(
          '.page-wipe-beam,.page-motion-source,.page-motion-target,.page-motion-stage,.page-motion-cleanup',
        ).length,
        zLeaks,
      };
    });

    const forward = await openLegal();
    await page.click('#btnPrivacyBack');
    const buttonBack = await sampleMotion(page, BACK_IDS);
    const buttonLanding = await landed();
    const reopen = await openLegal();
    await edgeSwipe(page);
    const swipeBack = await sampleMotion(page, BACK_IDS);
    const swipeLanding = await landed();
    return { forward, buttonBack, buttonLanding, reopen, swipeBack, swipeLanding };
  } finally {
    await context.close();
  }
}

const LONG_URL = 'https://privacy.example.test/account-deletion/'
  + 'ownership-verification-with-a-deliberately-unbroken-mobile-path-'
  + 'abcdefghijklmnopqrstuvwxyz-0123456789-abcdefghijklmnopqrstuvwxyz';
const readyFixture = completeLegalFixture();
const longScope = Object.fromEntries(LOCALE_REGISTRY.map(({ id }) => [
  id,
  `fixture delivery scope (${id}) ${LONG_URL}`,
]));
const browserFixture = {
  ...readyFixture,
  facts: { ...readyFixture.facts, cloudflareProcessingScope: longScope },
};
const staticFiles = generateLegalPageFiles(browserFixture);
const staticRoot = await mkdtemp(path.join(tmpdir(), 'kb-legal-browser-'));
await Promise.all([...staticFiles].map(async ([relative, html]) => {
  const output = path.join(staticRoot, relative);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, html, 'utf8');
}));
const staticServer = await serveTree(staticRoot);

async function inspectOpenLocaleRepaint(page, viewport) {
  const from = LOCALE_REGISTRY.at(-1);
  const to = LOCALE_REGISTRY[0];
  const legalPage = 'privacy';
  await page.evaluate((pageId) => {
    const opener = document.getElementById('legalMatrixOpener');
    opener.dataset.legalOpen = pageId;
    opener.focus();
    opener.click();
  }, legalPage);
  await page.waitForFunction((pageId) => {
    const overlay = document.querySelector(`[data-legal-page="${pageId}"]`);
    return overlay?.classList.contains('on') && document.activeElement === overlay.querySelector('h1');
  }, legalPage);
  const before = await page.evaluate(() => {
    const overlay = document.querySelector('[data-legal-page="privacy"]');
    const body = overlay.querySelector('.pbody');
    body.scrollTop = Math.min(96, body.scrollHeight - body.clientHeight);
    overlay.querySelector('h1').focus({ preventScroll: true });
    return {
      locale: document.documentElement.dataset.locale,
      scrollTop: body.scrollTop,
    };
  });
  await page.evaluate(() => document.getElementById('languageNext').click());
  await page.waitForFunction(({ locale, tag }) =>
    document.documentElement.dataset.locale === locale
      && document.documentElement.lang === tag,
  { locale: to.id, tag: to.languageTag });
  const expected = legalDocument(to.id, legalPage, LEGAL_RELEASE.facts);
  const after = await page.evaluate(({ bodyHtml, longUrl }) => {
    const overlay = document.querySelector('[data-legal-page="privacy"]');
    const body = overlay.querySelector('.pbody');
    const article = overlay.querySelector('.legal-document');
    const heading = overlay.querySelector('h1');
    const normalize = (element) => {
      const clone = element.cloneNode(true);
      clone.querySelector('h1')?.removeAttribute('id');
      return clone.outerHTML;
    };
    const template = document.createElement('template');
    template.innerHTML = bodyHtml.trim();
    const sharedBody = normalize(article) === normalize(template.content.firstElementChild);
    const repaintScrollTop = body.scrollTop;

    const host = article.querySelector('p');
    const anchor = document.createElement('a');
    anchor.href = longUrl;
    anchor.textContent = longUrl;
    host.append(document.createElement('br'), anchor);
    anchor.scrollIntoView({ block: 'center' });
    const bodyRect = body.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(anchor);
    const lines = [...range.getClientRects()];
    const anchorRect = anchor.getBoundingClientRect();
    const result = {
      locale: document.documentElement.dataset.locale,
      title: heading.textContent,
      open: overlay.classList.contains('on'),
      focused: document.activeElement === heading,
      scrollTop: repaintScrollTop,
      sharedBody,
      longLinkWraps: lines.length > 1
        && lines.every((rect) => rect.left >= bodyRect.left - 1 && rect.right <= bodyRect.right + 1),
      longLinkReachable: anchorRect.bottom >= bodyRect.top - 1 && anchorRect.top <= bodyRect.bottom + 1,
      horizontal: body.scrollWidth - body.clientWidth,
    };
    anchor.previousSibling?.remove();
    anchor.remove();
    overlay.querySelector('[data-legal-close]').click();
    return new Promise((resolve) => requestAnimationFrame(() => {
      result.closed = !overlay.classList.contains('on')
        && !document.getElementById('ovStart').inert
        && document.activeElement?.id === 'legalMatrixOpener';
      resolve(result);
    }));
  }, { bodyHtml: expectedLegalBody(to.id, legalPage, LEGAL_RELEASE.facts),
    longUrl: LONG_URL });
  check(before.locale === from.id && after.locale === to.id,
    `${viewport}: an open legal page did not follow registry locale cycling`, { before, after });
  check(after.open && after.focused && after.title === expected.title,
    `${viewport}: locale repaint replaced, closed, or unfocused the active legal page`, after);
  check(Math.abs(after.scrollTop - before.scrollTop) <= 1,
    `${viewport}: locale repaint lost the legal scroll position`, { before, after });
  check(after.sharedBody,
    `${viewport}: repainted in-app legal HTML drifted from the shared renderer`, after);
  check(after.longLinkWraps && after.longLinkReachable && after.horizontal <= 1,
    `${viewport}: a long in-app legal URL clipped or became unreachable`, after);
  check(after.closed, `${viewport}: repainted legal close did not restore its opener`, after);
  return { from: before.locale, to: after.locale, longLinkWraps: after.longLinkWraps };
}

const browser = await chromium.launch();
try {
  for (const [width, height, viewport] of VIEWPORTS) {
    if (ONLY_SHEET_STACK) break;
    const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
    const page = await context.newPage();
    page.on('pageerror', (error) => errs.push(`${viewport}: ${error.message}`));
    await page.goto(FILE);
    // Hit-test the settled Home/overlay stack. The shared room fade is 280ms;
    // probing its compact Back target mid-fade makes the previous room own the
    // pseudo-element's outer pixels even though the final 44px lane is sound.
    await page.waitForTimeout(320);
    await page.evaluate(() => {
      const opener = document.createElement('button');
      opener.id = 'legalMatrixOpener';
      opener.textContent = 'legal test opener';
      opener.style.cssText = 'position:fixed;left:-10000px;top:0';
      document.getElementById('ovStart').append(opener);
    });
    const observations = [];

    for (let localeIndex = 0; localeIndex < LOCALE_REGISTRY.length; localeIndex++) {
      if (localeIndex > 0) {
        await page.evaluate(() => document.getElementById('languageNext').click());
        await page.waitForTimeout(20);
      }
      const identity = await page.evaluate(() => ({
        locale: document.documentElement.dataset.locale,
        lang: document.documentElement.lang,
      }));
      const locale = LOCALE_REGISTRY[localeIndex];
      check(identity.locale === locale.id, `${viewport}/${locale.id}: runtime locale order drifted`, identity);
      check(identity.lang === locale.languageTag,
        `${viewport}/${locale.id}: document language tag is wrong`, identity);

      for (const legalPage of LEGAL_PAGE_IDS) {
        await page.evaluate((pageId) => {
          const opener = document.getElementById('legalMatrixOpener');
          opener.dataset.legalOpen = pageId;
          opener.focus();
          opener.click();
        }, legalPage);
        await page.waitForFunction((pageId) => {
          const overlay = document.querySelector(`[data-legal-page="${pageId}"]`);
          return overlay?.classList.contains('on')
            && document.activeElement === overlay.querySelector('h1');
        }, legalPage);
        const observation = await page.evaluate(async ({ locale, legalPage, sharedBody }) => {
          // The shared room fade and Neon Wipe keep old and new overlays in
          // composited layers for .28s. Hit-test only after the authored
          // transitions settle, rather than assuming two frames are enough.
          const overlayTransitions = document.getAnimations({ subtree: true })
            .filter((animation) => animation.transitionProperty === 'opacity'
              || animation.transitionProperty === 'visibility'
              || animation.id.startsWith('kb-page-')
              || animation.id.startsWith('kb-duel-bracket-'));
          await Promise.allSettled(overlayTransitions.map((animation) => animation.finished));
          const overlay = document.querySelector(`[data-legal-page="${legalPage}"]`);
          const body = overlay.querySelector('.pbody');
          const heading = overlay.querySelector('h1');
          const article = overlay.querySelector('.legal-document');
          const title = overlay.querySelector('[data-legal-title]');
          const titleStyle = getComputedStyle(title);
          const titleRange = document.createRange();
          titleRange.selectNodeContents(title);
          const titleLines = new Set([...titleRange.getClientRects()]
            .filter((rect) => rect.width > .5)
            .map((rect) => rect.top.toFixed(2))).size;
          const bodyRect = body.getBoundingClientRect();
          const textOverflow = [];
          for (const element of body.querySelectorAll('h1,h2,p,li,a,button')) {
            if (!element.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(element);
            for (const rect of range.getClientRects()) {
              if (rect.width > .5 && (rect.left < bodyRect.left - 1 || rect.right > bodyRect.right + 1)) {
                textOverflow.push({ tag: element.tagName, text: element.textContent.slice(0, 45),
                  left: Math.round(rect.left), right: Math.round(rect.right) });
              }
            }
          }
          const targets = [...body.querySelectorAll('button'), overlay.querySelector('[data-legal-close]')]
            .map((button) => {
              const rect = button.getBoundingClientRect();
              const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
              const owns = (x, y) => {
                const hit = document.elementFromPoint(x, y);
                return hit === button || button.contains(hit);
              };
              const effective44 = rect.width >= 44 && rect.height >= 44
                || [[cx - 21, cy], [cx + 21, cy], [cx, cy - 21], [cx, cy + 21]]
                  .every(([x, y]) => owns(x, y));
              return { text: button.textContent.trim(), width: rect.width, height: rect.height,
                effective44 };
            });
          body.scrollTop = body.scrollHeight;
          const last = body.querySelector('.legal-related button:last-child');
          const lastRect = last.getBoundingClientRect();
          const scrolledBody = body.getBoundingClientRect();
          const result = {
            locale,
            legalPage,
            title: title.textContent,
            titleTransform: titleStyle.textTransform,
            titleLines,
            titleFits: title.scrollWidth <= title.clientWidth + 1,
            horizontal: body.scrollWidth - body.clientWidth,
            textOverflow,
            focused: document.activeElement === heading,
            backgroundInert: document.getElementById('ovStart').inert,
            targets,
            lastReachable: lastRect.top >= scrolledBody.top - 1 && lastRect.bottom <= scrolledBody.bottom + 1,
            nestedScroller: getComputedStyle(overlay.querySelector('.legal-document')).overflowY,
            sharedBody: (() => {
              const normalize = (element) => {
                const clone = element.cloneNode(true);
                clone.querySelector('h1')?.removeAttribute('id');
                return clone.outerHTML;
              };
              const template = document.createElement('template');
              template.innerHTML = sharedBody.trim();
              return normalize(article) === normalize(template.content.firstElementChild);
            })(),
          };
          overlay.querySelector('[data-legal-close]').click();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          result.closed = !overlay.classList.contains('on')
            && !document.getElementById('ovStart').inert
            && document.activeElement?.id === 'legalMatrixOpener';
          return result;
        }, {
          locale: locale.id,
          legalPage,
          sharedBody: expectedLegalBody(locale.id, legalPage, LEGAL_RELEASE.facts),
        });
        observations.push(observation);
        const label = `${viewport}/${locale.id}/${legalPage}`;
        check(observation.titleLines <= 1.1 && observation.titleFits,
          `${label}: compact header wrapped or clipped`, observation);
        check(observation.titleTransform === 'uppercase',
          `${label}: legal view header is not uppercase`, observation);
        check(observation.horizontal <= 1 && observation.textOverflow.length === 0,
          `${label}: legal copy overflows horizontally`, observation);
        check(observation.focused && observation.backgroundInert,
          `${label}: open focus/inert contract failed`, observation);
        check(observation.targets.every((target) => target.effective44),
          `${label}: an interactive target is below 44px`, observation.targets);
        check(observation.lastReachable, `${label}: final related link is unreachable`, observation);
        check(observation.nestedScroller === 'visible',
          `${label}: legal document created a nested scroller`, observation);
        check(observation.sharedBody,
          `${label}: in-app HTML drifted from the shared legal document renderer`, observation);
        check(observation.closed, `${label}: close did not restore opener and background`, observation);
      }
    }
    const localeRepaint = await inspectOpenLocaleRepaint(page, viewport);
    const staticPages = await inspectStaticLegalMatrix({
      context,
      viewport,
      check,
      errs,
      serverUrl: staticServer.url,
      fixture: browserFixture,
      longUrl: LONG_URL,
    });
    out[viewport] = { inAppCases: observations.length, staticPages, localeRepaint };
    await context.close();
  }
  out.legalAboveSheet = await inspectLegalAboveSheet(browser);
  const stack = out.legalAboveSheet;
  const partlyClipped = (clip) => {
    const percent = Number(clip.match(/([\d.]+)%\)$/)?.[1]);
    return percent > 0 && percent < 100;
  };
  const forwardPaints = ({ motion, state }) => motion.direction === 'forward'
    && JSON.stringify(motion.ids) === JSON.stringify([...WIPE_IDS].sort())
    && motion.signature.every(({ duration }) => duration === 280)
    && motion.sourceId === 'ovStart' && motion.targetId === 'ovPrivacy'
    && partlyClipped(motion.targetClip) && motion.targetTransform !== 'none'
    && motion.targetZ > motion.sheetZ && motion.sheetConnected
    && motion.beam?.opacity > 0 && motion.beam.width >= 2 && motion.beam.width <= 4
    && motion.beam.height >= 800
    && state.open && state.legalInert === false && state.sheetInert === true
    && state.headingFocused;
  check(forwardPaints(stack.forward),
    'Legal did not wipe visibly above the real sheet on forward navigation', stack.forward);
  check(forwardPaints(stack.reopen),
    'Legal did not re-enter above the real sheet before the edge-Back probe', stack.reopen);

  const backPaints = (motion) => motion.direction === 'back'
    && JSON.stringify(motion.ids) === JSON.stringify(BACK_IDS)
    && motion.signature.every(({ id, duration }) =>
      duration === (id.startsWith('kb-duel-bracket-') ? 220 : 280))
    && motion.sourceId === 'ovPrivacy' && motion.targetId === 'ovStart'
    && partlyClipped(motion.sourceClip) && motion.sourceTransform !== 'none'
    && motion.sourceZ > motion.sheetZ && motion.sheetConnected
    && motion.beam?.opacity > 0 && motion.beam.width >= 2 && motion.beam.width <= 4
    && motion.beam.height >= 800;
  check(backPaints(stack.buttonBack),
    'button Back skipped or painted the shared Legal Neon source/beam below the sheet',
    stack.buttonBack);
  check(backPaints(stack.swipeBack),
    'edge Back skipped or painted the shared Legal Neon source/beam below the sheet',
    stack.swipeBack);
  check(JSON.stringify(stack.swipeBack.signature) === JSON.stringify(stack.buttonBack.signature),
    'edge Back did not run the exact button Back timeline above the sheet', {
      button: stack.buttonBack.signature,
      swipe: stack.swipeBack.signature,
    });
  for (const [door, landing] of Object.entries({
    button: stack.buttonLanding,
    edge: stack.swipeLanding,
  })) {
    check(landing.sheetConnected && landing.sheetPainted && landing.sheetInert === false
      && !landing.legalOpen && landing.legalInert === true && landing.homeInert === true
      && landing.openerFocused && landing.transients === 0 && landing.zLeaks === 0,
    `${door} Back did not settle onto the sheet with its nested modal state restored`, landing);
  }
} finally {
  await browser.close();
  staticServer.stop();
  await rm(staticRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ out, problems, errs }, null, 2));
process.exitCode = problems.length || errs.length ? 1 : 0;
