import pkg from 'playwright';
import { serveTree } from '../../serve.mjs';
import { runLandscapeScenarios } from './scenarios/landscape.mjs';
import { runInputAccessibilityScenarios } from './scenarios/input-accessibility.mjs';
import { runMotionSafeAreaScenarios } from './scenarios/motion-safe-areas.mjs';
import { runMenuPressFeedbackScenarios } from './scenarios/menu-press-feedback.mjs';

const { chromium, devices } = pkg;
/* The reduced-motion settings coda reloads the app. Chromium's file://
   DOMStorage can restore a stale record across that reload even while a
   keeper page holds the area open, so use the same coherent local HTTP origin
   as the other persistence suites. Other browser suites retain file://
   coverage for the standalone artifact. */
const { url } = await serveTree('.');
const F = url + 'knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], errs = [];
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
const out = {};

const markExperienced = (context) => context.addInitScript(() => {
  // HTTP would otherwise register the production service worker; it is not
  // part of this responsive/settings suite and file:// never exposed it.
  try { delete Navigator.prototype.serviceWorker; } catch { /* strict hosts keep it */ }
  const k = 'knucklebones.v1';
  const cur = JSON.parse(localStorage.getItem(k) || '{}');
  if (!cur.played) {
    cur.played = true;
    localStorage.setItem(k, JSON.stringify(cur));
  }
});

const suite = { browser, devices, F, problems, errs, out, check, markExperienced };
await runLandscapeScenarios(suite);
await runInputAccessibilityScenarios(suite);
await runMotionSafeAreaScenarios(suite);
await runMenuPressFeedbackScenarios(suite);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();
