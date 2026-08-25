import pkg from 'playwright';
import { serveTree } from '../../serve.mjs';
import { runOnlineLocalizationScenarios } from './scenarios/online-surfaces.mjs';

const { chromium } = pkg;
const { url, stop } = await serveTree('.');
const browser = await chromium.launch();
const problems = [];
const errs = [];
const out = {};
const check = (condition, message, detail) => {
  if (condition) return;
  const encoded = JSON.stringify(detail);
  problems.push(`${message} :: ${encoded.length > 2400 ? `${encoded.slice(0, 2400)}…` : encoded}`);
};

try {
  await runOnlineLocalizationScenarios({
    browser,
    standaloneUrl: `${url}knucklebones-neon.html`,
    problems,
    errs,
    out,
    check,
  });
} catch (error) {
  problems.push(`online-localization THREW :: ${error?.stack ?? error}`);
} finally {
  await browser.close();
  stop();
}

console.log(JSON.stringify({ out, problems, errs }, null, 2));
process.exitCode = problems.length || errs.length ? 1 : 0;
