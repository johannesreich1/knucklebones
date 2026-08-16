// Proves a deploy is visible after ONE relaunch (network-first page) and that
// offline launches still boot from cache afterwards.
// NOTE: mutates ./pwa in place — run ./build.sh afterwards to restore it.
import pkg from 'playwright';
const { chromium, devices } = pkg;
import { readFileSync, writeFileSync } from 'fs';
const browser = await chromium.launch();
const problems = [], errs = [];
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:8123/index.html');
await p.waitForTimeout(800);
const sw1 = await p.evaluate(async () => !!(await navigator.serviceWorker.ready.catch(() => null))?.active);
const tag1 = await p.evaluate(() => document.getElementById('buildTag').textContent);

// simulate a fresh deploy: server files change under the running app
// (in-process replace, not sed — GNU and BSD sed disagree on -i syntax)
const hash = tag1.split(' ')[1];
const patch = (file, from, to) =>
  writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));
patch('./pwa/index.html', `build ${hash}<`, 'build NEWDEPLOY<');
patch('./pwa/sw.js', /const VERSION = '.*';/, "const VERSION = 'kb-newdeploy';");

await p.reload(); await p.waitForTimeout(1200);          // ONE relaunch
const tag2 = await p.evaluate(() => document.getElementById('buildTag').textContent);
check(tag2 === 'build NEWDEPLOY', 'one relaunch did not pick up the deploy', { tag1, tag2 });

await p.waitForTimeout(1500);                            // let the new SW cache
await ctx.setOffline(true);
await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(1500);
const off = await p.evaluate(() => ({
  booted: !!window.__kb,
  tag: document.getElementById('buildTag')?.textContent ?? null,
}));
check(off.booted && off.tag === 'build NEWDEPLOY', 'offline launch broken after update', off);

console.log(JSON.stringify({ sw1, tag1, tag2, off, problems, errs }, null, 2));
console.log('reminder: run ./build.sh to restore ./pwa');
await browser.close();
