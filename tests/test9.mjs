import pkg from 'playwright';
const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones.html';
const browser = await chromium.launch();
const problems = [], errs = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

// ===== 1. the reported bug: preview pills must not touch the turn text =====
async function overlapCheck(w, h, label) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(label + ': ' + e.message));
  await p.goto(F); await p.waitForTimeout(400);
  await p.tap('#btnTut'); await p.waitForTimeout(400);   // pills are tutorial-only now
  await p.tap('#coach'); await p.waitForTimeout(300);    // dismiss the welcome step
  for (let i = 0; i < 60; i++) {                         // reach the first choose
    const s = await p.evaluate(() => ({ ph: window.__kb.S.phase }));
    if (s.ph === 'choose') break;
    await p.waitForTimeout(150);
  }
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const rect = e => e.getBoundingClientRect();
    const hit = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
    const status = rect(document.getElementById('status'));
    const timer = rect(document.getElementById('timerWrap'));
    const pills = [...document.querySelectorAll('.chip .dl.show')].map(rect);
    const dice = [...document.querySelectorAll('.board .die')].map(rect);
    return {
      pills: pills.length,
      statusText: document.getElementById('status').textContent,
      pillHitsStatus: pills.some(q => hit(q, status)),
      pillHitsTimer: pills.some(q => hit(q, timer)),
      pillHitsDie: pills.some(q => dice.some(d => hit(q, d))),
      pillHitsCoach: !document.getElementById('coach').hidden &&
        pills.some(q => hit(q, rect(document.getElementById('coach')))),
      offBottom: Math.max(0, Math.round(rect(document.getElementById('sideBot')).bottom - window.innerHeight)),
      scrollH: document.documentElement.scrollHeight, winH: window.innerHeight,
      cell: getComputedStyle(document.documentElement).getPropertyValue('--cell').trim(),
    };
  });
  await p.screenshot({ path: `./v4-${label}.png` });
  await ctx.close();
  return r;
}
out.p390 = await overlapCheck(390, 844, 'iphone13');
out.p320 = await overlapCheck(320, 568, 'small');
out.p430 = await overlapCheck(430, 932, 'promax');
for (const [k, r] of Object.entries(out)) {
  check(r.pills > 0, k + ': no preview pills shown', r);
  check(!r.pillHitsStatus, k + ': preview pill still overlaps the turn text', r);
  check(!r.pillHitsTimer, k + ': preview pill overlaps the timer', r);
  check(!r.pillHitsDie, k + ': preview pill overlaps a die', r);
  check(!r.pillHitsCoach, k + ': preview pill overlaps the coach banner', r);
  check(r.scrollH <= r.winH + 1, k + ': layout scrolls', r);
}

// ===== 2. the turn clock =====
const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', e => errs.push('TIMER: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await p.goto(F); await p.waitForTimeout(400);
out.timerCardHiddenInCpu = await p.evaluate(() => document.getElementById('timerCard').hidden);
await p.tap('#modeSeg button[data-m="duo"]'); await p.waitForTimeout(250);
out.timerCardShownInDuo = await p.evaluate(() => !document.getElementById('timerCard').hidden);
check(out.timerCardHiddenInCpu && out.timerCardShownInDuo, 'timer setting visibility wrong', out);

