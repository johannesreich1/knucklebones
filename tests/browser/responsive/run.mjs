import pkg from 'playwright';
import { runLandscapeScenarios } from './scenarios/landscape.mjs';
import { runInputAccessibilityScenarios } from './scenarios/input-accessibility.mjs';
import { runMotionSafeAreaScenarios } from './scenarios/motion-safe-areas.mjs';

const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], errs = [];
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
const out = {};

const markExperienced = (context) => context.addInitScript(() => {
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

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();
