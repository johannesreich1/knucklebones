import pkg from 'playwright';
import { serveTree } from '../../serve.mjs';
import { createBrowserReport } from '../../support/browser-report.mjs';
import { runOnlineLocalizationScenarios } from './scenarios/online-surfaces.mjs';

const { chromium } = pkg;
const { url, stop } = await serveTree('.');
const browser = await chromium.launch();
/* This tree's failure details carry whole rendered-surface inventories; the
   shared report clips them so one failed check stays a readable line. */
const { problems, errs, out, check } = createBrowserReport({ maxDetailChars: 2400 });

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