await p.tap('#btnPlay'); await p.waitForTimeout(1200);
async function toMenu() {
  const pass = await p.evaluate(() => document.getElementById('ovPass').classList.contains('on'));
  if (pass) { await p.tap('#passQuit'); } else { await p.tap('#btnMenu'); }
  await p.waitForTimeout(500);
}
async function reachChoose() {
  for (let i = 0; i < 80; i++) {
    const s = await p.evaluate(() => ({ ph: window.__kb.S.phase, pass: document.getElementById('ovPass').classList.contains('on') }));
    if (s.pass) { await p.tap('#ovPass'); await p.waitForTimeout(400); continue; }
    if (s.ph === 'choose') return true;
    await p.waitForTimeout(150);
  }
  return false;
}
await reachChoose();
const t0 = await p.evaluate(() => ({
  visible: document.getElementById('timerWrap').classList.contains('on'),
  width: document.getElementById('timerBar').style.width,
  dice: window.__kb.S.boards[0].flat().length + window.__kb.S.boards[1].flat().length,
}));
check(t0.visible, 'timer not running on a duo turn', t0);
await p.waitForTimeout(3000);
const t1 = await p.evaluate(() => ({ width: document.getElementById('timerBar').style.width }));
check(parseFloat(t1.width) < 90 && parseFloat(t1.width) > 40, 'timer bar not draining as expected', { t0, t1 });
// let it run out: a die must be placed without any input
await p.waitForTimeout(9000);
const t2 = await p.evaluate(() => ({
  dice: window.__kb.S.boards[0].flat().length + window.__kb.S.boards[1].flat().length,
  phase: window.__kb.S.phase,
  dom: document.querySelectorAll('.board .die').length,
}));
check(t2.dice === t0.dice + 1, 'timer expiry did not auto-place exactly one die', { t0, t2 });
check(t2.dom === t2.dice, 'auto-placed die not rendered', t2);
out.timer = { t0, t1, t2 };

// timer must NOT run in single player
await toMenu();
await p.tap('#modeSeg button[data-m="cpu"]'); await p.waitForTimeout(250);
await p.tap('#btnPlay'); await p.waitForTimeout(2400);
for (let i = 0; i < 40; i++) {
  const s = await p.evaluate(() => ({ ph: window.__kb.S.phase, t: window.__kb.S.turn }));
  if (s.ph === 'choose' && s.t === 1) break;
  await p.waitForTimeout(150);
}
out.cpuTimer = await p.evaluate(() => document.getElementById('timerWrap').classList.contains('on'));
check(!out.cpuTimer, 'timer runs in single player', out);

// off setting must disable it
await toMenu();
await p.tap('#modeSeg button[data-m="duo"]'); await p.waitForTimeout(200);
await p.tap('#timerSeg button[data-t="0"]'); await p.waitForTimeout(200);
await p.tap('#btnPlay'); await p.waitForTimeout(1200);
await reachChoose();
await p.waitForTimeout(500);
out.timerOff = await p.evaluate(() => ({
  running: document.getElementById('timerWrap').classList.contains('on'),
  setting: window.__kb.S.timer,
}));
check(!out.timerOff.running && out.timerOff.setting === 0, 'timer off setting ignored', out.timerOff);
// and with it off, nothing should auto-place
const before = await p.evaluate(() => window.__kb.S.boards[0].flat().length + window.__kb.S.boards[1].flat().length);
await p.waitForTimeout(12000);
const after = await p.evaluate(() => window.__kb.S.boards[0].flat().length + window.__kb.S.boards[1].flat().length);
check(after === before, 'auto-placed despite timer being off', { before, after });

// setting survives a reload
await p.reload(); await p.waitForTimeout(700);
out.timerPersist = await p.evaluate(() => ({ setting: window.__kb.S.timer,
  onBtn: document.querySelector('#timerSeg button.on').dataset.t }));
check(out.timerPersist.setting === 0 && out.timerPersist.onBtn === '0', 'timer setting not persisted', out.timerPersist);

// timer must not tick during the hand-off card
await p.evaluate(() => { window.__kb.S.timer = 10; });
await p.tap('#timerSeg button[data-t="10"]'); await p.waitForTimeout(200);
await p.tap('#btnPlay'); await p.waitForTimeout(1200);
await reachChoose();
const legal = await p.evaluate(() => { const w = window.__kb.S.turn; return window.__kb.S.boards[w].map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0); });
await p.tap(`#botBoard .col[data-col="${legal[0]}"]`);
await p.waitForTimeout(2600);
out.duringPass = await p.evaluate(() => ({
  pass: document.getElementById('ovPass').classList.contains('on'),
  timerRunning: document.getElementById('timerWrap').classList.contains('on'),
}));
check(!(out.duringPass.pass && out.duringPass.timerRunning), 'clock runs while the phone is being passed', out.duringPass);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();
