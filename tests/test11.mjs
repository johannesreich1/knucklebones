import pkg from 'playwright';
const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], errs = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(F); await page.waitForTimeout(500);

// start collecting every score popup as it appears
await page.evaluate(() => {
  window.__pops = [];
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('pts')) {
        window.__pops.push({ text: n.textContent, board: n.closest('#topBoard') ? 'top' : 'bot' });
      }
    }
  }).observe(document.getElementById('tableEl'), { childList: true, subtree: true });
});

// ===== hud shape: no wordmark in-game, exactly settings + menu =====
out.hud = await page.evaluate(() => ({
  brand: !!document.querySelector('.hud .brand'),
  icons: [...document.querySelectorAll('.hud .ico')].map(b => b.id),
  titleStillNamed: document.querySelector('#ovStart h1').textContent === 'KNUCKLEBONES',
}));
check(!out.hud.brand, 'wordmark still in the in-game hud', out.hud);
check(out.hud.icons.join(',') === 'btnSettings', 'hud must hold ONLY settings', out.hud);
check(out.hud.titleStillNamed, 'title screen lost the name', out.hud);

// ===== popups, deterministically via the tutorial (home strip button) =====
// the tutorial now lives one level in, behind HOW TO PLAY
await page.tap('#btnLearn'); await page.waitForTimeout(320);
await page.tap('#btnLearnTut'); await page.waitForTimeout(500);
await page.tap('#coach');
async function waitChoose(maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await page.evaluate(() => window.__kb.S.phase);
    if (s === 'choose' || s === 'over') return s;
    await page.waitForTimeout(100);
  }
  return 'timeout';
}
await waitChoose();
await page.tap('#botBoard .col[data-col="0"]');   // first 4 → +4
await waitChoose();
await page.tap('#botBoard .col[data-col="0"]');   // second 4 → +12 (16-4), gold
await waitChoose();
await page.tap('#botBoard .col[data-col="1"]');   // 5 smashes CPU's 5 → +5 and −5
await page.waitForTimeout(1500);
out.pops = await page.evaluate(() => window.__pops);
const texts = out.pops.map(p => p.text + '@' + p.board);
check(texts.includes('+4@bot'), 'no +4 popup on first placement', texts);
check(texts.includes('+12@bot'), 'multiplier popup not +12', texts);
check(texts.includes('+5@bot'), 'no +5 popup on destruction turn', texts);
check(texts.includes('−5@top'), 'no −5 popup on the destroyed column', texts);
// CPU placements pop too
check(out.pops.some(p => p.board === 'top' && p.text.startsWith('+')), 'CPU placements never pop', texts);
// popups clean themselves up — wait until the game is idle so nothing is mid-flight
await waitChoose();
await page.waitForTimeout(1300);
out.leftover = await page.evaluate(() => document.querySelectorAll('.pts').length);
check(out.leftover === 0, 'popups leak into the DOM', out.leftover);

// quit tutorial (via Settings — the sheet holds the quit button now),
// popups must also fire in a NORMAL game (they are not tutorial-only)
await page.tap('#btnSettings'); await page.waitForTimeout(300);
await page.tap('#btnMenu'); await page.waitForTimeout(400);
await page.evaluate(() => { window.__pops = []; });
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await page.tap('#btnPlay'); await page.waitForTimeout(1500);
if (await waitChoose() === 'choose') {
  const lg = await page.evaluate(() => window.__kb.S.boards[1].map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0));
  await page.tap(`#botBoard .col[data-col="${lg[0]}"]`);
  await page.waitForTimeout(1000);
}
out.normalPops = await page.evaluate(() => window.__pops.filter(p => p.board === 'bot').length);
check(out.normalPops >= 1, 'no score popup in normal play', out.normalPops);
// while strategy previews stay off
out.normalPills = await page.evaluate(() => document.querySelectorAll('.chip .dl.show').length);
check(out.normalPills === 0, 'previews leaked back into normal play', out.normalPills);

// ===== settings panel =====
await page.tap('#btnSettings'); await page.waitForTimeout(400);
out.settingsOpen = await page.evaluate(() => ({
  on: document.getElementById('ovSettings').classList.contains('on'),
  sndOn: document.querySelector('#sndSeg button.on')?.dataset.s,
  faceOn: document.querySelector('#faceSeg button.on')?.dataset.f,
}));
check(out.settingsOpen.on && out.settingsOpen.sndOn === '1' && out.settingsOpen.faceOn === 'pips',
      'settings did not open with current values', out.settingsOpen);

await page.tap('#sndSeg button[data-s="0"]'); await page.waitForTimeout(200);
await page.tap('#faceSeg button[data-f="nums"]'); await page.waitForTimeout(200);
// help routes through settings
await page.tap('#btnHow2'); await page.waitForTimeout(400);
out.help = await page.evaluate(() => ({
  rules: document.getElementById('ovRules').classList.contains('on'),
  settings: document.getElementById('ovSettings').classList.contains('on'),
}));
check(out.help.rules && !out.help.settings, 'help did not open from settings', out.help);
await page.tap('#btnCloseRules'); await page.waitForTimeout(300);

