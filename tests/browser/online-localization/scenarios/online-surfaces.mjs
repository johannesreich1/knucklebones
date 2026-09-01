import { RESOURCES } from '../../../../src/i18n/catalogs.ts';
import { LOCALE_REGISTRY } from '../../../../src/i18n/locale.ts';
import { installOnlineRoutes } from '../../online-ui/harness/routes.mjs';
import { checkReachableTargets, checkSurface, frame,
  inspectSurface } from '../../localization/harness/layout-inspection.mjs';
import { inspectRuneSheets } from './profile-rune-sheets.mjs';
import { inspectOfflineSheet } from './connection-sheet.mjs';

const VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '390x844', width: 390, height: 844 },
  { name: '568x320', width: 568, height: 320 },
  { name: '667x375', width: 667, height: 375 },
];
const GUEST_ID = '00000000-0000-4000-8000-00000000cafe';
const PROFILE_TARGETS = [
  '#btnAvatar', '#btnLadder', '#btnRank', '#onNick', '#btnClaim',
  '#accRuneGrid .accrune[data-rune="fate"]', '#accRuneGrid .accrune[data-rune="nudge"]',
  '#btnKeepAcc', '#btnHaveAcc', '#btnHistory', '#btnDeleteAcc',
];

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = (subject) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
  sub: subject,
  aud: 'authenticated',
  role: 'authenticated',
  is_anonymous: true,
  exp: Math.floor(Date.now() / 1000) + 3600,
})}.stub`;

function session() {
  return {
    access_token: jwt(GUEST_ID),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'stub',
    user: {
      id: GUEST_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: null,
      is_anonymous: true,
      created_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
      identities: [],
    },
  };
}

async function header(page) {
  return inspectSurface(page, '#ovOnline', ['.shead .ttl']);
}

async function panel(page, selectors) {
  return inspectSurface(page, '#ovOnline .pbody', selectors);
}

async function assertPanel(suite, page, label, selectors, targets = []) {
  const { check } = suite;
  const heading = await header(page);
  const content = await panel(page, selectors);
  checkSurface(check, `${label}-header`, heading, { targets: false });
  checkSurface(check, label, content, { allowScrollable: true, targets: false });
  if (targets.length) await checkReachableTargets(page, check, label, targets);
  return { heading, content };
}

async function waitForPanel(page, id, requiredSelectors = []) {
  await page.waitForFunction(({ panelId, requiredSelectors: selectors }) => {
    const target = document.getElementById(panelId);
    if (!target || target.hidden) return false;
    return selectors.every((selector) => {
      const element = target.querySelector(selector);
      if (!element) return false;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== 'none'
        && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
    });
  }, { panelId: id, requiredSelectors }, { timeout: 15000 });
  await frame(page);
}

async function installFixtures(page, localeId) {
  const preferences = {
    user_id: GUEST_ID,
    locale: localeId,
    sound: true,
    numerals: false,
    p1_hue: 'cy',
    p2_hue: 'mg',
    colorblind: false,
    reduced_motion: true,
  };
  await page.route('**/rest/v1/player_settings*', (route) => route.fulfill({
    status: route.request().method() === 'GET' ? 200 : 201,
    contentType: 'application/json',
    body: route.request().method() === 'GET' ? JSON.stringify([preferences]) : '[]',
  }));
  await installOnlineRoutes(page, {
    anonymous: 200,
    attached: false,
    door: 'chip',
    named: false,
    runes: ['fate', 'ward'],
    equippedRune: 'fate',
    standingPoints: 1400,
    SESSION: session(),
    GUEST_ID,
  });
}

async function inspectAccount(suite, page, label) {
  const surface = await assertPanel(suite, page, `profile-${label}`, [
    '#accGroup', '#btnLadder', '#btnLadder span', '.fact span',
    '#accSeat', '#accRunesTitle', '#accRuneCount', '.accrune',
    '#accClaim b', '#accClaim p', '#onNick', '#btnClaim',
    '#accGuest b', '#accGuest p', '#btnKeepAcc', '#btnHaveAcc',
    '#accRecentTitle',
    '#btnHistory', '#accSince', '#btnDeleteAcc',
  ], PROFILE_TARGETS);
  const runeHeading = await page.evaluate(() => {
    const root = document.getElementById('kbroot');
    const title = document.getElementById('accRunesTitle');
    const count = document.getElementById('accRuneCount');
    return {
      minimum: root
        ? parseFloat(getComputedStyle(root).getPropertyValue('--font-label-min'))
        : 0,
      title: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
      count: count ? parseFloat(getComputedStyle(count).fontSize) : 0,
    };
  });
  suite.check(runeHeading.minimum >= 10
      && runeHeading.title >= runeHeading.minimum
      && runeHeading.count >= runeHeading.minimum,
    `profile-${label} rune heading fell below the shared compact-label minimum`,
    runeHeading);
  return { ...surface, runeHeading };
}

async function inspectAuth(suite, page, label, locale) {
  const root = '.authsheet #onAuth';
  const heading = await inspectSurface(page, root, ['#onAuthTitle']);
  const content = await inspectSurface(page, root, [
    '#onAuthLead', '#onEmail', '#onPass', '#onAuthActs .btn',
    '#btnAuthSwap:not([hidden])', '#onAuthTiny',
  ]);
  checkSurface(suite.check, `auth-${label}-header`, heading, { targets: false });
  checkSurface(suite.check, `auth-${label}`, content,
    { allowScrollable: true, targets: false });
  const chrome = await inspectSurface(page, '.authsheet .focard', ['.fograb']);
  /* The drawn grabber is 14px; its ::after is the 44px hit target. The reach
     probe below measures actual hit ownership instead of the drawing box. */
  checkSurface(suite.check, `auth-${label}-chrome`, chrome, { targets: false });
  await checkReachableTargets(page, suite.check, `auth-${label}`, [
    '.authsheet .fograb', '#onEmail', '#onPass', '#onAuthActs .btn', '#btnAuthSwap:not([hidden])',
  ]);
  const worstError = Object.values(RESOURCES[locale].online.errors)
    .reduce((longest, copy) => [...copy].length > [...longest].length ? copy : longest, '');
  await page.evaluate((copy) => { document.getElementById('onAuthErr').textContent = copy; }, worstError);
  await frame(page);
  const error = await inspectSurface(page, root, ['#onAuthErr']);
  checkSurface(suite.check, `auth-error-${label}`, error,
    { allowScrollable: true, targets: false });
  return { heading, content, error };
}

async function inspectAvatar(suite, page, label) {
  return assertPanel(suite, page, `avatar-${label}`, [
    '#onAvatar .lbl', '#avFaces button', '#avHues button', '#btnAvatarSave',
  ], [
    '#avFaces button:nth-of-type(1)', '#avFaces button:nth-of-type(6)',
    '#avHues button:nth-of-type(1)', '#avHues button:nth-of-type(6)', '#btnAvatarSave',
  ]);
}

async function inspectHistory(suite, page, label) {
  return assertPanel(suite, page, `history-${label}`, [
    '#onHistoryTotal', '#onHistoryList .history-row',
    '#onHistoryList .hres', '#onHistoryList .hsc',
    '#onHistoryList .hd', '#onHistoryList .hwhen',
  ]);
}

async function inspectLadder(suite, page, label) {
  return assertPanel(suite, page, `ladder-${label}`, [
    '#onLadderList .ghor', '#onLadderList .lrow',
    '#onLadderList .ws', '#onLadderList .rt',
  ], ['#onLadderList .lrow >> nth=0']);
}

async function inspectFaceoff(suite, page, label) {
  const surface = await inspectSurface(page, '.faceoff', [
    '.focard', '.fograb', '.gpill', '.fost', '.fogap', '.fovs',
  ]);
  checkSurface(suite.check, `faceoff-${label}`, surface, { targets: false });
  const focus = await page.evaluate(() => {
    const card = document.querySelector('.focard');
    const grabber = document.querySelector('.fograb');
    return {
      modal: card?.getAttribute('role') === 'dialog'
        && card?.getAttribute('aria-modal') === 'true',
      grabberLabel: grabber?.getAttribute('aria-label') ?? '',
    };
  });
  suite.check(focus.modal && focus.grabberLabel,
    `faceoff-${label} lost its accessible modal/close behavior`, focus);
  return surface;
}

async function inspectRankedResult(suite, page, label) {
  await page.evaluate((report) => {
    document.getElementById('ovOnline')?.classList.remove('on');
    window.__kbResult(report);
  }, {
    won: true,
    draw: false,
    forfeit: false,
    my: 108,
    their: 99,
    delta: 21,
    opp: 'MaximumName_1234',
    oppAvatar: 'die:6:violet',
    oppRating: 1450,
  });
  await page.waitForSelector('#ovEnd.on', { timeout: 15000 });
  await page.waitForSelector('#endPlates > *');
  await frame(page);
  const result = await inspectSurface(page, '#ovEnd', [
    '#endTitle', '#endSub', '#endMeta', '#endPlates > *',
    '#endPlates .pname', '#btnAgain:not([hidden])',
    '#btnEndQuiet:not([hidden])', '#btnShare:not([hidden])',
  ]);
  result.overflowOwners = await page.evaluate(() => [...document.querySelectorAll('#ovEnd *')]
    .flatMap((element) => {
      const box = element.getBoundingClientRect();
      if (box.left >= -0.5 && box.right <= innerWidth + 0.5
          && element.scrollWidth <= element.clientWidth + 0.5) return [];
      return [{
        selector: element.id ? `#${element.id}` : `.${element.className}`,
        left: box.left,
        right: box.right,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }];
    }));
  result.actions = await page.evaluate(() => ['btnAgain', 'btnEndQuiet'].map((id) => {
    const button = document.getElementById(id);
    const copy = button?.querySelector(':scope > .btn-label');
    const icon = button?.querySelector(':scope > .btn-leading-icon:not([hidden])');
    return {
      id,
      label: (copy?.textContent ?? button?.textContent ?? '').trim(),
      icon: icon?.getAttribute('data-icon') ?? null,
      iconBeforeLabel: !!icon && !!copy
        && [...button.children].indexOf(icon) < [...button.children].indexOf(copy),
    };
  }));
  checkSurface(suite.check, `ranked-result-${label}`, result,
    { allowScrollable: true, targets: false });
  await checkReachableTargets(page, suite.check, `ranked-result-${label}`,
    ['#btnAgain:not([hidden])', '#btnEndQuiet:not([hidden])', '#btnShare:not([hidden])']);
  return result;
}

