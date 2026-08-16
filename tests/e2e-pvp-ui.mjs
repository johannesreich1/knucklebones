// LIVE two-browser test of online match play against the real backend.
// NOT part of the automated gate (needs the two SQL-created e2e users and
// mutates live data; wipe matches + queue first). See e2e-pvp.mjs for the
// API-level version. Run: node tests/e2e-pvp-ui.mjs
// two browser contexts, one live PvP match, then a bot match
import pkg from 'playwright';
const { chromium, devices } = pkg;
import { spawn } from 'child_process';
const server = spawn('python3', ['tests/serve.py'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const problems = [];
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
const browser = await chromium.launch();
try {
  const mk = async (email, pass) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.errs = [];
    page.on('pageerror', e => page.errs.push(e.message));
    await page.goto('http://127.0.0.1:8123/index.html');
    await page.waitForTimeout(500);
    await page.tap('#btnOnline');
    await page.waitForSelector('#onAuth:not([hidden])', { timeout: 8000 });
    await page.fill('#onEmail', email); await page.fill('#onPass', pass);
    await page.tap('#btnSignIn');
    await page.waitForSelector('#onMenu:not([hidden])', { timeout: 8000 });
    return page;
  };
  const A = await mk('e2e.pvp.alice@example.com', 'e2e-pvp-password-1!');
  const B = await mk('e2e.pvp.bob@example.com', 'e2e-pvp-password-2!');

  const inMatch = p => p.evaluate(() => document.getElementById('rec')?.textContent === 'ONLINE'
    && !document.getElementById('ovOnline').classList.contains('on'));
  const snap = p => p.evaluate(() => {
    const S = window.__kb.S;
    return { turn: S.turn, bottom: S.bottom, phase: S.phase,
             b0: JSON.stringify(S.boards[0]), b1: JSON.stringify(S.boards[1]),
             over: document.getElementById('ovOnline').classList.contains('on') };
  });

  await A.tap('#btnPlayOnline');
  await A.waitForTimeout(3000);   // A must be server-side queued before B joins,
  await B.tap('#btnPlayOnline');  // so B pairs on its FIRST poll (no bot races)
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (await inMatch(A) && await inMatch(B)) break;
    await A.waitForTimeout(400);
  }
  check(await inMatch(A) && await inMatch(B), 'both players did not enter the match');
  const [midA, midB] = await Promise.all([A, B].map(p => p.evaluate(() => window.__kbOnline?.()?.matchId)));
  check(!!midA && midA === midB, 'players are in DIFFERENT matches', { midA, midB });
  if (midA !== midB) throw new Error('abort: separate matches');

  // play to completion: whoever's turn it is taps their first legal column
  let rounds = 0, finished = false;
  while (rounds < 80 && !finished) {
    const [sa, sb] = [await snap(A), await snap(B)];
    if (sa.over && sb.over) { finished = true; break; }
    for (const [p, s] of [[A, sa], [B, sb]]) {
      if (!s.over && s.phase === 'choose' && s.turn === s.bottom) {
        const col = await p.evaluate(() => {
          const S = window.__kb.S;
          return S.boards[S.bottom].findIndex(c => c.length < 3);
        });
        if (col >= 0) await p.tap(`#botBoard .col[data-col="${col}"]`);
      }
    }
    await A.waitForTimeout(900);
    rounds++;
  }
  // allow the finish handler to fire on both
  await A.waitForTimeout(3000);
  const [fa, fb] = [await snap(A), await snap(B)];
  check(fa.over && fb.over, 'match did not finish on both screens', { fa: fa.over, fb: fb.over, rounds });
  // boards agreed at the end
  check(fa.b0 === fb.b0 && fa.b1 === fb.b1, 'boards diverged between players', { a: fa, b: fb });
  const sumA = await A.textContent('#onWho');
  check(/Elo/.test(sumA), 'end summary missing Elo delta', sumA);

  // ---- bot match: alice alone, waits past the bot threshold ----
  await A.tap('#btnPlayOnline');
  const t1 = Date.now();
  while (Date.now() - t1 < 25000) { if (await inMatch(A)) break; await A.waitForTimeout(500); }
  check(await inMatch(A), 'bot match did not start');
  let brounds = 0;
  while (brounds < 80) {
    const s = await snap(A);
    if (s.over) break;
    if (s.phase === 'choose' && s.turn === s.bottom) {
      const col = await A.evaluate(() => {
        const S = window.__kb.S;
        return S.boards[S.bottom].findIndex(c => c.length < 3);
      });
      if (col >= 0) await A.tap(`#botBoard .col[data-col="${col}"]`);
    }
    await A.waitForTimeout(700);
    brounds++;
  }
  await A.waitForTimeout(3000);
  check((await snap(A)).over, 'bot match did not finish', { brounds });

  check(A.errs.length === 0 && B.errs.length === 0, 'page errors', { a: A.errs.slice(0, 3), b: B.errs.slice(0, 3) });
  console.log(JSON.stringify({ rounds, brounds, summaryA: sumA?.slice(0, 80), problems }, null, 2));
} finally { await browser.close(); server.kill(); }
process.exit(problems.length ? 1 : 0);
