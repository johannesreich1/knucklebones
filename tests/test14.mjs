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
/* the registry itself, so the probe compares the SCREEN against the source of
   truth rather than against a count someone typed here (node strips the types) */
import { SPELLS, RANDOM_SPELL } from '../src/core/spells.ts';
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
  /* ASK THE REGISTRY, never restate it. The picker builds itself from SPELLS
     (ui/library.ts), so a hardcoded slice count here would pass while the two
     disagree — and that is not hypothetical: this line said "the five runes"
     and src/markup.ts advertised "five to choose from" long enough for a sixth
     to be measured, written and iconed before either noticed. */
  const wantSlices = ['', ...SPELLS.map((s) => s.id), RANDOM_SPELL];
  check(String(out.picker.values) === String(wantSlices),
    'the picker must be NONE + every rune in registry order + RANDOM',
    { got: out.picker.values, want: wantSlices });
  check(out.picker.values.at(-1) === RANDOM_SPELL, 'RANDOM is the last slice, as on the mode row', out.picker.values);
  check(out.picker.icons.every(Boolean), 'every slice must draw a mark', out.picker.icons);
  /* ONE idea, ONE mark: RANDOM means the same thing in both rows, so it must
     LOOK the same in both. A hand-copied glyph drifted here once — the mode's
     shuffle is two paths and the copy took one, so the spell row showed a bare
     X beside the mode row's arrows (user spotted it). Compare what is drawn. */
  out.randomIcon = await page.evaluate(() => {
    const strip = (sel, v) => document.querySelector(`${sel} button[data-v="${v}"]`);
    const svg = (b) => b?.querySelector('svg');
    const geom = (b) => [...(svg(b)?.querySelectorAll('path,circle,rect,line,polyline') ?? [])]
      .map((n) => n.tagName + ':' + (n.getAttribute('d') ?? '')).join('|');
    const mode = strip('#modePick', '-1'), spell = strip('#spellPick', 'random');
    return { mode: geom(mode), spell: geom(spell),
             modeHue: mode?.style.getPropertyValue('--mh'), spellHue: spell?.style.getPropertyValue('--mh') };
  });
  check(out.randomIcon.mode === out.randomIcon.spell && !!out.randomIcon.mode,
    'THE TWO RANDOM SLICES DRAW DIFFERENT MARKS', out.randomIcon);
  check(out.randomIcon.modeHue === out.randomIcon.spellHue,
    'the two RANDOM slices wear different hues', out.randomIcon);
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
    hotSide: document.querySelector('.col.hot')?.closest('.side')?.id,
  }));
  check(out.dragging.ghost === 1, 'no rune under the finger while dragging', out.dragging);
  // the steal takes from THEIR half: exactly the column it will rob lights up
  check(out.dragging.hot === 1 && out.dragging.hotSide === 'sideTop',
    'a theft must light the enemy column it will rob, and only that', out.dragging);
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

  /* ---------- 9. a SELF spell has ONE target, so pressing it casts it ----------
     NUDGE and FATE act on the die in hand. There is nothing to choose, so
     there is nothing to aim: a tap on the rune spends it then and there
     (user call — an aim step for a single possible target was pure friction).
     NUDGE is the deterministic one: 5 must become 6. */
  await newGame({ spell: 'nudge' }); check(await waitChoose(), 'game never reached choose (nudge)');
  await table([[2], [], []], [[5], [], []], 5);
  await tapRune(); await page.waitForTimeout(700);
  out.selfTap = await look();
  check(out.selfTap.die === 6, 'a tap on a self rune must cast it — the die did not tick', out.selfTap);
  check(out.selfTap.charges === '[{"nudge":1},{"nudge":0}]', 'the tap-cast charged the wrong seat', out.selfTap);
  check(out.selfTap.armed === null && !out.selfTap.castself,
    'a self spell must never sit armed waiting for a target', out.selfTap);
  check(out.selfTap.phase === 'choose' && !out.selfTap.busy, 'the turn was not handed back (nudge)', out.selfTap);
  /* Straight after the press the rune is NOT spent — the same press can still
     put the cast back (§9a). It reads spent once the die is played and the
     take-back window closes. */
  check(/\bundo\b/.test(out.selfTap.runeClass) && !/\bspent\b/.test(out.selfTap.runeClass),
    'a rune that can still be taken back must not read as spent', out.selfTap.runeClass);
  await tapCol(1); await page.waitForTimeout(900);
  out.selfPlaced = await look();
  check(JSON.parse(out.selfPlaced.mine)[1][0] === 6, 'placement broken after a self cast', out.selfPlaced);
  check(/\bspent\b/.test(out.selfPlaced.runeClass) && !/\bundo\b/.test(out.selfPlaced.runeClass),
    'the rune still offers a take-back after the die was played', out.selfPlaced.runeClass);

  /* the drag still aims — dropping on the die casts, dropping anywhere else
     cancels and keeps the charge */
  await newGame({ spell: 'fate' }); check(await waitChoose(), 'game never reached choose (fate)');
  await table([[2], [], []], [[5], [], []], 2);
  const drag = async (to) => {
    const rb = await page.locator('.rune[data-seat="1"]:not([hidden])').boundingBox();
    const tb = await page.locator(to).boundingBox();
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 10 });
    await page.mouse.up(); await page.waitForTimeout(900);
  };
  await drag('#dieStage');
  out.selfDrag = await look();
  check(out.selfDrag.charges === '[{"fate":2},{"fate":1}]', 'the stage drop did not cast', out.selfDrag);
  check(out.selfDrag.die >= 1 && out.selfDrag.die <= 6, 'the redraw lost the die', out.selfDrag.die);
  await drag('#botBoard .col[data-col="2"]');       // a column is not a self spell's target
  out.selfDragMiss = await look();
  check(out.selfDragMiss.charges === '[{"fate":2},{"fate":1}]',
    'dropping a self spell on a column must cancel, not spend', out.selfDragMiss);
  check(out.selfDragMiss.armed === null, 'the cancelled drag left the rune armed', out.selfDragMiss);

  /* ---------- 9a. the take-back ----------
     A self spell lands the instant it is pressed, so pressing it again puts
     it back — until the die it changed is played (user call). NUDGE is the
     deterministic one to watch: 5 → 6 → 5 → 6. */
  await newGame({ spell: 'nudge' }); check(await waitChoose(), 'game never reached choose (undo)');
  await table([[2], [], []], [[5], [], []], 5);
  await tapRune(); await page.waitForTimeout(700);
  out.undoCast = await look();
  check(out.undoCast.die === 6 && out.undoCast.charges === '[{"nudge":1},{"nudge":0}]',
    'the cast did not happen', out.undoCast);
  check(/\bundo\b/.test(out.undoCast.runeClass) && !/\bspent\b/.test(out.undoCast.runeClass),
    'a rune that can still be taken back must not read as spent', out.undoCast.runeClass);
  await tapRune(); await page.waitForTimeout(700);
  out.undone = await look();
  check(out.undone.die === 5, 'PRESSING AGAIN DID NOT PUT THE DIE BACK', out.undone);
  check(out.undone.charges === '[{"nudge":1},{"nudge":1}]', 'the take-back did not return the charge', out.undone);
  check(/put back/i.test(out.undone.status), 'the take-back said nothing', out.undone.status);
  // and it is castable again, for real
  await tapRune(); await page.waitForTimeout(700);
  out.recast = await look();
  check(out.recast.die === 6 && out.recast.charges === '[{"nudge":1},{"nudge":0}]',
    'the rune did not work again after being put back', out.recast);
  // playing the die CLOSES the window: the cast is final
  await tapCol(1); await page.waitForTimeout(1000);
  out.undoClosed = await page.evaluate(() => ({
    pending: !!window.__kb.S.spellUndo, undoable: window.__kb.spells.undoable('nudge'),
    charges: JSON.stringify(window.__kb.S.spellCharges) }));
  check(!out.undoClosed.pending && !out.undoClosed.undoable,
    'the cast can still be taken back AFTER the die was played', out.undoClosed);
  check(out.undoClosed.charges === '[{"nudge":1},{"nudge":0}]',
    'the charge came back after the die was already played', out.undoClosed);

  /* FATE's redraw came out of the supply, so the take-back must put it BACK —
     in LIMITED that is a real die the bag would otherwise have lost. */
  out.undoBag = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.spell = 'fate'; k.S.localMode = 6; k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0;
    k.newGame();
    for (let i = 0; i < 80; i++) { if (k.S.phase === 'choose') break; await new Promise((r) => setTimeout(r, 100)); }
    k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose';
    const bagBefore = k.S.pool.length, dieBefore = k.S.die;
    await k.spells.cast('fate', -1);
    await new Promise((r) => setTimeout(r, 700));
    const bagAfter = k.S.pool.length, dieAfter = k.S.die;
    const undone = k.spells.undo();
    return { bagBefore, bagAfter, bagBack: k.S.pool.length, dieBefore, dieAfter,
             dieBack: k.S.die, undone, charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.undoBag.bagAfter === out.undoBag.bagBefore - 1, 'the redraw did not come out of the bag', out.undoBag);
  check(out.undoBag.bagBack === out.undoBag.bagBefore,
    'THE TAKE-BACK LOST A DIE FROM THE BAG', out.undoBag);
  check(out.undoBag.dieBack === out.undoBag.dieBefore, 'the take-back kept the redrawn die', out.undoBag);

  /* SUNDER's mark is charm state, not a die — the take-back must lift it */
  out.undoMark = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.spell = 'sunder'; k.S.localMode = 0; k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0;
    k.newGame();
    for (let i = 0; i < 80; i++) { if (k.S.phase === 'choose') break; await new Promise((r) => setTimeout(r, 100)); }
    k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose'; k.S.die = 3;
    await k.spells.cast('sunder', -1);
    await new Promise((r) => setTimeout(r, 700));
    const marked = k.S.charm.sunder[1];
    k.spells.undo();
    return { marked, afterUndo: k.S.charm.sunder[1],
             stageLit: document.getElementById('dieStage').classList.contains('sundered'),
             charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.undoMark.marked === true, 'sunder never marked the caster', out.undoMark);
  check(out.undoMark.afterUndo === false && !out.undoMark.stageLit,
    'THE TAKE-BACK LEFT THE SUNDER MARK ON THE DIE', out.undoMark);
  check(out.undoMark.charges === '[{"sunder":1},{"sunder":1}]', 'the sunder charge did not come back', out.undoMark);

  /* a COLUMN spell has visibly moved dice — no take-back is offered */
  await newGame({ spell: 'pilfer' }); check(await waitChoose(), 'game never reached choose (no undo)');
  await table([[2], [], []], [[6, 6], [], []]);
  await page.evaluate(() => window.__kb.spells.cast('pilfer', 0));
  await page.waitForTimeout(1200);
  out.noUndo = await page.evaluate(() => ({ pending: !!window.__kb.S.spellUndo,
    undoable: window.__kb.spells.undoable('pilfer'),
    cls: document.querySelector('.rune[data-seat="1"]:not([hidden])')?.className }));
  check(!out.noUndo.pending && !out.noUndo.undoable,
    'a board spell offered a take-back after its dice had flown', out.noUndo);
  check(/\bspent\b/.test(out.noUndo.cls), 'a spent board rune must read as spent', out.noUndo);

  /* ---------- 9b. the board rings ONLY what the cast can land on ----------
     COLUMN SWAP could honestly ring all six (either half was a legal target).
     WARD guards your three; PILFER robs theirs, and only the ones holding
     dice. Ringing the rest told the player the board was a target when it
     was not (user report). markAim asks the registry's own legal(). */
  const rings = () => page.evaluate(() => {
    const ring = (side) => [0, 1, 2].map((c) => {
      const st = getComputedStyle(document.querySelector(`#${side} .col[data-col="${c}"]`), '::after');
      return st.display !== 'none' && st.borderStyle !== 'none' ? 1 : 0;
    });
    return { mine: ring('botBoard'), enemy: ring('topBoard') };
  });
  await newGame({ spell: 'ward' }); check(await waitChoose(), 'game never reached choose (ward rings)');
  await table([[6, 6], [2], []], [[3], [], []]);
  await tapRune(); await page.waitForTimeout(200);
  out.wardRings = await rings();
  check(String(out.wardRings.mine) === '1,1,1' && String(out.wardRings.enemy) === '0,0,0',
    'A WARD MUST OFFER YOUR COLUMNS AND ONLY YOURS', out.wardRings);
  await page.tap('#status'); await page.waitForTimeout(200);          // tap off-board: cancel

  await newGame({ spell: 'pilfer' }); check(await waitChoose(), 'game never reached choose (pilfer rings)');
  await table([[6, 6], [2], []], [[3], [], []]);                      // only enemy col 0 holds a die
  await tapRune(); await page.waitForTimeout(200);
  out.pilferRings = await rings();
  check(String(out.pilferRings.mine) === '0,0,0' && String(out.pilferRings.enemy) === '1,0,0',
    'A STEAL MUST OFFER ONLY ENEMY COLUMNS THAT HOLD A DIE', out.pilferRings);
  // and an unringed column refuses rather than casting somewhere else
  await tapCol(1); await page.waitForTimeout(400);
  out.unringed = await look();
  check(out.unringed.charges === '[{"pilfer":1},{"pilfer":1}]',
    'tapping an unoffered column spent the charge', out.unringed);

  /* ---------- 10. the nameplate holds still ----------
     The rail and the plate trade the rune every turn face-to-face. The score
     cluster is vertically centred, so a slot that collapsed when the rune
     left re-centred it — the number jumped 10px each turn (user report). */
  await newGame({ spell: 'fate' }); check(await waitChoose(), 'game never reached choose (plate)');
  out.plateHold = await page.evaluate(async () => {
    const k = window.__kb;
    const ys = [];
    for (const turn of [1, 0, 1, 0]) {
      k.S.turn = turn; k.S.phase = 'choose'; k.S.busy = false;
      k.spells.render(); k.renderAll(false);
      await new Promise((r) => setTimeout(r, 120));
      ys.push([+document.getElementById('totTop').getBoundingClientRect().y.toFixed(1),
               +document.getElementById('totBot').getBoundingClientRect().y.toFixed(1)].join('/'));
    }
    return { ys, distinct: [...new Set(ys)].length };
  });
  check(out.plateHold.distinct === 1, 'THE SCORE MOVES WHEN THE RUNE CHANGES HANDS', out.plateHold);

  /* The cluster is placed by translate(50%,-50%), so half its own width is
     baked into where every child lands. A width that grew with the score's
     digits moved the rune by a FRACTION of a pixel on every scoring turn —
     invisible as geometry, visible as shimmer, because the glowing icon
     re-rasterizes against a different pixel grid (user report). Pin the box:
     one width, and the rune to four decimals, whatever the score reads. */
  await newGame({ spell: 'fate' }); check(await waitChoose(), 'game never reached choose (cluster)');
  out.clusterFixed = await page.evaluate(async () => {
    const k = window.__kb;
    const widths = new Set(), spots = new Set(), scores = [];
    for (const b of [[[], [], []], [[6], [], []], [[6, 6], [5], []],
                     [[6, 6, 6], [5, 5, 5], []], [[6, 6, 6], [5, 5, 5], [4, 4, 4]]]) {
      k.S.boards[0] = b; k.renderAll(false); k.spells.render();
      await new Promise((r) => setTimeout(r, 420));      // past .plate.bump
      widths.add(document.querySelector('#plateTop .pright').getBoundingClientRect().width.toFixed(3));
      const r = document.querySelector('#plateTop .rune:not([hidden])').getBoundingClientRect();
      spots.add(r.x.toFixed(4) + ',' + r.y.toFixed(4));
      scores.push(document.getElementById('totTop').textContent);
    }
    return { widths: [...widths], spots: [...spots], scores };
  });
  check(out.clusterFixed.widths.length === 1,
    'the score cluster still grows with its contents — every child will drift', out.clusterFixed);
  check(out.clusterFixed.spots.length === 1,
    "THE OPPONENT'S RUNE SHIFTS WHEN THEIR SCORE CHANGES WIDTH", out.clusterFixed);
  // and a spell-free game reserves nothing: the nameplate is the old nameplate
  await newGame({ spell: '' }); check(await waitChoose(), 'game never reached choose (plate none)');
  out.plateNone = await page.evaluate(() => {
    const slot = document.querySelector('#plateTop .runeslot');
    return { live: slot.classList.contains('live'), display: getComputedStyle(slot).display };
  });
  check(!out.plateNone.live && out.plateNone.display === 'none',
    'a spell-free game left a hole in the nameplate', out.plateNone);

  /* ---------- 10b. the marks hold still too ----------
     The chip CENTRES its contents, so the score and its ×k badge change width
     on every placement — a mark riding in that row jumped a dozen pixels each
     time (user report). Ward and shield sit at the chip's ends instead. */
  await newGame({ spell: 'ward' }); check(await waitChoose(), 'game never reached choose (chip)');
  await table([[6], [], []], [[1], [], []], 3);
  await page.evaluate(() => window.__kb.spells.cast('ward', 0));
  await page.waitForTimeout(700);
  out.chipHold = await page.evaluate(async () => {
    const k = window.__kb, xs = [];
    for (const col of [[6], [6, 6], [6, 6, 6]]) {          // 6 → 24 ×2 → 54 ×3
      k.S.boards[1][0] = col; k.renderAll(false);
      await new Promise((r) => setTimeout(r, 80));
      const wd = document.querySelectorAll('#botCols .chip')[0].querySelector('.wd');
      xs.push(+wd.getBoundingClientRect().x.toFixed(1));
    }
    return { xs, distinct: [...new Set(xs)].length };
  });
  check(out.chipHold.distinct === 1, 'THE WARD MARK MOVES WHEN THE SCORE GROWS', out.chipHold);

  /* BOUNTY banks its ✦ tally into the same centred cluster the score and rune
     share — appearing mid-match re-centred it and both jumped ~10px. */
  out.btyHold = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.spell = 'ward'; k.S.localMode = 5; k.S.mode = 'cpu'; k.S.seat = 'pass';
    k.newGame();
    for (let i = 0; i < 60; i++) { if (k.S.phase === 'choose') break; await new Promise((r) => setTimeout(r, 100)); }
    // let fit()/ResizeObserver finish sizing the table before measuring — a
    // layout still settling drifts on its own and would read as a tally jump
    await new Promise((r) => setTimeout(r, 700));
    const at = () => {
      const rune = document.querySelector('#plateTop .rune:not([hidden])');
      return [+rune.getBoundingClientRect().y.toFixed(1),
              +document.getElementById('totTop').getBoundingClientRect().y.toFixed(1)].join('/');
    };
    const ys = [];
    // 0 → 2 → 11 → back to 0: if the last reading equals the first, the tally
    // is not moving anything; a drift that never returns is the layout settling
    for (const banked of [0, 2, 11, 0]) {
      k.S.bounty = [banked, 0]; k.renderAll(false); k.spells.render();
      // WAIT OUT THE BUMP. Banking changes the total, and a changed total
      // scales the number for 190ms (.plate.bump) — sampling inside that
      // window measures the celebration, not the layout, and reads as drift.
      await new Promise((r) => setTimeout(r, 420));
      ys.push(at());
    }
    return { ys, distinct: [...new Set(ys)].length, returned: ys[0] === ys[3] };
  });
  check(out.btyHold.distinct === 1, 'THE BOUNTY TALLY SHOVES THE SCORE AND RUNE', out.btyHold);

  /* ---------- 10c. RANDOM deals a real rune, the SAME one to both ---------- */
  out.randomDeal = await page.evaluate(async () => {
    const k = window.__kb;
    const seen = new Set(); let mismatched = 0, empty = 0;
    for (let i = 0; i < 24; i++) {
      k.S.spell = 'random'; k.S.localMode = 0; k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0;
      k.newGame();
      const mine = Object.keys(k.S.spellCharges[1]), theirs = Object.keys(k.S.spellCharges[0]);
      if (!mine.length) { empty++; continue; }
      if (mine[0] !== theirs[0]) mismatched++;
      seen.add(mine[0]);
    }
    return { drew: [...seen].sort(), mismatched, empty, pick: k.S.spell };
  });
  check(out.randomDeal.empty === 0, 'RANDOM dealt an EMPTY hand — it must always become a real rune', out.randomDeal);
  check(out.randomDeal.mismatched === 0,
    'RANDOM dealt the two seats DIFFERENT runes — the layer is only fair because they match', out.randomDeal);
  check(out.randomDeal.drew.length >= 2, 'RANDOM never varied over 24 games', out.randomDeal);
  check(!out.randomDeal.drew.includes('random'), 'RANDOM dealt ITSELF as a rune', out.randomDeal);
  check(out.randomDeal.pick === 'random', 'the pick must survive the draw — RANDOM stays RANDOM', out.randomDeal);

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

  /* ---------- 10b. ANVIL: the forge lands on the die the RULE names ----------
     The rule picks WHICH die (lowest face, ties to the centre), so the screen
     has to show the new face standing where the old one stood — a state-only
     assertion would pass while the board still drew the 1. */
  await newGame({ spell: 'anvil' }); await waitChoose();
  await table([[6, 6, 1], [2], []], [[], [], []], 6);
  out.anvil = await page.evaluate(async () => {
    const k = window.__kb;
    const faces = () => [...document.querySelectorAll('#botBoard .col[data-col="0"] .die')]
      .map((d) => d.dataset.v).join(',');
    const drawnBefore = faces();
    // a column with room left is NOT forgeable — place into it instead
    const roomy = await k.spells.cast('anvil', 1);
    const forged = await k.spells.cast('anvil', 0);
    return { drawnBefore, roomy, forged, drawn: faces(),
             mine: JSON.stringify(k.S.boards[1]),
             die: k.S.die, charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.anvil.roomy === false, 'a column with room left must refuse the forge', out.anvil);
  check(out.anvil.forged === true, 'the full column refused a legal forge', out.anvil);
  check(out.anvil.mine === '[[6,6,6],[2],[]]', 'the LOWEST die did not take the face in hand', out.anvil);
  check(out.anvil.drawn.split(',').sort().join() === '6,6,6',
    'THE BOARD STILL DRAWS THE OLD FACE — the forge is invisible', out.anvil);
  check(out.anvil.die === 6, 'a cast is not a move: the die in hand must survive it', out.anvil);
  check(out.anvil.charges === '[{"anvil":1},{"anvil":0}]', 'the forge was not charged', out.anvil);

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