// choices persist across reload
await page.reload(); await page.waitForTimeout(600);
out.persist = await page.evaluate(() => ({
  sound: window.__kb.S.sound, numerals: window.__kb.S.numerals,
  cls: document.documentElement.classList.contains('numerals'),
}));
check(out.persist.sound === false && out.persist.numerals === true && out.persist.cls,
      'settings did not persist', out.persist);

// ===== settings is a sheet: ✕ header closes it, reset-record is retired =====
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await page.tap('#btnPlay'); await page.waitForTimeout(1200);   // hud only reachable in-game
await page.tap('#btnSettings'); await page.waitForTimeout(300);
out.sheet = await page.evaluate(() => ({
  reset: !!document.getElementById('btnResetStats'),
  done: [...document.querySelectorAll('#ovSettings .btn')].some(b => /done/i.test(b.textContent)),
  x: document.querySelector('#ovSettings .shead #btnCloseSettings')?.textContent ?? '',
  title: document.querySelector('#ovSettings .shead .ttl')?.textContent ?? '',
  quitInSheet: !!document.querySelector('#ovSettings #btnMenu'),
}));
check(out.sheet.quitInSheet, 'Quit game not inside the Settings sheet', out.sheet);
check(!out.sheet.reset, 'Reset record still in Settings', out.sheet);
check(!out.sheet.done, 'Settings still has a bottom Done button', out.sheet);
check(out.sheet.x === '✕' && out.sheet.title === 'SETTINGS', 'Settings sheet header wrong', out.sheet);
await page.tap('#btnCloseSettings'); await page.waitForTimeout(300);
out.sheetClosed = await page.evaluate(() => !document.getElementById('ovSettings').classList.contains('on'));
check(out.sheetClosed, 'Settings ✕ did not close the sheet', out.sheetClosed);

// ===== the HUD badge explains its mode — OFFLINE too =====
// Reported bug: tapping the badge opened the modes library online and did
// nothing offline, because the listener lived inside the online chunk. Both
// flows now paint the badge through render.paintBadge and boot binds the tap
// once against data-mode, so the affordance cannot go missing on one side.
await page.tap('#btnSettings'); await page.waitForTimeout(250);
await page.tap('#btnMenu'); await page.waitForTimeout(400);
await page.evaluate(() => { window.__kb.S.localMode = 4; window.__kb.openPractice(); }); // SINGLE STRIKE
await page.tap('#btnPlay'); await page.waitForTimeout(1200);
out.badge = await page.evaluate(() => {
  const r = document.getElementById('rec'), i = r.querySelector('.mi');
  return {
    mode: r.dataset.mode, tap: r.classList.contains('tapmode'),
    named: /SINGLE STRIKE/.test(r.textContent),
    infoStyled: !!i && getComputedStyle(i).marginLeft !== '0px',   // the ⓘ rule must reach offline
  };
});
check(out.badge.mode === 'singlestrike', 'offline badge does not name its mode to the tap handler', out.badge);
check(out.badge.tap && out.badge.named, 'offline badge is not a tappable mode label', out.badge);
check(out.badge.infoStyled, 'the ⓘ affordance is unstyled offline (rule stuck in the online chunk)', out.badge);
await page.tap('#rec'); await page.waitForTimeout(500);
out.badgeOpens = await page.evaluate(() => ({
  on: document.getElementById('ovModes')?.classList.contains('on') ?? false,
  now: document.querySelector('#ovModes .modecard.now')?.dataset.mode ?? '',
}));
check(out.badgeOpens.on, 'tapping the offline badge opens nothing', out.badgeOpens);
check(out.badgeOpens.now === 'singlestrike', 'modes library did not highlight the mode in play', out.badgeOpens);
// the library serves both rosters now, so its close button is semantic
await page.tap('[data-close="ovModes"]'); await page.waitForTimeout(300);
// a classic offline game keeps the record and stays inert — nothing to explain
await page.tap('#btnSettings'); await page.waitForTimeout(250);
await page.tap('#btnMenu'); await page.waitForTimeout(400);
await page.evaluate(() => { window.__kb.S.localMode = 0; window.__kb.openPractice(); });
await page.tap('#btnPlay'); await page.waitForTimeout(1200);
out.badgeClassic = await page.evaluate(() => {
  const r = document.getElementById('rec');
  return { mode: r.dataset.mode ?? null, tap: r.classList.contains('tapmode'), text: r.textContent.trim() };
});
check(out.badgeClassic.mode === null && !out.badgeClassic.tap, 'classic badge should not pretend to be tappable', out.badgeClassic);
check(/^W /.test(out.badgeClassic.text), 'classic badge lost the win/loss record', out.badgeClassic);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();
