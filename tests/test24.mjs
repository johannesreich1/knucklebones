// THE LIMITED BAG: the gutter is a LENGTH, and the draw comes off the TOP.
//
// The pile has always been a coarse gauge — four shells for twenty-four dice,
// so it rounds to a quarter and the last six draws all look identical to it.
// Design LI10 puts the exact supply in the lane at the pile's left edge as a
// plain column, and the two claims that make it worth having are both
// measurable and neither is visible in the DOM:
//
//   1. IT IS LINEAR IN THE COUNT. The column's rendered height must be n/24 of
//      the pile at every depth. A gauge that is merely "shorter when emptier"
//      is decoration; this one is read against the track behind it.
//   2. NO HUE CAN TOUCH IT. Seven duel colours are pickable and colour blind
//      mode repoints the pair, so a gauge that inherited --p1/--p2 would mean
//      something different on two phones. Repointing the pair here must not
//      move a single channel of it.
//
// And the draw: every draw takes the shell the player is looking at — the one
// on TOP — not only the one in six that costs the pile a layer. The mirror of
// that is what must NOT happen: a reconnect, a fresh game or FA4 rewinding its
// own bag all repaint the same element with a jump, and none of them may throw
// a die off the pile.
import pkg from 'playwright';
const { chromium } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const BAG = 24;
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true });
  await ctx.addInitScript(() => {
    const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}');
    cur.played = true; localStorage.setItem(k, JSON.stringify(cur));   // no first-run offer over the board
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('CONSOLE ' + m.text()); });
  await page.goto(F);
  await page.waitForTimeout(400);

  /* Two players, facing, no clock: nobody replies while an assertion samples a
     300ms animation, and no timer auto-places under it. */
  await page.evaluate(() => {
    const k = window.__kb;
    k.S.spell = ''; k.S.timer = 0; k.S.localMode = 6; k.S.mode = 'duo'; k.S.seat = 'face';
    k.S.starter = 1;
    k.newGame();
  });
  const waitChoose = async () => {
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate(() => window.__kb.S.phase === 'choose')) return true;
      await page.waitForTimeout(60);
    }
    return false;
  };
  check(await waitChoose(), 'the LIMITED game never reached a choice');

  /* what the PLAYER can see of the bag: rendered boxes and painted colours,
     never the classes that produced them */
  const shape = () => page.evaluate(() => {
    const bag = document.getElementById('bagStack');
    const pile = bag.querySelector('.pile');
    const take = pile.querySelector('.take');
    /* CENTRES, not corners: the lift shrinks as it rises, so an edge moves
       0.55px on its own and says nothing about where the die is. */
    const box = (el) => { const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        cx: +(r.x + r.width / 2).toFixed(1), cy: +(r.y + r.height / 2).toFixed(1) }; };
    const live = getComputedStyle(pile, '::after'), track = getComputedStyle(pile, '::before');
    return {
      count: Number(document.getElementById('bagNum').textContent),
      pile: box(pile),
      liveH: +parseFloat(live.height).toFixed(2), liveW: +parseFloat(live.width).toFixed(2),
      liveLeft: live.left, liveBg: live.backgroundColor, trackBg: track.backgroundColor,
      trackH: +parseFloat(track.height).toFixed(2),
      take: { ...box(take), op: +getComputedStyle(take).opacity },
      /* the shells the player can actually see, top last */
      shells: [...pile.querySelectorAll('.die:not(.take)')]
        .map((d) => ({ ...box(d), op: +(+getComputedStyle(d).opacity).toFixed(2) }))
        .filter((s) => s.op > 0.5),
    };
  });

  /* Draw one die by playing a column, sampling the beat while it runs. The
     COUNT is the signal a draw happened, never a timeout — the two seats take
     turns, so which board is live moves, and how long a tap takes to resolve
     is the roll's business and not this suite's. */
  const liveBoard = () => page.evaluate(() =>
    (window.__kb.S.bottom === window.__kb.S.turn ? '#botBoard' : '#topBoard'));
  const drawOnce = async (seed) => {
    if (seed) await page.evaluate((n) => { window.__kb.S.pool.length = n; }, seed);
    const before = await shape();
    const target = await page.$(`${await liveBoard()} .col.legal`);
    if (!target) return null;
    await target.tap();
    const frames = [];
    for (let i = 0; i < 90; i++) {
      const now = await shape();
      if (now.count !== before.count) frames.push(now);
      if (frames.length > 10) break;
      await page.waitForTimeout(25);
    }
    /* the lift itself: the highest the die got, and whether it was still solid
       on the way — one frame at t=0 proves nothing, the travel is the claim */
    const lift = frames.length ? frames.reduce((a, f) => (f.take.cy < a.take.cy ? f : a)) : null;
    const solid = frames.some((f) => f.take.op > 0.9 && f.take.cy < before.shells.at(-1).cy - 2);
    await waitChoose();
    await page.waitForTimeout(420);                       // the .35s drain settles
    return { before, lift, solid, after: await shape() };
  };

  /* ---- 1. the draw comes off the TOP of the stack ---- */
  const drawn = await drawOnce(0);
  const top = drawn?.before.shells.at(-1);
  out.draw = drawn && { count: [drawn.before.count, drawn.after.count], top,
    lift: drawn.lift?.take, solid: drawn.solid,
    rest: drawn.after.take, restTop: drawn.after.shells.at(-1) };
  check(drawn?.after.count === drawn?.before.count - 1, 'the tap did not draw a die', out.draw);
  check(!!drawn?.lift && Math.abs(drawn.lift.take.cx - top.cx) < 0.5
    && drawn.lift.take.cy < top.cy - 4 && drawn.lift.take.cy > top.cy - 16,
    'the drawn die did not come off the shell that was on top of the stack', out.draw);
  check(drawn?.solid === true,
    'the drawn die faded before it had travelled — a shell dissolving in place, not one taken out',
    out.draw);
  check(drawn?.after.take.op === 0
    && Math.abs(drawn.after.take.cy - drawn.after.shells.at(-1).cy) < 0.5,
    'the lifted shell did not come to rest, invisible, on the new top layer', out.draw);

  /* ---- 2. a re-sync repaints, it does not draw ---- */
  await page.evaluate(() => {
    window.__bagSeen = [];
    window.__bagWatch = setInterval(() => window.__bagSeen.push(
      +getComputedStyle(document.querySelector('#bagStack .take')).opacity), 16);
  });
  /* the shape of a reconnect: the count arrives several dice on. Same path as
     an ordinary draw — only the size of the step is different. */
  const jump = await drawOnce(12);
  const resync = await page.evaluate(() => {
    clearInterval(window.__bagWatch);
    return { peak: Math.max(0, ...window.__bagSeen), samples: window.__bagSeen.length };
  });
  out.resync = { from: jump?.before.count, to: jump?.after.count, ...resync };
  check(jump?.before.count > 12 && jump?.after.count === 11,
    'the re-sync step did not land on the seeded count', out.resync);
  check(resync.samples > 20 && resync.peak === 0,
    'a bag that jumped by more than one still threw a die off the pile', out.resync);

  /* ---- 3. no duel colour can reach it ---- */
  const painted = await shape();
  const repainted = await page.evaluate(() => {
    const root = document.getElementById('kbroot');
    root.style.setProperty('--p1', '#ff0000'); root.style.setProperty('--p1-rgb', '255,0,0');
    root.style.setProperty('--p2', '#00ff00'); root.style.setProperty('--p2-rgb', '0,255,0');
    const pile = root.querySelector('#bagStack .pile');
    const shot = { liveBg: getComputedStyle(pile, '::after').backgroundColor,
      trackBg: getComputedStyle(pile, '::before').backgroundColor };
    root.style.removeProperty('--p1'); root.style.removeProperty('--p1-rgb');
    root.style.removeProperty('--p2'); root.style.removeProperty('--p2-rgb');
    return shot;
  });
  out.hue = { before: { liveBg: painted.liveBg, trackBg: painted.trackBg }, repainted };
  check(repainted.liveBg === painted.liveBg && repainted.trackBg === painted.trackBg,
    'the gutter followed the duel pair — it must be achromatic', out.hue);

  /* ---- 4. the column is the count, as a length ---- */
  const ladder = [];
  for (const target of [8, 6, 3, 1, 0]) {
    const step = await drawOnce(target + 1);
    if (!step) { problems.push('no legal column left to reach ' + target); break; }
    const now = step.after;
    ladder.push({ n: now.count, liveH: now.liveH, want: +(now.pile.h * now.count / BAG).toFixed(2),
      liveW: now.liveW, liveLeft: now.liveLeft, trackH: now.trackH, pileH: now.pile.h,
      shells: now.shells.length, liftY: step.lift?.take.cy ?? null });
  }
  out.ladder = ladder;
  check(ladder.length === 5 && ladder.every((r) => Math.abs(r.liveH - r.want) <= 0.6),
    'the gutter column is not the remaining fraction of the pile', ladder);
  check(ladder.every((r) => r.liveW === 2 && r.liveLeft === '0px' && r.trackH === r.pileH),
    'the gutter is not a 2px column in the lane at the pile edge, full-height track behind it', ladder);
  /* the whole point: from six down the shells have stopped saying anything
     different, and the column is the only thing still moving */
  const tail = ladder.filter((r) => r.n <= 6 && r.n > 0);
  check(tail.length === 3 && tail.every((r) => r.shells === 1)
    && tail[0].liveH > tail[1].liveH && tail[1].liveH > tail[2].liveH,
    'the last draws must look alike to the pile and different to the gutter', tail);
  check(ladder.at(-1)?.n === 0 && ladder.at(-1)?.liveH === 0 && ladder.at(-1)?.shells === 0,
    'an empty bag must show an empty pile and no column at all', ladder.at(-1));

  /* ---- 5. the bag stands on column one, the way the rune stands on three ----
     Both live in the stage row and both are absolutely positioned, so nothing
     in the layout forces them to agree with the board — only the arithmetic
     does, and the two expressions differ by a sign. Measure the columns. */
  const stand = async (pg) => pg.evaluate(() => {
    const mid = (el) => { const r = el.getBoundingClientRect();
      return { cx: +(r.x + r.width / 2).toFixed(1), cy: +(r.y + r.height / 2).toFixed(1),
        top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1) }; };
    const bag = document.getElementById('bagStack');
    const rune = document.getElementById('spellBar');
    const status = document.querySelector('.status');
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return {
      land: document.getElementById('kbroot').classList.contains('land'),
      cols: [...document.querySelectorAll('#botBoard .col')].map((c) => mid(c).cx),
      bag: mid(bag), rune: rune && !rune.hidden ? mid(rune) : null, stage: mid(document.getElementById('dieStage')),
      onStatus: hit(bag.getBoundingClientRect(), status.getBoundingClientRect()),
    };
  });
  const upright = await stand(page);
  out.stand = { portrait: upright };
  check(Math.abs(upright.bag.cx - upright.cols[0]) < 0.5,
    'the bag is not centred on the first board column', upright);
  check(Math.abs(upright.bag.cy - upright.stage.cy) < 0.5,
    'the bag is not level with the die in play', upright);

  /* landscape: the lane is only as wide as the die, so the pair stacks instead
     — the rune above, the bag below, on the same gap, and clear of a status
     line that reserves two rewording lines it does not always fill. */
  const wide = await ctx.newPage();
  wide.on('pageerror', (e) => problems.push('PAGEERROR(land) ' + e.message));
  await wide.setViewportSize({ width: 932, height: 430 });
  await wide.goto(F);
  await wide.waitForTimeout(400);
  await wide.evaluate(() => {
    const k = window.__kb;
    k.S.spell = 'ward'; k.S.timer = 0; k.S.localMode = 6; k.S.mode = 'duo'; k.S.seat = 'face';
    k.S.starter = 1;
    k.newGame();
  });
  for (let i = 0; i < 80; i++) {
    if (await wide.evaluate(() => window.__kb.S.phase === 'choose')) break;
    await wide.waitForTimeout(60);
  }
  const flat = await stand(wide);
  out.stand.landscape = flat;
  check(flat.land === true, 'the landscape probe never entered the landscape layout', flat);
  check(!!flat.rune && flat.rune.bottom < flat.stage.top && flat.bag.top > flat.stage.bottom,
    'landscape must stack the pair: rune above the die, bag below it', flat);
  check(!!flat.rune && Math.abs((flat.stage.top - flat.rune.bottom) - (flat.bag.top - flat.stage.bottom)) < 1.5,
    'the bag and the rune card do not keep the same gap from the die', flat);
  check(flat.onStatus === false,
    'the landscape bag is painted over the status line instead of moving it down', flat);
  await wide.close();

  out.final = await shape();
} finally {
  await browser.close();
}
console.log(JSON.stringify({ out, problems }, null, 2));
