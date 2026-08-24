// RANDOM offline: the dial chooses, and the board plays what it chose.
//
// The OFFLINE picker's last entry is not a mode — it hands the choice to the
// same dial ranked uses, on the same weighted odds. Two things have to hold, and
// only one of them is visible in the animation:
//   · the dial must actually run (it is the point of picking RANDOM), and
//   · the mode it lands on must be the mode the game then plays. A second roll
//     inside newGame would look identical on screen and be wrong every time.
//
// It also guards the chunk boundary: the dial lives in ui/ with its CSS in
// main.css precisely so OFFLINE can reach it, and this suite runs against the
// single-file build, which carries no online chunk at all.
import pkg from 'playwright';
const { chromium } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, locale: 'en-US' });
await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message));
  await page.goto(F);
  await page.waitForTimeout(400);

  /* A game's delayed first turn belongs to the generation that scheduled it.
     Start twice inside the 650ms opening beat: LIMITED's bag is a visible count
     of resolved rolls, so exactly one die must be consumed by the surviving
     game. The old unguarded timeout consumed two. */
  out.rapidRestart = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0;
    k.S.spell = ''; k.S.localMode = 6; k.S.starter = 1;
    k.newGame();
    k.S.starter = 1;
    k.newGame();
    const generation = k.S.gen, before = k.S.pool.length;
    await new Promise((resolve) => setTimeout(resolve, 1300));
    return { generation, current: k.S.gen, before, after: k.S.pool.length,
      phase: k.S.phase, die: k.S.die };
  });
  check(out.rapidRestart.current === out.rapidRestart.generation
      && out.rapidRestart.before - out.rapidRestart.after === 1
      && out.rapidRestart.phase === 'choose' && out.rapidRestart.die > 0,
    'a stale game-start timeout entered the replacement game', out.rapidRestart);

  // the picker's last chip is RANDOM, and it is not one of the seven modes
  await page.evaluate(() => window.__kb.openPractice());
  await page.waitForTimeout(150);
  const picker = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#modePick button')];
    return { count: btns.length, values: btns.map((b) => b.dataset.v) };
  });
  out.picker = picker;
  check(picker.values.at(-1) === '-1', 'RANDOM is not the last chip in the picker', picker);
  check(new Set(picker.values).size === picker.count, 'the picker has a duplicate value', picker);

  // pick it, play, and watch the dial do the choosing
  await page.evaluate(() => {
    document.querySelector('#modePick button[data-v="-1"]').click();
    window.__kb.S.spell = ''; window.__kb.S.timer = 0;
  });
  const info = await page.evaluate(() => document.querySelector('#modePickInfo').textContent);
  out.info = info;
  check(/RANDOM/.test(info), 'the picker does not name RANDOM', info);

  await page.click('#btnPlay');
  await page.waitForSelector('#ovWheel.hunting', { timeout: 4000 });

  /* The comet has to ride ON the ring, not beside it. This shipped wrong twice:
     first the mask measured from the farthest CORNER (so the trail orbited at
     35% of the width, a visibly smaller circle than the ring), then the round
     cap sat on the line while the trail hung inside it. Both are invisible to
     any assertion about classes — they are pure geometry, so measure it. */
  const geom = await page.evaluate(() => {
    const R = (s) => document.querySelector(s).getBoundingClientRect();
    const d = R('.dial'), cx = d.x + d.width / 2, cy = d.y + d.height / 2;
    const at = (s) => { const r = R(s); return Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy); };
    return {
      ring: R('.dring').width / 2,
      node: at('.dnode'),
      head: at('.dhead'),
      // offsetWidth, not the rect: .dhead rides inside a ROTATED parent, and a
      // rotated square reports an inflated bounding box
      headSize: document.querySelector('.dhead').offsetWidth,
      nodeSize: document.querySelector('.dnode').offsetWidth,
      dialSize: document.querySelector('.dial').offsetWidth,
    };
  });
  out.geom = Object.fromEntries(Object.entries(geom).map(([k, v]) => [k, +v.toFixed(1)]));
  /* The comet runs on the INNER circle (--r-in, 74% of the node ring), not out
     at the chips it is pointing at. */
  check(Math.abs(geom.head - geom.ring * 0.74) < 2,
    'the comet is not on the inner circle', out.geom);
  check(geom.head < geom.node - geom.nodeSize / 2,
    'the comet is running through the mode chips', out.geom);
  check(Math.abs(geom.node - geom.ring) < 1.5,
    'the mode nodes are not on the ring', out.geom);
  // the cap and the trail share --trail in one rule; this pins that they are
  // both still sized off the dial rather than drifting to a fixed px
  check(Math.abs(geom.headSize - geom.dialSize * 0.016) < 1,
    'the comet head is no longer sized off the dial', out.geom);
  const rect = () => {
    const r = document.querySelector('.dial').getBoundingClientRect();
    return Math.round(r.top) + ',' + Math.round(r.left);
  };
  const hunting = await page.evaluate(() => ({
    dial: (() => { const r = document.querySelector('.dial').getBoundingClientRect();
      return Math.round(r.top) + ',' + Math.round(r.left); })(),
    named: document.querySelector('#wheelName').textContent.trim(),
    found: +getComputedStyle(document.querySelector('.dfound')).opacity,
    lit: [...document.querySelectorAll('#wheelDial .dnode')]
      .filter((e) => e.classList.contains('on')).length,
  }));
  out.hunting = hunting;
  check(hunting.named === '', 'the dial named its answer while still hunting', hunting);
  check(hunting.found === 0, 'the centre showed the answer while still hunting', hunting);
  check(hunting.lit === 0, 'a node was already marked as found mid-hunt', hunting);

  await page.waitForSelector('#ovWheel.landed', { timeout: 12000 });
  const landed = await page.evaluate(() => ({
    dial: (() => { const r = document.querySelector('.dial').getBoundingClientRect();
      return Math.round(r.top) + ',' + Math.round(r.left); })(),
    named: document.querySelector('#wheelName').textContent.trim(),
    lit: [...document.querySelectorAll('#wheelDial .dnode')]
      .filter((e) => e.classList.contains('on')).length,
  }));
  out.landed = landed;
  check(landed.named.length > 0, 'the dial landed without naming anything', landed);
  check(landed.lit === 1, 'exactly one node should be lit on landing', landed);
  /* The dial must not MOVE when the result arrives. The name, the blurb and the
     countdown all appear at once, and in a centred column anything that appears
     pushes everything else — including the thing the player is watching. */
  check(landed.dial === hunting.dial,
    'the dial shifted when the result filled in', { hunting: hunting.dial, landed: landed.dial });

  // THE assertion: the game plays the mode the dial showed. Both sides name
  // themselves with the registry's stable id, so this compares ids and not
  // two pieces of prose that happen to look alike.
  const rolled = await page.evaluate(() =>
    document.querySelector('#wheelDial .dnode.on')?.dataset.mode ?? null);
  await page.waitForFunction(() => !document.querySelector('#ovWheel')?.classList.contains('on'),
    null, { timeout: 8000 });
  const played = await page.evaluate(() => ({
    // the registry turns what the board is SCORING back into an id, so this
    // compares ids rather than two bits of prose that happen to look alike
    playing: window.__kb.modeByEnum(window.__kb.S.scoring).id,
    scoring: window.__kb.S.scoring,
    phase: window.__kb.S.phase,
  }));
  out.played = { rolled, ...played, shown: landed.named.trim() };
  check(rolled != null, 'no node was marked as the one the dial found', rolled);
  check(played.playing === rolled,
    'THE BOARD IS PLAYING A DIFFERENT MODE THAN THE DIAL SHOWED', { rolled, playing: played.playing });
  check(played.phase === 'choose' || played.phase === 'roll',
    'the game did not start after the dial landed', played);

  /* ...and PLAY AGAIN must roll again. This is the bug that shipped: RANDOM was
     resolved inside the OFFLINE sheet's Play handler, so every other way of
     starting a game — Next duel, the keyboard — quietly dealt classic for the
     rest of the session. Drive a real ending and take the button. */
  await page.evaluate(() => {
    const k = window.__kb;
    k.S.boards[1] = [[6, 6, 6], [5, 5, 5], [4, 4]];
    k.S.boards[0] = [[1], [2], [3]];
    k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose'; k.S.die = 2;
    k.applySides(); k.renderAll(false); k.setStageDie(2, 1);
  });
  await page.evaluate(() => window.__kb.place(1, 2));
  await page.waitForSelector('#ovEnd.on', { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.click('#btnAgain');
  let again = null;
  try {
    await page.waitForSelector('#ovWheel.hunting', { timeout: 5000 });
    again = await page.evaluate(() => ({
      rolled: document.querySelector('#wheelDial .dnode.on')?.dataset.mode ?? null,
      naming: document.querySelector('#wheelName').textContent.trim(),
    }));
  } catch { /* reported below */ }
  out.again = again;
  check(again !== null, 'PLAY AGAIN skipped the dial — RANDOM only worked on the first game', again);
} catch (e) {
  problems.push('THREW :: ' + e.message);
} finally { await browser.close(); }

console.log(JSON.stringify({ out, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
