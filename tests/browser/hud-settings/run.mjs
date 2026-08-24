import pkg from 'playwright';
import { serveTree } from '../../serve.mjs';
import { runHudPopupScenarios } from './scenarios/hud-popups.mjs';
import { runOfflineRestartScenarios } from './scenarios/offline-restart.mjs';
import { runSettingsNavigationScenarios } from './scenarios/settings-navigation.mjs';
import { runBadgeCardScenarios } from './scenarios/badge-cards.mjs';
import { runLanguageSelectorScenarios } from './scenarios/language-selector.mjs';
import { modeCopy, spellCopy, t } from '../../../src/i18n/index.ts';

const { chromium, devices } = pkg;
/* Served over LOCAL HTTP for the same reason as test10: the settings-persist
   coda reloads and asserts the flags came back, and Chromium's file://
   DOMStorage can hydrate the reloaded document from a stale disk commit
   straight through the keeper page (run 32486960831 lost this suite's write
   the same afternoon test10 lost its own twice). One live http-origin area,
   no disk race. Own server on a kernel-picked port, gone with the process
   (tests/serve.mjs), so no peer session's gate can answer it. The remaining
   file suites keep covering file://. */
const { url } = await serveTree('.');
const F = url + 'knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], errs = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true,
  locale: 'en-US' });
/* over http the single-file page would try to register its service worker
   (file:// never attempts it) and 404 on /sw.js — not this suite's subject,
   and the console error would fail the gate. Make the capability absent, the
   same world every file:// suite already runs in. */
await ctx.addInitScript(() => { try { delete Navigator.prototype.serviceWorker; } catch { /* strict hosts keep it */ } });
await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(F); await page.waitForTimeout(500);

const suite = { page, ctx, F, problems, errs, out, check, modeCopy, spellCopy, t };
await runHudPopupScenarios(suite);
await runOfflineRestartScenarios(suite);
await runSettingsNavigationScenarios(suite);
await runBadgeCardScenarios(suite);
await runLanguageSelectorScenarios(suite);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();   // the server is in-process and unref'd — it goes with us