async function runViewport(suite, locale, viewport) {
  const { browser, standaloneUrl, errs, check } = suite;
  const label = `${viewport.name}/${locale.id}`;
  const context = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    locale: locale.languageTag,
  });
  await context.addInitScript(() => localStorage.setItem(
    'knucklebones.v1', JSON.stringify({ played: true }),
  ));
  const page = await context.newPage();
  page.on('pageerror', (error) => errs.push(`${label} PAGEERROR: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errs.push(`${label} CONSOLE: ${message.text()}`);
  });
  await installFixtures(page, locale.id);
  await page.goto(standaloneUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(({ id, tag }) => document.documentElement.dataset.locale === id
    && document.documentElement.lang === tag, { id: locale.id, tag: locale.languageTag });

  await page.click('#homeChip');
  await waitForPanel(page, 'onAccount', PROFILE_TARGETS);
  const account = await inspectAccount(suite, page, label);
  check(account.heading.items[0]?.text === RESOURCES[locale.id].online.panels.profile,
    `${label} profile title did not use its locale`, account.heading.items);
  const runeSheets = await inspectRuneSheets(suite, page, label, locale);

  await page.click('#btnHaveAcc');
  await page.waitForSelector('.authsheet #onAuth', { timeout: 15000 });
  await frame(page);
  const auth = await inspectAuth(suite, page, label, locale.id);
  check(auth.heading.items[0]?.text === RESOURCES[locale.id].online.auth.signInTitle,
    `${label} auth title did not use its locale`, auth.heading.items);
  await page.click('.authsheet .fograb');
  await page.waitForSelector('.authsheet', { state: 'detached' });
  await waitForPanel(page, 'onAccount', PROFILE_TARGETS);
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on');

  await page.click('#homeChip');
  await waitForPanel(page, 'onAccount', PROFILE_TARGETS);
  await page.click('#btnAvatar');
  await waitForPanel(page, 'onAvatar');
  await inspectAvatar(suite, page, label);
  await page.click('#btnOnlineBack');
  await waitForPanel(page, 'onAccount', PROFILE_TARGETS);

  await page.click('#btnHistory');
  await waitForPanel(page, 'onHistory');
  await inspectHistory(suite, page, label);
  await page.click('#btnOnlineBack');
  await waitForPanel(page, 'onAccount', PROFILE_TARGETS);

  await page.click('#btnLadder');
  await waitForPanel(page, 'onLadder');
  const ladder = await inspectLadder(suite, page, label);
  check(ladder.heading.items[0]?.text === RESOURCES[locale.id].online.panels.ladder,
    `${label} ladder title did not use its locale`, ladder.heading.items);
  await page.click('#onLadderList .lrow >> nth=0');
  await page.waitForSelector('.faceoff .focard');
  await page.waitForFunction(() => /\d/u.test(document.querySelector('.faceoff .fostreak')?.textContent ?? ''));
  await frame(page);
  await inspectFaceoff(suite, page, label);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.faceoff'));

  const result = await inspectRankedResult(suite, page, label);
  check(result.items.find(({ selector }) => selector === '#endTitle')?.text
    === RESOURCES[locale.id].game.result.victory,
  `${label} ranked result title did not use its locale`, result.items);
  check(result.actions[0]?.label === RESOURCES[locale.id].online.result.nextDuel
    && result.actions[0].icon === 'play' && result.actions[0].iconBeforeLabel,
  `${label} ranked Next duel lost its selected leading die or localized label`, result.actions);
  check(result.actions[1]?.label === RESOURCES[locale.id].common.actions.home
    && result.actions[1].icon === null,
  `${label} ranked Home changed label or received a play icon`, result.actions);
  const offline = await inspectOfflineSheet(suite, page, label, locale.id);
  await context.close();
  return {
    profileItems: account.content.items.length,
    runeSheetItems: runeSheets.unlocked.surface.items.length + runeSheets.locked.surface.items.length,
    authItems: auth.content.items.length,
    ladderItems: ladder.content.items.length,
    resultItems: result.items.length,
    offlineItems: offline.offline.items.length,
    unavailableItems: offline.unavailable.items.length,
  };
}

export async function runOnlineLocalizationScenarios(suite) {
  suite.out.onlineLocalization = {};
  const locales = process.env.KB_TEST_LOCALE
    ? LOCALE_REGISTRY.filter(({ id }) => id === process.env.KB_TEST_LOCALE)
    : LOCALE_REGISTRY;
  const viewports = process.env.KB_TEST_VIEWPORT
    ? VIEWPORTS.filter(({ name }) => name === process.env.KB_TEST_VIEWPORT)
    : VIEWPORTS;
  for (const locale of locales) {
    suite.out.onlineLocalization[locale.id] = {};
    for (const viewport of viewports) {
      suite.out.onlineLocalization[locale.id][viewport.name]
        = await runViewport(suite, locale, viewport);
    }
  }
}
