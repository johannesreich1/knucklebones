// SPELLS: the optional powers layer, driven the way a player drives it.
//
// The rules of the effects are pinned in tests/spells.test.ts (pure). This
// suite guards the RUNTIME: that the rune only appears where it should, that
// both gestures (tap-to-arm, drag-and-drop) reach the same one gate — for a
// COLUMN spell (PILFER) and for a SELF spell aimed at the die in play (FATE)
// — that the board a player can SEE matches the state after a cast (the
// test13 lesson: assert computed pixels, never merely the DOM), that a charge
// is spent exactly once, and — the promise the feature is built on — that
// switching spells OFF leaves the table indistinguishable from the game
// before spells existed.
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
  check(out.picker.slices === 6 && out.picker.values[0] === '', 'NONE + the five runes', out.picker);
  check(!out.picker.values.includes('swap'), 'the retired swap must not be pickable', out.picker.values);
  check(out.picker.icons.every(Boolean), 'every slice carries its icon', out.picker);
  check(/^NONE — /.test(out.picker.info), 'NONE needs its explanation', out.picker.info);
  check(out.picker.sameComponent, 'the spell row must reuse the game-mode row', out.picker);
  // picking the spell names it, with its own blurb
  await page.tap('#spellPick button[data-v="pilfer"]'); await page.waitForTimeout(200);
  out.picked = await page.evaluate(() => ({
    pick: window.__kb.S.spell,
    on: document.querySelector('#spellPick button.on')?.dataset.v,
    info: document.getElementById('spellPickInfo').textContent,
  }));
  check(out.picked.pick === 'pilfer' && out.picked.on === 'pilfer', 'picking a spell did not take', out.picked);
  check(/^PILFER — /.test(out.picked.info), 'a picked spell needs its name and line', out.picked.info);
  await page.evaluate(() => window.__kb.goHome());

  /* start a two-player face-to-face game: no CPU reply and no hand-off card
     racing the assertions, and no turn clock auto-placing under them */
  const newGame = (opts = {}) => page.evaluate((o) => {
    const k = window.__kb;
    k.S.spell = o.spell === undefined ? 'pilfer' : o.spell;   // the OFFLINE screen's pick
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
    const rune = document.querySelector('.rune[data-seat="1"]:not([hidden])');
    const foe = document.querySelector('.rune[data-seat="0"]:not([hidden])');
    return {
      mine: JSON.stringify(window.__kb.S.boards[1]), theirs: JSON.stringify(window.__kb.S.boards[0]),
      charges: JSON.stringify(window.__kb.S.spellCharges),
      armed: window.__kb.S.spellArmed, casting: document.documentElement.classList.contains('casting'),
      castself: document.documentElement.classList.contains('castself'),
      phase: window.__kb.S.phase, busy: window.__kb.S.busy, die: window.__kb.S.die,
      runeShown: !!rune && !!rune.offsetParent,
      mineHome: rune?.parentElement?.id || rune?.parentElement?.className,
      foeHome: foe?.closest('.plate')?.id,
      runeClass: rune ? rune.className : null,
      foeClass: foe ? foe.className : null,
      foeShown: !!foe && !!foe.offsetParent,
      present: dice.length,
      visible: dice.filter(d => getComputedStyle(d).visibility === 'visible' && +getComputedStyle(d).opacity > 0.05).length,
      strays: document.querySelectorAll('body > .die, body > .runeghost').length,
      status: document.getElementById('status').textContent,
      end: document.getElementById('ovEnd').classList.contains('on'),
    };
  });
  const tapCol = (c) => page.tap(`#botBoard .col[data-col="${c}"]`);
  const tapRune = () => page.tap('.rune[data-seat="1"]:not([hidden])');

  /* ---------- 1. the rune is dealt to a normal offline game ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose');
  await table([[2], [3], []], [[6, 6], [5], []]);
  out.dealt = await look();
  check(out.dealt.runeShown, 'no rune in an offline game', out.dealt);
  // the two runes are two different objects and live in two different places:
  // the one you can cast sits beside the die in play (a short drag from every
  // column); the opponent's is a readout in their own nameplate
  check(out.dealt.mineHome === 'spellBar', 'the castable rune left the die in play', out.dealt);
  check(out.dealt.foeHome === 'plateTop', "the opponent's rune is not in their nameplate", out.dealt);
  check(out.dealt.charges === '[{"pilfer":1},{"pilfer":1}]', 'both seats hold one cast', out.dealt.charges);
  // BOTH seats ride the rail: "does the opponent still have theirs?" must be
  // answerable by looking, and an opponent's rune is never pressable
  check(out.dealt.foeShown, "the opponent's rune is not on the rail", out.dealt);
  check(/\bidle\b/.test(out.dealt.foeClass) && !/\bready\b/.test(out.dealt.foeClass),
    "the opponent's rune must read as theirs, loaded and not yours to press", out.dealt.foeClass);

  /* ---------- 2. tap to arm ---------- */
  await tapRune(); await page.waitForTimeout(120);
  out.armed = await look();
  check(out.armed.armed === 'pilfer', 'tapping the rune did not arm it', out.armed);
  check(out.armed.casting && !out.armed.castself, 'a column spell arms the board, not the stage', out.armed);
  check(/column/i.test(out.armed.status), 'no instruction while aiming', out.armed.status);
  // aiming must not place: a tap on the board casts instead of dropping the die
  out.rings = await page.evaluate(() => {
    const c = document.querySelector('#botBoard .col');
    return { spellRing: getComputedStyle(c, '::after').borderColor,
             legalHidden: getComputedStyle(document.querySelector('#botBoard .col.legal'), '::after').display };
  });
  check(out.rings.legalHidden === 'none', 'placement hints still up while aiming', out.rings);

  /* ---------- 3. tap a column: ONE gate, one charge ---------- */
  await tapCol(0); await page.waitForTimeout(1200);
  out.cast = await look();
  check(out.cast.mine === '[[2,6],[3],[]]', 'the caster column did not receive the stolen die', out.cast);
  check(out.cast.theirs === '[[6],[5],[]]', 'the enemy column kept its top die', out.cast);
  check(out.cast.present === out.cast.visible, 'A STOLEN DIE IS INVISIBLE', out.cast);
  check(out.cast.strays === 0, 'a flying copy was left on the page', out.cast);
  check(out.cast.charges === '[{"pilfer":1},{"pilfer":0}]', 'wrong seat was charged', out.cast.charges);
  check(!out.cast.armed && !out.cast.casting, 'still aiming after the cast', out.cast);
  check(out.cast.phase === 'choose' && !out.cast.busy, 'the turn was not handed back', out.cast);
  check(out.cast.die === 4, 'the roll in hand was lost to the cast', out.cast.die);
  check(out.cast.runeClass.includes('spent'), 'a spent rune must say so', out.cast.runeClass);

  /* ---------- 4. spent: no second cast, and the die still places ---------- */
  out.spent = await page.evaluate(async () => {
    const k = window.__kb;
    const b = document.querySelector('.rune[data-seat="1"]:not([hidden])');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }));
    return { disabled: b.disabled, armed: k.S.spellArmed, again: await k.spells.cast('pilfer', 0),
             mine: JSON.stringify(k.S.boards[1]) };
  });
  check(out.spent.disabled, 'a spent rune is still a live button', out.spent);
  check(out.spent.armed === null, 'a spent rune armed anyway', out.spent);
  check(out.spent.again === false && out.spent.mine === '[[2,6],[3],[]]',
    'a second cast went through on one charge', out.spent);
  await tapCol(2); await page.waitForTimeout(900);
  out.placed = await look();
  check(out.placed.mine === '[[2,6],[3],[4]]', 'placement broken after a cast', out.placed);

  /* ---------- 5. drag and drop reaches the same gate ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose (drag)');
  await table([[1, 1], [], []], [[6], [], []]);
  const box = await page.locator('.rune[data-seat="1"]:not([hidden])').boundingBox();
  const target = await page.locator('#botBoard .col[data-col="0"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  out.dragging = await page.evaluate(() => ({
    ghost: document.querySelectorAll('.runeghost').length,
    hot: document.querySelectorAll('.col.hot').length,
  }));
  check(out.dragging.ghost === 1, 'no rune under the finger while dragging', out.dragging);
  check(out.dragging.hot === 2, 'a theft must light BOTH facing columns — source and landing', out.dragging);
  await page.mouse.up(); await page.waitForTimeout(1200);
  out.dropped = await look();
  check(out.dropped.mine === '[[1,1,6],[],[]]' && out.dropped.theirs === '[[],[],[]]',
    'the drop did not steal', out.dropped);
  check(out.dropped.strays === 0, 'the dragged rune was left on the page', out.dropped);
  check(out.dropped.present === out.dropped.visible, 'a dropped-steal die is invisible', out.dropped);

  /* ---------- 6. refusals: legality is asked before anything moves ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose (refusal)');
  await table([[3], [], []], [[], [], []]);           // nothing to steal anywhere
  out.refuse = await page.evaluate(async () => {
    const k = window.__kb;
    const ok = await k.spells.cast('pilfer', 0);
    return { ok, charges: JSON.stringify(k.S.spellCharges), mine: JSON.stringify(k.S.boards[1]) };
  });
  check(out.refuse.ok === false, 'an empty-column theft was allowed', out.refuse);
  check(out.refuse.charges === '[{"pilfer":1},{"pilfer":1}]', 'a refused cast still cost a charge', out.refuse);
  // not your turn, and not your phase — the same gate placement uses. The
  // turn gate only bites in CPU mode (in duo, whoever holds the turn may
  // cast): a human cast on the machine's turn must be refused.
  out.offturn = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.boards[0] = [[6], [], []];
    k.S.mode = 'cpu'; k.S.turn = 0;
    const other = await k.spells.cast('pilfer', 0);
    k.S.mode = 'duo'; k.S.turn = 1; k.S.phase = 'anim';
    const mid = await k.spells.cast('pilfer', 0);
    k.S.phase = 'choose';
    return { other, mid, charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.offturn.other === false, 'cast on the machine\'s turn', out.offturn);
  check(out.offturn.mid === false, 'cast after the die was already committed', out.offturn);

  /* ---------- 7. a cast can end the game (either grid full, not the mover's) ---------- */
  await newGame(); check(await waitChoose(), 'game never reached choose (endgame)');
  await table([[1, 2, 3], [1, 2, 3], [1, 2]], [[], [], [4, 5]]);
  await page.evaluate(() => window.__kb.spells.cast('pilfer', 2));
  await page.waitForTimeout(2600);
  out.ended = await look();
  check(out.ended.end, 'a steal that filled a grid did not end the game', out.ended);

  /* ---------- 8. NONE is really none: the table is the old table ---------- */
  await newGame({ spell: '' }); check(await waitChoose(), 'game never reached choose (none)');
  await table([[6, 6], [3], []], [[2], [5], []]);
  out.off = await look();
  check(out.off.charges === '[{},{}]', 'NONE still dealt a hand', out.off.charges);
  check(!out.off.runeShown && !out.off.foeShown, 'a rune survived the NONE pick', out.off);
  check(!out.off.casting, 'the board is still in casting with no spell picked', out.off);
  out.offCast = await page.evaluate(async () => {
    const k = window.__kb;
    return { cast: await k.spells.cast('pilfer', 0), mine: JSON.stringify(k.S.boards[1]) };
  });
  check(out.offCast.cast === false && out.offCast.mine === '[[6,6],[3],[]]',
    'a spell fired with the layer switched off', out.offCast);
  await tapCol(2); await page.waitForTimeout(900);
  check((await look()).mine === '[[6,6],[3],[4]]', 'ordinary play broken with spells off', await look());

  /* ---------- 8b. the CPU holds the same rune, and spends it ----------
     It was dealt a charge from the first build; leaving it unspent made VS CPU
     quietly one-sided. HARD takes a big steal and declines a trivial one. */
  await newGame(); check(await waitChoose(), 'game never reached choose (cpu)');
  out.cpuTakes = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.mode = 'cpu'; k.S.diff = 'hard';
    k.S.boards[1] = [[6, 6], [1], []];      // the human's pair of 6s...
    k.S.boards[0] = [[2], [], []];          // ...facing the machine's single 2
    k.S.turn = 0; k.S.bottom = 1; k.S.busy = false; k.S.die = 3;
    k.applySides(); k.renderAll(false);
    const over = await k.spells.ai(0);
    return { over, cpu: JSON.stringify(k.S.boards[0]), human: JSON.stringify(k.S.boards[1]),
             charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.cpuTakes.cpu === '[[2,6],[],[]]' && out.cpuTakes.human === '[[6],[1],[]]',
    'THE CPU LEFT A FREE STEAL ON THE TABLE', out.cpuTakes);
  check(out.cpuTakes.charges === '[{"pilfer":0},{"pilfer":1}]', 'the CPU charged the wrong seat', out.cpuTakes);
  // and the player can SEE that it spent it
  check(/\bspent\b/.test((await look()).foeClass), "a spent opponent rune must say so", (await look()).foeClass);
  // a swing below what its difficulty demands is declined, charge intact
  await newGame(); check(await waitChoose(), 'game never reached choose (cpu decline)');
  out.cpuHolds = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.mode = 'cpu'; k.S.diff = 'hard';
    k.S.boards[1] = [[1], [], []];          // nothing worth taking
    k.S.boards[0] = [[2], [], []];
    k.S.turn = 0; k.S.bottom = 1; k.S.busy = false; k.S.die = 3;
    k.applySides(); k.renderAll(false);
    await k.spells.ai(0);
    return { cpu: JSON.stringify(k.S.boards[0]), charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.cpuHolds.cpu === '[[2],[],[]]' && out.cpuHolds.charges === '[{"pilfer":1},{"pilfer":1}]',
    'the CPU burned its rune on nothing', out.cpuHolds);

  /* ---------- 9. a SELF spell aims at the die in play, not the board ----------
     FATE: tap-to-arm lights the STAGE (columns stand down), a column tap
     cancels instead of casting, and the die on the stage is what changes. */
  await newGame({ spell: 'fate' }); check(await waitChoose(), 'game never reached choose (fate)');
  await table([[2], [], []], [[5], [], []], 2);
  await tapRune(); await page.waitForTimeout(120);
  out.selfArmed = await look();
  check(out.selfArmed.armed === 'fate' && out.selfArmed.castself,
    'a self spell must aim at the stage', out.selfArmed);
  check(/die/i.test(out.selfArmed.status), 'the aim line must point at the die', out.selfArmed.status);
  // a column is the WRONG target for a self spell: the tap cancels, free of charge
  await tapCol(0); await page.waitForTimeout(200);
  out.selfMiss = await look();
  check(out.selfMiss.armed === null && out.selfMiss.charges === '[{"fate":2},{"fate":2}]',
    'a column tap must cancel a self spell, not cast it', out.selfMiss);
  check(out.selfMiss.mine === '[[2],[],[]]' && out.selfMiss.die === 2,
    'the cancelled aim changed something', out.selfMiss);
  // arm again, tap the die in play: the cast happens THERE
  await tapRune(); await page.waitForTimeout(120);
  await page.tap('#dieStage'); await page.waitForTimeout(900);
  out.selfCast = await look();
  check(out.selfCast.charges === '[{"fate":2},{"fate":1}]', 'the stage tap did not cast', out.selfCast);
  check(out.selfCast.die >= 1 && out.selfCast.die <= 6, 'the redraw lost the die', out.selfCast.die);
  check(out.selfCast.phase === 'choose' && !out.selfCast.busy, 'the turn was not handed back (fate)', out.selfCast);
  check(!out.selfCast.castself, 'the stage is still lit after the cast', out.selfCast);
  // the drag reaches the same gate: rune onto the stage spends the second charge
  const rbox = await page.locator('.rune[data-seat="1"]:not([hidden])').boundingBox();
  const sbox = await page.locator('#dieStage').boundingBox();
  await page.mouse.move(rbox.x + rbox.width / 2, rbox.y + rbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2, { steps: 10 });
  await page.mouse.up(); await page.waitForTimeout(900);
  out.selfDrag = await look();
  check(out.selfDrag.charges === '[{"fate":2},{"fate":0}]', 'the stage drop did not cast', out.selfDrag);
  // and the redrawn die still places
  await tapCol(1); await page.waitForTimeout(900);
  out.selfPlaced = await look();
  check(JSON.parse(out.selfPlaced.mine)[1].length === 1, 'placement broken after a redraw', out.selfPlaced);

  /* ---------- 10. WARD: the mark is a thing the player can SEE ---------- */
  await newGame({ spell: 'ward' }); check(await waitChoose(), 'game never reached choose (ward)');
  await table([[6, 6], [], []], [[], [], []]);
  await page.evaluate(() => window.__kb.spells.cast('ward', 0));
  await page.waitForTimeout(600);
  out.warded = await page.evaluate(() => {
    const k = window.__kb;
    const chip = document.querySelectorAll('#botCols .chip')[0];
    const wd = chip && chip.querySelector('.wd');
    return {
      wards: JSON.stringify(k.S.charm.wards),
      charges: JSON.stringify(k.S.spellCharges),
      chipShown: !!wd && !!wd.querySelector('svg') && getComputedStyle(wd).display !== 'none',
      colMarked: document.querySelector('#botBoard .col[data-col="0"]').classList.contains('warded'),
    };
  });
  check(out.warded.wards === '[[0,0,0],[1,0,0]]', 'the mark landed on the wrong column', out.warded);
  check(out.warded.charges === '[{"ward":1},{"ward":0}]', 'the ward cast was not charged', out.warded);
  check(out.warded.chipShown && out.warded.colMarked,
    'A WARD THE PLAYER CANNOT SEE IS NOT A WARD', out.warded);

  /* ---------- 11. the tutorial is a scripted lesson: no spells in it ---------- */
  await newGame({ tutorial: true }); await page.waitForTimeout(900);
  out.tut = await page.evaluate(() => ({
    charges: JSON.stringify(window.__kb.S.spellCharges),
    runeShown: !!document.querySelector('.rune[data-seat="1"]:not([hidden])')?.offsetParent,
  }));
  check(out.tut.charges === '[{},{}]', 'the tutorial dealt spells', out.tut);
  check(!out.tut.runeShown, 'the rune showed up in the tutorial', out.tut);

  console.log(JSON.stringify({ out, problems }, null, 2));
} finally { await browser.close(); }
process.exit(problems.length ? 1 : 0);
