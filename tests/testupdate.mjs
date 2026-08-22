// Proves a deploy is visible after ONE relaunch (network-first page) and that
// offline launches still boot from cache afterwards.
// NOTE: mutates ./pwa in place — run ./build.sh afterwards to restore it.
import pkg from 'playwright';
const { chromium, devices } = pkg;
import { readFileSync, writeFileSync } from 'fs';
import { servedBase } from './serve.mjs';
/* Mutating pwa/ under a LIVE server is this suite's whole method, which is why
   it runs alone and last — and why the server must be this tree's own. The
   address arrives in KB_URL from run-all, or is minted here for a hand-run. */
const URL = await servedBase() + 'index.html';
const browser = await chromium.launch();
const problems = [], errs = [];
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', e => errs.push(e.message));
await p.goto(URL);
await p.waitForTimeout(800);
const sw1 = await p.evaluate(async () => !!(await navigator.serviceWorker.ready.catch(() => null))?.active);
// deploy truth is the data-build attribute; the visible tag moved to the
// Account panel, which lives in the lazily-loaded online chunk
const tag1 = await p.evaluate(() => 'build ' + document.documentElement.dataset.build);

// simulate a fresh deploy: server files change under the running app
// (in-process replace, not sed — GNU and BSD sed disagree on -i syntax)
const hash = tag1.split(' ')[1];
const patch = (file, from, to) => {
  const t = readFileSync(file, 'utf8');
  const n = t.replace(from, to);
  if (n === t) { console.error(`PATCH FAILED: ${from} not found in ${file}`); process.exit(1); }
  writeFileSync(file, n);
};
patch('./pwa/index.html', `data-build="${hash}"`, 'data-build="NEWDEPLOY"');
patch('./pwa/sw.js', /const VERSION = '.*';/, "const VERSION = 'kb-newdeploy';");

await p.reload(); await p.waitForTimeout(1200);          // ONE relaunch
const tag2 = await p.evaluate(() => 'build ' + document.documentElement.dataset.build);
check(tag2 === 'build NEWDEPLOY', 'one relaunch did not pick up the deploy', { tag1, tag2 });

await p.waitForTimeout(1500);                            // let the new SW cache
await ctx.setOffline(true);
await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(1500);
const off = await p.evaluate(() => ({
  booted: !!window.__kb,
  tag: document.documentElement.dataset.build ?? null,
}));
check(off.booted && off.tag === 'NEWDEPLOY', 'offline launch broken after update', off);

console.log(JSON.stringify({ sw1, tag1, tag2, off, problems, errs }, null, 2));
console.log('reminder: run ./build.sh to restore ./pwa');
await browser.close();
