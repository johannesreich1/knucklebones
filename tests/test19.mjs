// THE FIRST-RUN OFFER: a newcomer is asked once, and never again.
//
// Every other suite now declares itself an experienced player, because the
// offer intercepts the first real game by design. This is the suite that keeps
// the design honest — and the one that would have caught it costing ten suites
// if it had existed first.
//
// The rule it guards is a single fact, S.played, written by BOTH endings
// (offline endGame and the ranked finish handler) and read by BOTH the offer
// and the hub's highlight. Two flags would drift the first time somebody's
// first game was ranked.
import pkg from 'playwright';
const { chromium } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const browser = await chromium.launch();
try {
  // ---- a brand-new player: empty storage, nothing played, nothing taught ----
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message));
  await page.goto(F);
  await page.waitForTimeout(400);

  // the hub shouts about the tutorial, and only about the tutorial
  await page.click('#btnLearn');
  await page.waitForTimeout(320);
  out.freshHub = await page.evaluate(() => ({
    fresh: document.querySelector('#ovLearn').classList.contains('fresh'),
    rows: [...document.querySelectorAll('.learnrow .lname')].map((e) => e.textContent),
  }));
  check(out.freshHub.fresh, 'the hub does not highlight the tutorial for a newcomer', out.freshHub);
  check(out.freshHub.rows[0] === 'Tutorial', 'the tutorial is not the first row', out.freshHub);
  await page.click('#btnLearnBack');
  await page.waitForTimeout(300);

  // starting a real game asks first
  await page.evaluate(() => window.__kb.openPractice());
  await page.click('#btnPlay');
  await page.waitForSelector('#ovFirst.on', { timeout: 5000 });
  out.offered = await page.evaluate(() => ({
    on: document.querySelector('#ovFirst').classList.contains('on'),
    yes: document.querySelector('#btnFirstYes').textContent.trim(),
    no: document.querySelector('#btnFirstNo').textContent.trim(),
    // 'menu' is the boot phase: no newGame has run behind the offer
    phase: window.__kb.S.phase,
  }));
  check(out.offered.on, 'a newcomer was not offered the tutorial', out.offered);
  check(out.offered.phase === 'menu', 'a game started BEHIND the offer', out.offered);

  // declining starts the game they actually asked for
  await page.click('#btnFirstNo');
  await page.waitForTimeout(900);
  out.declined = await page.evaluate(() => ({
    offerGone: !document.querySelector('#ovFirst').classList.contains('on'),
    phase: window.__kb.S.phase,
    tut: !!window.__kb.S.tut,
  }));
  check(out.declined.offerGone && ['roll', 'choose'].includes(out.declined.phase),
    'declining the tutorial did not start the game', out.declined);
  check(!out.declined.tut, 'declining the tutorial started the tutorial', out.declined);

  // ---- finishing a real game retires the offer for good ----
  await page.evaluate(() => {
    const k = window.__kb;
    k.S.boards[1] = [[6, 6, 6], [5, 5, 5], [4, 4]];
    k.S.boards[0] = [[1], [2], [3]];
    k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose'; k.S.die = 2;
    k.applySides(); k.renderAll(false); k.setStageDie(2, 1);
  });
  await page.evaluate(() => window.__kb.place(1, 2));
  await page.waitForSelector('#ovEnd.on', { timeout: 8000 });
  await page.waitForTimeout(500);
  out.afterGame = await page.evaluate(() => ({
    played: window.__kb.S.played,
    stored: JSON.parse(localStorage.getItem('knucklebones.v1') || '{}').played,
  }));
  check(out.afterGame.played === true, 'finishing a game did not record that one was played', out.afterGame);
  check(out.afterGame.stored === true, 'the flag did not survive to storage', out.afterGame);

  // ...so Next duel goes straight into a game, and the hub stops shouting
  await page.click('#btnAgain');
  await page.waitForTimeout(900);
  out.second = await page.evaluate(() => ({
    offered: document.querySelector('#ovFirst')?.classList.contains('on') ?? false,
    phase: window.__kb.S.phase,
  }));
  check(!out.second.offered, 'the offer came back after a game was played', out.second);

  await page.evaluate(() => window.__kb.goHome());
  await page.waitForTimeout(250);
  await page.click('#btnLearn');
  await page.waitForTimeout(320);
  out.hubAfter = await page.evaluate(() =>
    document.querySelector('#ovLearn').classList.contains('fresh'));
  check(out.hubAfter === false, 'the hub still highlights the tutorial after a game', out.hubAfter);
} catch (e) {
  problems.push('THREW :: ' + e.message);
} finally { await browser.close(); }

console.log(JSON.stringify({ out, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
