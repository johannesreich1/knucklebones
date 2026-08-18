// SPELLS: the optional powers layer, driven the way a player drives it.
//
// The rules of the effect are pinned in tests/spells.test.ts (pure). This suite
// guards the RUNTIME: that the rune only appears where it should, that both
// gestures (tap-to-arm, drag-and-drop) reach the same one gate, that the board
// a player can SEE matches the state after a swap (the test13 lesson: assert
// computed pixels, never merely the DOM), that a charge is spent exactly once,
// and — the promise the feature is built on — that switching spells OFF leaves
// the table indistinguishable from the game before spells existed.
import pkg from 'playwright';
const { chromium, devices } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';   // the single-file build
const browser = await chromium.launch();
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => problems.push('PAGEERROR: ' + e.message));
  await page.goto(F); await page.waitForTimeout(400);

  /* ---------- 0. the picker: NONE by default, one slice per spell ----------
     Same component as the game-mode row, and the slice wears the SAME rune the
     game draws — so what you pick and what lands on the rail cannot disagree. */
  await page.tap('#btnVsCpu'); await page.waitForTimeout(300);
  out.picker = await page.evaluate(() => {
    const strip = document.getElementById('spellPick');
    const bs = [...strip.querySelectorAll('button')];
    return {
      slices: bs.length, on: bs.findIndex(b => b.classList.contains('on')),
      values: bs.map(b => b.dataset.v),
      icons: bs.map(b => !!b.querySelector('svg')),
      info: document.getElementById('spellPickInfo').textContent,
      pick: window.__kb.S.spell,
      sameComponent: strip.className === document.getElementById('modePick').className,
    };
  });
  check(out.picker.pick === '' && out.picker.on === 0, 'the spell picker must default to NONE', out.picker);
  check(out.picker.slices >= 2 && out.picker.values[0] === '', 'NONE is the first slice', out.picker);
  check(out.picker.icons.every(Boolean), 'every slice carries its icon', out.picker);
  check(/^NONE — /.test(out.picker.info), 'NONE needs its explanation', out.picker.info);
  check(out.picker.sameComponent, 'the spell row must reuse the game-mode row', out.picker);
  // picking the spell names it, with its own blurb
  await page.tap('#spellPick button[data-v="swap"]'); await page.waitForTimeout(200);
  out.picked = await page.evaluate(() => ({
    pick: window.__kb.S.spell,
    on: document.querySelector('#spellPick button.on')?.dataset.v,
    info: document.getElementById('spellPickInfo').textContent,
  }));
  check(out.picked.pick === 'swap' && out.picked.on === 'swap', 'picking a spell did not take', out.picked);
  check(/^COLUMN SWAP — /.test(out.picked.info), 'a picked spell needs its name and line', out.picked.info);
  await page.evaluate(() => window.__kb.goHome());

  /* start a two-player face-to-face game: no CPU reply and no hand-off card
     racing the assertions, and no turn clock auto-placing under them */
  const newGame = (opts = {}) => page.evaluate((o) => {
    const k = window.__kb;
    k.S.spell = o.spell === undefined ? 'swap' : o.spell;   // the OFFLINE screen's pick
    k.S.timer = 0; k.S.localMode = 0; k.S.mode = 'duo'; k.S.seat = 'face';
    k.newGame(o.tutorial ? { tutorial: true } : undefined);
  }, opts);
  const waitChoose = async () => {
    for (let i = 0; i < 60; i++) {
      if (await page.evaluate(() => window.__kb.S.phase === 'choose')) return true;
      await page.waitForTimeout(120);
    }
    return false;
  };
  /* put a known board on the table, mid-turn, with the caster to move */
  const table = (mine, theirs, die = 4) => page.evaluate(([m, t, d]) => {
    const k = window.__kb;
    k.S.boards[1] = m; k.S.boards[0] = t;
    k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose'; k.S.die = d;
    k.applySides(); k.renderAll(false); k.setStageDie(d, 1); k.showHints(); k.spells.render();
  }, [mine, theirs, die]);
  /* what a PLAYER can see, plus the state behind it */
  const look = () => page.evaluate(() => {
    const dice = [...document.querySelectorAll('#topBoard .die,#botBoard .die')];
    const rune = document.querySelector('.rune');
    return {
      mine: JSON.stringify(window.__kb.S.boards[1]), theirs: JSON.stringify(window.__kb.S.boards[0]),
      charges: JSON.stringify(window.__kb.S.spellCharges),
      armed: window.__kb.S.spellArmed, casting: document.documentElement.classList.contains('casting'),
      phase: window.__kb.S.phase, busy: window.__kb.S.busy, die: window.__kb.S.die,
      barHidden: document.getElementById('spellBar').hidden,
      runeShown: !!rune && !!rune.offsetParent,
      runeClass: rune ? rune.className : null,
      present: dice.length,
      visible: dice.filter(d => getComputedStyle(d).visibility === 'visible' && +getComputedStyle(d).opacity > 0.05).length,
      strays: document.querySelectorAll('body > .die, body > .runeghost').length,
      status: document.getElementById('status').textContent,
      end: document.getElementById('ovEnd').classList.contains('on'),
    };
  });
  const tapCol = (c) => page.tap(`#botBoard .col[data-col="${c}"]`);

  /* ---------- 1. the rune is dealt to a normal offline game ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose');
  await table([[6, 6], [3], []], [[2], [5], []]);
  out.dealt = await look();
  check(out.dealt.runeShown && !out.dealt.barHidden, 'no rune in an offline game', out.dealt);
  check(out.dealt.charges === '[{"swap":1},{"swap":1}]', 'both seats hold one cast', out.dealt.charges);

  /* ---------- 2. tap to arm ---------- */
  await page.tap('.rune'); await page.waitForTimeout(120);
  out.armed = await look();
  check(out.armed.armed === 'swap', 'tapping the rune did not arm it', out.armed);
  check(out.armed.casting, 'the board never entered casting', out.armed);
  check(/column/i.test(out.armed.status), 'no instruction while aiming', out.armed.status);
  // aiming must not place: a tap on the board casts instead of dropping the die
  out.rings = await page.evaluate(() => {
    const c = document.querySelector('#botBoard .col');
    return { spellRing: getComputedStyle(c, '::after').borderColor,
             legalHidden: getComputedStyle(document.querySelector('#botBoard .col.legal'), '::after').display };
  });
  check(out.rings.legalHidden === 'none', 'placement hints still up while aiming', out.rings);

  /* ---------- 3. tap a column: ONE gate, one charge ---------- */
  await tapCol(0); await page.waitForTimeout(1400);
  out.cast = await look();
  check(out.cast.mine === '[[2],[3],[]]', 'caster column did not receive theirs', out.cast);
  check(out.cast.theirs === '[[6,6],[5],[]]', 'enemy column did not receive ours', out.cast);
  check(out.cast.present === out.cast.visible, 'A SWAPPED DIE IS INVISIBLE', out.cast);
  check(out.cast.strays === 0, 'a flying copy was left on the page', out.cast);
  check(out.cast.charges === '[{"swap":1},{"swap":0}]', 'wrong seat was charged', out.cast.charges);
  check(!out.cast.armed && !out.cast.casting, 'still aiming after the cast', out.cast);
  check(out.cast.phase === 'choose' && !out.cast.busy, 'the turn was not handed back', out.cast);
  check(out.cast.die === 4, 'the roll in hand was lost to the cast', out.cast.die);
  check(out.cast.runeClass.includes('spent'), 'a spent rune must say so', out.cast.runeClass);

  /* ---------- 4. spent: no second cast, and the die still places ---------- */
  out.spent = await page.evaluate(async () => {
    const k = window.__kb;
    const b = document.querySelector('.rune');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }));
    return { disabled: b.disabled, armed: k.S.spellArmed, again: await k.spells.cast('swap', 0),
             mine: JSON.stringify(k.S.boards[1]) };
  });
  check(out.spent.disabled, 'a spent rune is still a live button', out.spent);
  check(out.spent.armed === null, 'a spent rune armed anyway', out.spent);
  check(out.spent.again === false && out.spent.mine === '[[2],[3],[]]',
    'a second cast went through on one charge', out.spent);
  await tapCol(2); await page.waitForTimeout(900);
  out.placed = await look();
  check(out.placed.mine === '[[2],[3],[4]]', 'placement broken after a cast', out.placed);

  /* ---------- 5. drag and drop reaches the same gate ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose (drag)');
  await table([[1, 1], [], []], [[6], [], []]);
  const box = await page.locator('.rune').boundingBox();
  const target = await page.locator('#botBoard .col[data-col="0"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  out.dragging = await page.evaluate(() => ({
    ghost: document.querySelectorAll('.runeghost').length,
    hot: document.querySelectorAll('.col.hot').length,
  }));
  check(out.dragging.ghost === 1, 'no rune under the finger while dragging', out.dragging);
  check(out.dragging.hot === 2, 'a swap must light BOTH facing columns', out.dragging);
  await page.mouse.up(); await page.waitForTimeout(1400);
  out.dropped = await look();
  check(out.dropped.mine === '[[6],[],[]]' && out.dropped.theirs === '[[1,1],[],[]]',
    'the drop did not swap', out.dropped);
  check(out.dropped.strays === 0, 'the dragged rune was left on the page', out.dropped);
  check(out.dropped.present === out.dropped.visible, 'a dropped-swap die is invisible', out.dropped);

  /* ---------- 6. refusals: legality is asked before anything moves ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose (refusal)');
  await table([[3], [], []], [[3], [], []]);          // identical columns: nothing to trade
  out.refuse = await page.evaluate(async () => {
    const k = window.__kb;
    const ok = await k.spells.cast('swap', 0);
    return { ok, charges: JSON.stringify(k.S.spellCharges), mine: JSON.stringify(k.S.boards[1]) };
  });
  check(out.refuse.ok === false, 'an identical-column swap was allowed', out.refuse);
  check(out.refuse.charges === '[{"swap":1},{"swap":1}]', 'a refused cast still cost a charge', out.refuse);
  // not your turn, and not your phase — the same gate placement uses
  out.offturn = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.turn = 0;
    const other = await k.spells.cast('swap', 0);
    k.S.turn = 1; k.S.phase = 'anim';
    const mid = await k.spells.cast('swap', 0);
    k.S.phase = 'choose';
    return { other, mid, charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.offturn.other === false, 'cast on the opponent\'s turn', out.offturn);
  check(out.offturn.mid === false, 'cast after the die was already committed', out.offturn);

  /* ---------- 7. a swap can end the game (either grid full, not the mover's) ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose (endgame)');
  await table([[1, 2, 3], [1, 2, 3], [1, 2]], [[], [], [4, 5, 6]]);
  await page.evaluate(() => window.__kb.spells.cast('swap', 2));
  await page.waitForTimeout(2600);
  out.ended = await look();
  check(out.ended.end, 'a swap that filled a grid did not end the game', out.ended);

  /* ---------- 8. NONE is really none: the table is the old table ---------- */
  await newGame({ spell: '' }); check(await waitChoose(), 'game never reached choose (none)');
  await table([[6, 6], [3], []], [[2], [5], []]);
  out.off = await look();
  check(out.off.charges === '[{},{}]', 'NONE still dealt a hand', out.off.charges);
  check(out.off.barHidden && !out.off.runeShown, 'the rune survived the NONE pick', out.off);
  check(!out.off.casting, 'the board is still in casting with no spell picked', out.off);
  out.offCast = await page.evaluate(async () => {
    const k = window.__kb;
    return { cast: await k.spells.cast('swap', 0), mine: JSON.stringify(k.S.boards[1]) };
  });
  check(out.offCast.cast === false && out.offCast.mine === '[[6,6],[3],[]]',
    'a spell fired with the layer switched off', out.offCast);
  await tapCol(2); await page.waitForTimeout(900);
  check((await look()).mine === '[[6,6],[3],[4]]', 'ordinary play broken with spells off', await look());

  /* ---------- 9. the tutorial is a scripted lesson: no spells in it ---------- */
  await newGame({ tutorial: true }); await page.waitForTimeout(900);
  out.tut = await page.evaluate(() => ({
    charges: JSON.stringify(window.__kb.S.spellCharges),
    barHidden: document.getElementById('spellBar').hidden,
  }));
  check(out.tut.charges === '[{},{}]', 'the tutorial dealt spells', out.tut);
  check(out.tut.barHidden, 'the rune showed up in the tutorial', out.tut);

  console.log(JSON.stringify({ out, problems }, null, 2));
} finally { await browser.close(); }
process.exit(problems.length ? 1 : 0);
