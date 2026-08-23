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
  const newGame = (opts = {}, pg = page) => pg.evaluate((o) => {
    const k = window.__kb;
    k.S.spell = o.spell === undefined ? 'pilfer' : o.spell;   // the OFFLINE screen's pick
    /* the game MODE is a parameter, not a second helper: the seal probe below
       needs COLUMN SHIELD and a rune in the same game, and a copy of this
       function differing by one number is the duplicate CLAUDE.md forbids */
    k.S.timer = 0; k.S.localMode = o.mode ?? 0; k.S.mode = 'duo'; k.S.seat = 'face';
    /* PIN THE OPENER. Offline, who starts is a coin flip per app load and
       alternates from there (src/state.ts) — right for play, useless for a
       probe: face-to-face keeps the rune in the plate of whoever is NOT to
       move, so a random opener relocates the very thing half these assertions
       measure. This suite is about layout, not seating; test15/18/19 pin
       S.turn for the same reason. Without this the failure is a null
       getBoundingClientRect in whichever block happens to draw the wrong
       side — a flake that reads as a layout regression. */
    k.S.starter = 1;                                          // ME opens every game in this probe
    k.newGame(o.tutorial ? { tutorial: true } : undefined);
  }, opts);
  const waitChoose = async (pg = page) => {
    for (let i = 0; i < 60; i++) {
      if (await pg.evaluate(() => window.__kb.S.phase === 'choose')) return true;
      await pg.waitForTimeout(120);
    }
    return false;
  };
  /* put a known board on the table, mid-turn, with the caster to move.
     THE TRAILING `pg` on these three is what keeps the seal blocks below from
     growing a second copy of the setup: the reduced-motion probe, the two
     orientation probes and the main page are all the same scene, dealt the same
     way, and differ only in the viewport they are dealt onto. */
  const table = (mine, theirs, die = 4, pg = page) => pg.evaluate(([m, t, d]) => {
    const k = window.__kb;
    k.S.boards[1] = m; k.S.boards[0] = t;
    k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose'; k.S.die = d;
    k.applySides(); k.renderAll(false); k.setStageDie(d, 1); k.showHints(); k.spells.render();
  }, [mine, theirs, die]);
  /* one ward, placed by hand: §10 above already proves the CAST path, and what
     the seal blocks test is the MARK, not the gesture */
  const guard = (c = 1, who = 0, pg = page) => pg.evaluate(([cc, w]) => {
    window.__kb.S.charm.wards[w][cc] = 1; window.__kb.renderAll(false);
  }, [c, who]);
  /* a second probe page, dressed for one viewport — every seal block that is
     not the main phone borrows this rather than repeating the boot */
  const sidePage = async (view) => {
    const c = await browser.newContext({ hasTouch: true, isMobile: true, deviceScaleFactor: 2,
      ...(view.device || { viewport: { width: view.w, height: view.h } }), ...(view.opts || {}) });
    await c.addInitScript(() => { const k = 'knucklebones.v1', cf = JSON.parse(localStorage.getItem(k) || '{}'); cf.played = true; localStorage.setItem(k, JSON.stringify(cf)); });
    const p = await c.newPage();
    p.on('pageerror', (e) => problems.push('PAGEERROR(' + view.name + '): ' + e.message));
    await p.goto(F); await p.waitForTimeout(400);
    return { ctx: c, page: p };
  };
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

  /* ---------- 8c. their turn: your own rune READS unavailable ----------
     It was `disabled` and nothing else, and disabled is invisible: the rune
     sat full-bright and breathing while the machine thought, which reads as a
     control you may press (user report). Measure the PIXELS, not the class —
     the test13 lesson — and measure the ring's play state too, because the
     cheap fix is to drop the `ready` class and that RESTARTS the glow from its
     first keyframe when the turn comes back. Pausing is what keeps it still. */
  await newGame(); check(await waitChoose(), 'game never reached choose (offturn)');
  const rail = () => page.evaluate(() => {
    const b = document.querySelector('#spellBar .rune:not([hidden])');
    if (!b) return null;
    const cs = getComputedStyle(b);
    return { cls: b.className, opacity: +cs.opacity, grey: cs.filter,
             ring: getComputedStyle(b, '::before').animationPlayState, disabled: b.disabled };
  });
  /* vs CPU the rail is always YOURS (near = S.bottom), so the turn is the only
     thing moving here — which is exactly the case the player reported */
  const turnTo = async (who) => {
    await page.evaluate((t) => {
      const k = window.__kb;
      k.S.mode = 'cpu'; k.S.turn = t; k.S.bottom = 1; k.S.busy = false;
      k.S.phase = t === 1 ? 'choose' : 'anim'; k.S.die = 3;
      k.applySides(); k.spells.render();
    }, who);
    await page.waitForTimeout(420);      // .rune transitions opacity/filter over .25s
  };
  await turnTo(0); out.theirTurn = await rail();
  await turnTo(1); out.myTurn = await rail();
  check(out.theirTurn && /\boffturn\b/.test(out.theirTurn.cls),
    'the wielded rune does not know it is not your turn', out.theirTurn);
  check(out.theirTurn && out.theirTurn.opacity <= 0.6 && out.theirTurn.grey !== 'none',
    'YOUR RUNE LOOKS CASTABLE ON THE OPPONENT\'S TURN', out.theirTurn);
  check(out.theirTurn && out.theirTurn.disabled, 'a dimmed rune must also refuse the press', out.theirTurn);
  // dimmed, not SPENT: nothing was cast, and the two must not look alike
  check(out.theirTurn && !/\bspent\b/.test(out.theirTurn.cls) && out.theirTurn.opacity > 0.3,
    'waiting for your turn must not read as a spent rune', out.theirTurn);
  check(out.theirTurn && out.theirTurn.ring === 'paused',
    'the ring kept animating under the dim — it must pause, so it can resume', out.theirTurn);
  // and the turn coming back gives it all back, ring running from where it was
  check(out.myTurn && !/\boffturn\b/.test(out.myTurn.cls) && out.myTurn.opacity > 0.95
    && out.myTurn.grey === 'none' && out.myTurn.ring === 'running',
    'your own turn did not restore the rune', out.myTurn);

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

  /* FATE IS FINAL (user call, 2026-08-22). It is the one cast that REVEALS —
     it draws the next die from the supply — and no take-back can un-see it.
     Offering the window would be "cast, peek, undo": a free read of what is
     coming, twice a game, at no charge, and in LIMITED a free read of the bag.
     So the press must NOT hand anything back: not the die, not the charge, and
     not the die the bag has already given up. */
  out.fateFinal = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.spell = 'fate'; k.S.localMode = 6; k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0;
    k.newGame();
    for (let i = 0; i < 80; i++) { if (k.S.phase === 'choose') break; await new Promise((r) => setTimeout(r, 100)); }
    k.S.turn = 1; k.S.bottom = 1; k.S.busy = false; k.S.phase = 'choose';
    const bagBefore = k.S.pool.length, dieBefore = k.S.die;
    await k.spells.cast('fate', -1);
    await new Promise((r) => setTimeout(r, 700));
    const bagAfter = k.S.pool.length, dieAfter = k.S.die;
    const offered = k.spells.undoable('fate');
    const undone = k.spells.undo();               // the press the player would make
    const rune = document.querySelector('.rune[data-seat="1"]:not([hidden])');
    return { bagBefore, bagAfter, bagBack: k.S.pool.length, dieBefore, dieAfter,
             dieBack: k.S.die, offered, undone, pending: !!k.S.spellUndo,
             runeClass: rune ? rune.className : '', charges: JSON.stringify(k.S.spellCharges) };
  });
  check(out.fateFinal.bagAfter === out.fateFinal.bagBefore - 1,
    'the redraw did not come out of the bag', out.fateFinal);
  check(!out.fateFinal.offered && !out.fateFinal.pending,
    'FATE STILL OFFERS A TAKE-BACK — the peek at the supply is free', out.fateFinal);
  check(!out.fateFinal.undone && out.fateFinal.dieBack === out.fateFinal.dieAfter,
    'THE REDRAWN DIE WAS HANDED BACK AFTER THE PLAYER HAD SEEN IT', out.fateFinal);
  check(out.fateFinal.bagBack === out.fateFinal.bagAfter,
    'the drawn die crawled back into the bag', out.fateFinal);
  check(out.fateFinal.charges === '[{"fate":2},{"fate":1}]',
    'a final cast gave its charge back', out.fateFinal);
  /* ...and it must READ final: a rune that still says "press again" invites
     exactly the peek this forbids */
  check(/\bspent\b/.test(out.fateFinal.runeClass) || !/\bundo\b/.test(out.fateFinal.runeClass),
    'FATE still reads as takeable back', out.fateFinal.runeClass);

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

  /* ---------- 10a. THE SEAL: two protections, two KINDS of mark ----------
     design/screens/39c-guard-seal.html, approved and shipped. The mark both
     rules used to share said nothing: the same 1px inset ring in two hues,
     below the noise floor on a die that already carries a border and a bloom —
     so a COLUMN SHIELD and a WARD read as one rule wearing two colours. They
     are opposite rules. A shield is the state of being full: nothing on it can
     be spent, ever. A ward is exactly one charge.

     Which is why the block above is not enough on its own. It asks whether the
     column carries `.warded`, and that is the DOM-deep assertion test13 exists
     to warn against: it passed for BOTH rules on every day the two drew the
     same ring. So this measures the SHAPE a player sees — one closed line
     against a line held by one clasp — and then measures what a strike leaves
     behind, which is where the two rules actually part company.

     COLUMN SHIELD with a rune in hand, both protections on the FOE's board, so
     one placement can strike each in turn. */
  /* WHAT A PLAYER ACTUALLY SEES OF ONE COLUMN'S SEAL — in painted ink, on any
     page. getBoundingClientRect on an SVG path reports the FILL box in
     Chromium: the stroke is excluded, so a stand-off built from it reads the
     same 1.6px at every cell size and would go on reading 1.6px after two
     neighbours' strokes had fully overlapped — which, on the frame this used to
     be drawn on, was 0.46px away from happening at the 88px cap. The line is
     1.6px and half of its rendered width lies outside the box on every side, so
     the ink stands 2.4px off the stack (main.css, --seal-out). Everything below
     is measured with that half added back — still, because the probe must go on
     being able to SEE a stroke that scales if one ever comes back. */
  /* THE BEATS, ASKED FOR RATHER THAN TYPED. main.css owns each one
     (--seal-engage / --seal-strike / --seal-snap) and every wait below is a
     multiple of one of them: "measure the RESTING mark" has to outlast the
     engage beat, and the strike probe has to outlast the longest. They were
     typed here as 900 and 45 ticks against a 620ms beat — a margin that was
     spent the first time the beats were slowed, which is the tuning pass this
     block was rewritten in. */
  const cssMs = (k) => page.evaluate((kk) => {
    /* IN MILLISECONDS, WHATEVER UNIT THE BUNDLE CARRIES. The build's CSS
       minifier rewrites `950ms` as `.95s`, so a bare parseFloat reads the beat
       as one millisecond on the very artefact this suite drives — which is
       exactly how the one-shot windows in ui/render.ts were cut to a single
       frame in the shipped build and nowhere else. */
    const v = getComputedStyle(document.documentElement).getPropertyValue(kk).trim();
    const n = parseFloat(v);
    return !(n > 0) ? 0 : /ms$/.test(v) ? n : /s$/.test(v) ? n * 1000 : n;
  }, k);
  const SEAL_ENGAGE = await cssMs('--seal-engage'), SEAL_SNAP = await cssMs('--seal-snap');
  const SEAL_SETTLE = Math.round(SEAL_ENGAGE) + 300;
  /* ...and how long the strike probe watches: the die's flight (300ms) and the
     beat before the strike (120ms, flow/game.ts), the longest seal beat, and
     enough after it to SEE the spent ward's mark leave. */
  const SEAL_TICKS = Math.ceil((420 + SEAL_SNAP + 700) / 40);
  const sealOf = (side, c, pg = page) => pg.evaluate(([sd, cc]) => {
    const col = document.querySelector('#' + sd + 'Board .col[data-col="' + cc + '"]');
    const seal = col.querySelector('.seal');
    const chip = document.querySelectorAll('#' + sd + 'Cols .chip')[cc];
    const plate = document.getElementById('plate' + (sd === 'bot' ? 'Bot' : 'Top'));
    const land = document.documentElement.classList.contains('land');
    const r = (e) => { const b = e.getBoundingClientRect();
      return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    /* PAINTED, not merely present. Both marks live in the one element and the
       stylesheet decides which of them a player sees, so walk up to the column
       multiplying opacity and honouring display — asking the leaf alone would
       count a shield's clasp that is display:none as drawn. */
    const painted = (n) => { let p = n, a = 1;
      while (p && p !== col) { const st = getComputedStyle(p);
        if (st.display === 'none' || st.visibility === 'hidden') return 0;
        a *= +st.opacity; p = p.parentElement; }
      return a; };
    const shown = [...seal.querySelectorAll('path,circle')].filter((n) => painted(n) > 0.05);
    const one = (k) => { const n = shown.find((x) => x.classList.contains(k)); return n ? r(n) : null; };
    /* one user unit, in page pixels — across the seal's own frame and down it.
       The frame is TURNED in landscape, so the two are read off the rotated box
       by swapping them rather than by trusting either axis. */
    const vb = seal.viewBox.baseVal, sr = seal.getBoundingClientRect();
    const ux = (land ? sr.height : sr.width) / vb.width, uy = (land ? sr.width : sr.height) / vb.height;
    /* THE PAINTED CORNER, read off the LINE and not off its `d`. The seal's
       frame used to be a fixed 62x198 reference stretched onto the element, so
       its 18-unit corner grew with the cell — 24.4px painted at an 84px cell
       against .col's flat 18px, and rounder on every bigger phone. That is the
       "wrong border radius" the ward was reported with, and a probe that read
       the arc out of the path data would have gone on reporting 18 forever.
       HOW: the corner arc's centre sits one radius in from the frame's corner
       on both axes, so the closest point of the line to that corner is
       R*(sqrt(2)-1) away from it. Sample the path, convert to painted pixels
       (each axis on its own, so a stretched frame cannot hide inside a mean),
       take the nearest point, and divide it back out. Quadratic near the
       minimum, so sampling error is far below the tolerance. */
    const cornerOf = (n) => {
      if (!n || !n.getTotalLength) return null;
      const L = n.getTotalLength(); if (!(L > 0)) return null;
      const P = []; for (let i = 0; i <= 720; i++) P.push(n.getPointAtLength(L * i / 720));
      const x0 = Math.min(...P.map((p) => p.x)), y0 = Math.min(...P.map((p) => p.y));
      let d = Infinity;
      for (const p of P) d = Math.min(d, Math.hypot((p.x - x0) * ux, (p.y - y0) * uy));
      return +(d / (Math.SQRT2 - 1)).toFixed(2);
    };
    const ink = (n) => { const b = n.getBoundingClientRect();
      const sw = parseFloat(getComputedStyle(n).strokeWidth) || 0;
      const hx = sw * (land ? uy : ux) / 2, hy = sw * (land ? ux : uy) / 2;
      return { x: b.x - hx, y: b.y - hy, w: b.width + 2 * hx, h: b.height + 2 * hy }; };
    const hull = (bs) => bs.length ? {
      x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)),
      w: Math.max(...bs.map((b) => b.x + b.w)) - Math.min(...bs.map((b) => b.x)),
      h: Math.max(...bs.map((b) => b.y + b.h)) - Math.min(...bs.map((b) => b.y)) } : null;
    /* THE LINE is whatever encircles the run — one closed loop for a shield,
       two halves for a ward — so its extent is the union, never the first shape
       found (half a ward reads as a seal sitting on top of the dice). THE WHOLE
       MARK is that plus the clasp, which is the one geometry drawn OUTSIDE the
       seal element and therefore the only part that can reach the nameplate. */
    const box = hull(shown.filter((n) => n.classList.contains('sl') || n.classList.contains('sa')).map(ink));
    const all = hull(shown.map(ink));
    /* THE RUN this one seal encloses: this column, plus every neighbour that
       has given its own mark up to it. Read off the DOM exactly the way the
       beats are (ui/render.ts sealHost), so the stand-off below is measured
       against what the loop actually goes round. */
    const cols = [col];
    for (let n = col.nextElementSibling; n && n.classList.contains('sealmerged'); n = n.nextElementSibling) cols.push(n);
    const run = hull(cols.map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }));
    /* clear space between two boxes; negative means they cross */
    const gap = (a, b2) => a && b2 ? +Math.max(Math.max(b2.x - (a.x + a.w), a.x - (b2.x + b2.w)),
                                               Math.max(b2.y - (a.y + a.h), a.y - (b2.y + b2.h))).toFixed(2) : null;
    /* THE NAMEPLATE PAINTS NOTHING OF ITS OWN — the pill behind the name was
       taken out by request (main.css .plate) — so the honest clearance is to
       what it DRAWS, not to its box, which the clasp does cross by ~0.7px at
       the 88px cap. Both numbers are reported; only the ink one is asserted. */
    let mark = null;
    for (const n of (plate ? plate.querySelectorAll('*') : [])) {
      if (n.children.length) continue;
      const b = n.getBoundingClientRect();
      if (!b.width || !b.height || getComputedStyle(n).visibility === 'hidden') continue;
      const g = gap(all, { x: b.x, y: b.y, w: b.width, h: b.height });
      if (mark === null || g < mark) mark = g;
    }
    const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const rivet = shown.find((n) => n.classList.contains('sv'));
    const line = shown.find((n) => n.classList.contains('sl') || n.classList.contains('sa'));
    const cb = r(col), cr = r(chip);
    return {
      drawn: getComputedStyle(seal).display !== 'none' && shown.length > 0,
      merged: col.classList.contains('sealmerged'),
      spans: cols.length,
      // the first class of each shape is its KIND: sl closed loop, sb bead,
      // sa half-arc, sp clasp half, sv rivet
      parts: shown.map((n) => n.getAttribute('class').split(' ')[0]).sort(),
      /* HOW MANY LINES THE MARK ACTUALLY PAINTS. Distinct geometry, not shape
         count: the bead rides the loop's own path, so a shield that draws one
         outline reports 1 however many elements are on it — and the hairline
         that used to run 3px inside the loop reported 2. */
      lines: [...new Set(shown.map((n) => n.getAttribute('d') || n.tagName))].length,
      geometry: shown.map((n) => n.tagName + ':' + (n.getAttribute('d') || '')).sort().join('|'),
      stroke: line ? getComputedStyle(line).stroke : null,
      // what the line PAINTS across the screen. A 62-wide loop STRETCHED over a
      // run would double this and leave the other axis alone; a loop drawn at
      // the run's own width keeps it.
      thick: line ? +((parseFloat(getComputedStyle(line).strokeWidth) || 0) * (land ? uy : ux)).toFixed(2) : null,
      /* ...and what it paints ACROSS that. One number per axis, because the
         same stretch that rounded the corner also painted the loop's vertical
         sides at a different weight from its horizontal ones. */
      thickCross: line ? +((parseFloat(getComputedStyle(line).strokeWidth) || 0) * (land ? ux : uy)).toFixed(2) : null,
      /* THE CORNER, AND WHAT IT HAS TO MATCH. The line rides the stack's box
         grown by --seal-out on every side, and an outline offset outward from a
         rounded rectangle only stays PARALLEL to it if its radius grows by that
         same offset. The rectangle a player SEES there is the cell — the seat
         and the die share one corner (main.css ".slot,.die") — so the honest
         target is the cell's radius plus the stand-off, one number at every
         cell size. It used to be .col's, 4px rounder and painting nothing: the
         mark ran flush to the dice down the sides and bowed away from them at
         the corners, which is "the radius is still too strong", reported. */
      corner: cornerOf(line), cell: +parseFloat(getComputedStyle(col.querySelector('.slot')).borderRadius).toFixed(2),
      standoff: +parseFloat(getComputedStyle(seal).getPropertyValue('--seal-out')).toFixed(2),
      col: cb, loop: one('sl'), arc: one('sal'),
      clasp: rivet ? r(seal.querySelector('.sclasp')) : null,
      // how far the painted line stands OUTSIDE the run, on each side
      out: box && run && { l: +(run.x - box.x).toFixed(2), t: +(run.y - box.y).toFixed(2),
                           r: +(box.x + box.w - run.x - run.w).toFixed(2), b: +(box.y + box.h - run.y - run.h).toFixed(2) },
      toChip: gap(all, cr), toPlate: gap(all, plate ? r(plate) : null), toPlateInk: mark,
      // where the mouth sits relative to the column, and where the chip strip
      // does: the seal must close at the end AWAY from the chips
      mouth: rivet ? { dx: +(mid(r(rivet)).x - mid(cb).x).toFixed(1), dy: +(mid(r(rivet)).y - mid(cb).y).toFixed(1) } : null,
      chipAt: { dx: +(mid(cr).x - mid(cb).x).toFixed(1), dy: +(mid(cr).y - mid(cb).y).toFixed(1) },
      onDie: [...col.querySelectorAll('.die')].some((d) => {
        const b = r(d); return !!box && (b.x < box.x || b.y < box.y
          || b.x + b.w > box.x + box.w || b.y + b.h > box.y + box.h); }),
    };
  }, [side, c]);

  /* THE CORNER IS THE CELL'S, AT EVERY CELL SIZE — asserted through one
     helper wherever a seal is measured (this phone, the 88px cap, landscape,
     and every span), because the first defect was that the number moved with
     the cell and a single viewport could not see it, and the second was that
     it was parallel to the wrong rectangle at ALL of them. --seal-out and the
     cell's radius are both READ, never typed here, so the mark and its guard
     cannot drift apart. */
  const cornerOk = (name, s, where) => {
    check(s.corner !== null && Math.abs(s.corner - (s.cell + s.standoff)) < 0.75,
      'THE ' + name.toUpperCase() + ' SEAL DOES NOT WEAR THE CELL\'S CORNER in ' + where
      + ' — its line must run parallel to the dice it encloses, corners included',
      { painted: s.corner, want: s.cell + s.standoff, cell: s.cell, standoff: s.standoff });
    check(s.thick !== null && Math.abs(s.thick - s.thickCross) < 0.15,
      'the ' + name + ' seal paints its two axes at different weights in ' + where,
      { along: s.thick, across: s.thickCross });
  };
  /* EVERY RING A COLUMN PAINTS, in one list per column. The seal says "this
     column is protected"; .col.legal::after says "you may play here this turn".
     Both are true of a warded column with room left, and until now both drew a
     ring — the seal's line 1.6px outside the column box, the hint's dashed one
     at 4px — so the player saw ONE DOUBLED EDGE 2.4px thick and reported it as
     a rendering fault (photographed). The fix is not to drop a fact: it is that
     the hint is not a ring but a STATE the column's outline wears, so where a
     seal is drawn the seal carries it and the pseudo stands down. This measures
     what the fix has to keep true — never two, and never none. */
  const outlinesOf = (pg = page) => pg.evaluate(() => {
    const drawn = (n, col) => { let p = n, a = 1;
      while (p && p !== col) { const st = getComputedStyle(p);
        if (st.display === 'none' || st.visibility === 'hidden') return 0;
        a *= +st.opacity; p = p.parentElement; }
      return a; };
    const pseudo = (col, at) => { const s = getComputedStyle(col, at);
      const w = parseFloat(s.borderTopWidth) || 0;
      return (s.content !== 'none' && s.display !== 'none' && w > 0
        && s.borderTopStyle !== 'none' && +s.opacity > 0.05)
        ? at + '(' + s.borderTopStyle + ' ' + +w.toFixed(1) + 'px @' + parseFloat(s.top) + 'px)' : null;
    };
    return [...document.querySelectorAll('#topBoard .col,#botBoard .col')].map((col) => {
      const seal = col.querySelector('.seal');
      const lit = !!seal && getComputedStyle(seal).display !== 'none'
        && [...seal.querySelectorAll('path,circle')].some((n) => drawn(n, col) > 0.05);
      return { id: col.closest('.board').id + '#' + col.dataset.col,
        cls: [...col.classList].filter((c) => c !== 'col').sort().join('.'),
        rings: [lit ? 'seal' : null, pseudo(col, '::after'), pseudo(col, '::before')].filter(Boolean) };
    });
  });
  const oneOutline = (list, where) => {
    check(list.every((o) => o.rings.length <= 1),
      'A COLUMN WEARS TWO OUTLINES in ' + where + ' — two rings 2.4px apart read as one doubled edge',
      list.filter((o) => o.rings.length > 1));
    /* ...and the other half of the same rule, which is what stops "one outline"
       being solved by deleting one: never NONE either. A column you may play
       into has to say so, sealed or bare. */
    const playable = list.filter((o) => /(^|\.)legal(\.|$)/.test(o.cls));
    check(playable.length > 0 && playable.every((o) => o.rings.length >= 1),
      'A PLAYABLE COLUMN LOST ITS AFFORDANCE in ' + where
      + ' — every column you may play into must still wear a ring',
      playable.filter((o) => !o.rings.length));
  };

  await newGame({ spell: 'ward', mode: 3 });   // 3 = COLUMN SHIELD (core/modes)
  check(await waitChoose(), 'game never reached choose (seal)');
  await table([[], [], []], [[5, 5, 2], [4], []], 5);
  await guard();
  /* THE CLASS OUTLIVES ITS OWN ANIMATION. main.css owns each beat and
     ui/render.ts holds the one-shot class on for it — one number, two files —
     and the day they part the mark stops drawing itself: the class comes off
     mid-draw and the line snaps in fully formed. They DID part, silently, the
     moment the beats became tokens (the minifier ships `950ms` as `.95s`, and
     the read was a bare parseFloat). Nothing else in this suite could see it —
     every assertion here waits for the beat to be OVER — so the window is
     measured on the way in. */
  out.sealWindow = await page.evaluate(async (beat) => {
    const col = document.querySelector('#topBoard .col[data-col="1"]');   // the ward just cast
    const t0 = performance.now();
    let held = 0;
    for (let i = 0; i < 120; i++) {
      if (!col.classList.contains('sealon')) break;
      held = performance.now() - t0;
      await new Promise((r) => setTimeout(r, 25));
    }
    return { held: Math.round(held), beat };
  }, SEAL_ENGAGE);
  check(out.sealWindow.held > SEAL_ENGAGE * 0.9,
    'THE ENGAGE BEAT IS CUT SHORT — the seal is given less time than its own animation, so the line never draws',
    out.sealWindow);
  await page.waitForTimeout(SEAL_SETTLE);       // the engage beat is over; measure the RESTING mark
  out.sealShield = await sealOf('top', 0);
  out.sealWard = await sealOf('top', 1);
  check(out.sealShield.drawn && out.sealWard.drawn, 'A PROTECTION WITH NO SEAL IS INVISIBLE',
    { shield: out.sealShield.parts, ward: out.sealWard.parts });
  check(out.sealShield.geometry !== out.sealWard.geometry,
    'THE SHIELD AND THE WARD DRAW THE SAME MARK — two opposite rules in two colours',
    { shield: out.sealShield.parts, ward: out.sealWard.parts });
  check(out.sealShield.parts.includes('sl')
    && !out.sealShield.parts.includes('sa') && !out.sealShield.parts.includes('sv'),
    'the shield must draw ONE closed line, with no seam and nothing to spend', out.sealShield.parts);
  /* ...and ONE means one. The loop carried a hairline copy of itself 3px inside
     it, meant as weight and read as a second outline — photographed, and by the
     same player who reported the doubled edge §10a-v exists to keep out. That
     one came from outside the seal, this one from inside its own group, and
     both look identical from the sofa. */
  check(out.sealShield.lines === 1,
    'THE SHIELD PAINTS A SECOND LINE INSIDE ITS OWN — a mark 3px in is an outline, not weight',
    { lines: out.sealShield.lines, parts: out.sealShield.parts });
  check(out.sealWard.parts.filter((p) => p === 'sa').length === 2 && out.sealWard.parts.includes('sv')
    && !out.sealWard.parts.includes('sl'),
    'the ward must draw a line held by ONE clasp', out.sealWard.parts);
  /* CLOSED against CLASPED, in pixels: the shield's line goes the whole way
     round, each of the ward's halves covers about half of it, and only the ward
     carries a fastening — small, on the line, at the column's mouth. */
  check(!!out.sealWard.arc && !!out.sealShield.loop
    && out.sealWard.arc.w * out.sealWard.arc.h < out.sealShield.loop.w * out.sealShield.loop.h * 0.6,
    "the ward's halves must not each go the whole way round", { shield: out.sealShield.loop, arc: out.sealWard.arc });
  check(!!out.sealWard.clasp && !!out.sealShield.loop && out.sealWard.clasp.w > 3
    && out.sealWard.clasp.w < out.sealShield.loop.w * 0.4,
    'the clasp carries the whole "this one can break" reading and must be a fastening, not a second ring',
    out.sealWard.clasp);
  check(out.sealShield.stroke !== out.sealWard.stroke, 'the two seals wear one hue',
    { shield: out.sealShield.stroke, ward: out.sealWard.stroke });
  /* A WARD BESIDE A SHIELD IS STILL ITS OWN MARK. Only shields merge (§10a-i):
     a ward is ONE charge on ONE column, and a line drawn round two of them
     would say something false. So these two neighbours draw two lines 6px
     apart, whose INK is 1.2px apart at every cell size — it was 0.46px at the
     88px cap while the stroke still scaled with the cell. The only thing
     keeping them legible is that they are two different hues, which is what the
     stroke assertion above is really guarding. */
  check(!out.sealWard.merged && out.sealWard.spans === 1 && out.sealShield.spans === 1,
    'a WARD was swallowed by its neighbour\'s seal', { ward: out.sealWard.spans, shield: out.sealShield.spans });
  /* IT COSTS THE DICE NOTHING, it never touches the chip strip, and it never
     reaches the nameplate. The painted line stands OUTSIDE the run on all four
     sides by less than half the 6px gutter — 2.4px, or 2.6px where the seal is
     carrying the placement hint, which is the entire budget a seal has before
     its ink meets a neighbour's. */
  for (const [name, s] of [['shield', out.sealShield], ['ward', out.sealWard]]) {
    check(!!s.out && Object.values(s.out).every((v) => v > 0.3 && v < 3),
      'the ' + name + " seal must sit just outside the stack — over a die, or into the neighbour's gutter",
      s.out);
    check(!s.onDie, 'the ' + name + ' seal crosses a die face', s);
    check(s.toChip > 0.5, 'THE ' + name.toUpperCase() + ' SEAL REACHES THE COLUMN CHIP', { gap: s.toChip });
    check(s.toPlateInk > 0.5, 'THE ' + name.toUpperCase() + ' SEAL REACHES THE NAMEPLATE',
      { ink: s.toPlateInk, box: s.toPlate });
    cornerOk(name, s, 'portrait/390');
  }
  /* IT MUST NOT STROBE. renderSide repaints on every placement; a draw-on keyed
     to a class that merely persists restarts wherever the element is rebuilt —
     the flicker flow/spells.ts records against the rune's glow. At rest the
     seal may run its one circling bead AND NOTHING ELSE: the clasp's heartbeat
     used to run here too, on three shapes inside a display:none group, which is
     exactly the kind of thing a states-length check cannot see. */
  out.sealSteady = await page.evaluate(async () => {
    const k = window.__kb, seen = new Set();
    for (let i = 0; i < 6; i++) {
      k.renderAll(false);
      await new Promise((r) => setTimeout(r, 70));
      seen.add(document.querySelector('#topBoard .col[data-col="0"] .seal')
        .getAnimations({ subtree: true }).map((a) => a.animationName).sort().join(','));
    }
    return { states: [...seen] };
  });
  check(out.sealSteady.states.length === 1 && !out.sealSteady.states[0].includes('sealdraw'),
    'THE SEAL REDRAWS ITSELF ON EVERY REPAINT', out.sealSteady);
  check(out.sealSteady.states[0] === 'sealrun',
    'a resting SHIELD runs more than its one circling bead', out.sealSteady);

  /* ---------- 10a-i. A STRIKE MEETS A PROTECTION, AND IT IS SEEN ----------
     shieldBlocked() and wardBurned() (ui/render.ts) were extracted from two
     copies precisely so both drivers say the beat once — and nothing asserted
     that either says anything AT ALL. An implementation that returned early,
     reached for the wrong selector, or never added the class passes every other
     assertion in this file, because the only strike check here compares the
     settled board a second and a half later. So play the die and WATCH: which
     animations run, which one-shot marks land on the column and its chip, and
     whether the seal is still painted once the charm behind it is spent. */
  const strikeBeat = (side, c, who, at) => page.evaluate(async ([sd, cc, w, a, ticks]) => {
    const k = window.__kb;
    const col = document.querySelector('#' + sd + 'Board .col[data-col="' + cc + '"]');
    const chip = document.querySelectorAll('#' + sd + 'Cols .chip')[cc];
    // is ANY part of this column's seal on screen right now?
    const lit = () => { let best = 0;
      for (const n of col.querySelectorAll('.seal path,.seal circle')) {
        let p = n, o = 1, ok = true;
        while (p && p !== col) { const st = getComputedStyle(p);
          if (st.display === 'none' || st.visibility === 'hidden') { ok = false; break; }
          o *= +st.opacity; p = p.parentElement; }
        if (ok && o > best) best = o; }
      return best; };
    /* ...and the column whose seal that IS. A merged run draws one mark on its
       first column, so a strike inside the run has to flare THERE — flaring the
       struck column would run the whole beat on a display:none element. */
    let host = col;
    while (host && host.classList.contains('sealmerged')) host = host.previousElementSibling;
    const anims = new Set(), marks = new Set(), flare = new Set();
    const hostAnims = new Set(), hostMarks = new Set();
    let outlived = false, gone = false;
    void k.place(w, a);                        // polled, not awaited: the beat is the subject
    for (let i = 0; i < ticks; i++) {
      await new Promise((r) => setTimeout(r, 40));
      for (const an of col.getAnimations({ subtree: true })) anims.add(an.animationName);
      for (const an of chip.getAnimations({ subtree: true })) anims.add(an.animationName);
      for (const cl of col.classList) marks.add(cl);
      for (const an of host.getAnimations({ subtree: true })) hostAnims.add(an.animationName);
      for (const cl of host.classList) hostMarks.add(cl);
      for (const n of chip.querySelectorAll('.sh,.wd')) for (const cl of n.classList) flare.add(n.classList[0] + ':' + cl);
      const spent = k.S.charm.wards[0][cc] === 0;
      if (spent && lit() > 0.05) outlived = true;
      if (spent && lit() <= 0.05) gone = true;
    }
    return { anims: [...anims].sort(), marks: [...marks].sort(), flare: [...flare].sort(),
             hostAnims: [...hostAnims].sort(), hostMarks: [...hostMarks].sort(),
             outlived, gone, wards: JSON.stringify(k.S.charm.wards), theirs: JSON.stringify(k.S.boards[0][cc]) };
  }, [side, c, who, at, SEAL_TICKS]);

  /* STRUCK. A shield has nothing on it to take away, so it flares and hardens
     and the line after the blow is the line before it, to the pixel. */
  out.shieldStruck = await strikeBeat('top', 0, 1, 0);
  check(out.shieldStruck.flare.includes('sh:block'),
    'A BLOCKED STRIKE SAID NOTHING — the shield on the chip never flared', out.shieldStruck.flare);
  check(out.shieldStruck.anims.includes('shblock'),
    'the shield chip wore the mark but never ran its flare', out.shieldStruck.anims);
  check(out.shieldStruck.marks.includes('sealhit'),
    'THE SEAL DID NOT ANSWER THE STRIKE', out.shieldStruck.marks);
  check(out.shieldStruck.anims.includes('sealharden') && out.shieldStruck.anims.includes('sealrepel'),
    'the seal wore the strike class but nothing hardened', out.shieldStruck.anims);
  check(!out.shieldStruck.gone, 'the struck shield left the column', out.shieldStruck);
  out.sealHeld = await sealOf('top', 0);
  check(out.sealHeld.drawn && JSON.stringify(out.sealHeld.loop) === JSON.stringify(out.sealShield.loop)
    && String(out.sealHeld.parts) === String(out.sealShield.parts),
    'A STRUCK SHIELD CHANGED — a full column cannot be destroyed, so its seal cannot be spent',
    { before: out.sealShield.loop, after: out.sealHeld.loop, parts: out.sealHeld.parts });
  check(await page.evaluate(() => JSON.stringify(window.__kb.S.boards[0][0])) === '[5,5,2]',
    'the shielded column lost dice');

  /* SPENT. The ward is one charge: the strike snaps the clasp, the line unwinds
     off the column and does not come back — and it has to be SEEN leaving, so
     the mark outlives the charge by the length of its own beat. The last state
     is the honest one: dice, and no protection. */
  await table([[], [], []], [[5, 5, 2], [4], []], 4);
  await guard();
  await page.waitForTimeout(SEAL_SETTLE);
  out.wardStruck = await strikeBeat('top', 1, 1, 1);
  check(out.wardStruck.theirs === '[4]', 'the ward did not absorb the strike', out.wardStruck);
  check(out.wardStruck.wards === '[[0,0,0],[0,0,0]]', 'the ward was not spent', out.wardStruck);
  check(out.wardStruck.flare.includes('wd:block'),
    'A BURNED WARD SAID NOTHING — the rune on the chip never flared', out.wardStruck.flare);
  check(out.wardStruck.anims.includes('wdblock'),
    'the ward chip wore the mark but never ran its flare', out.wardStruck.anims);
  check(out.wardStruck.marks.includes('sealsnap'), 'THE CLASP NEVER SNAPPED', out.wardStruck.marks);
  check(['sealpop', 'sealsnapoff', 'sealunwind'].every((a) => out.wardStruck.anims.includes(a)),
    'the ward left the column without the clasp failing first', out.wardStruck.anims);
  check(out.wardStruck.outlived, 'THE WARD VANISHED INSTEAD OF BREAKING — the snap is never seen', out.wardStruck);
  check(out.wardStruck.gone, 'a spent ward left its seal standing', out.wardStruck);
  out.sealAfter = await sealOf('top', 1);
  check(!out.sealAfter.drawn, 'the after-state must be dice and NO protection', out.sealAfter);

  /* ---------- 10a-ii. TWO SEALED NEIGHBOURS ARE ONE SEAL ----------
     Two shielded columns side by side used to draw two closed loops 6px apart,
     and their painted strokes leave 1.2px of gutter between them (0.46px at the
     88px cap on the stretched frame this replaced) — already one smeared band,
     said twice. So the drawing tells the truth: ONE enclosure round the run.
     It is safe to say because A SHIELD NEVER LIFTS. A COLUMN SHIELD column is
     shielded because it is FULL; victimsOf() gives a full column no victims,
     PILFER refuses to rob one and WARD refuses to mark one (core/rules,
     core/spells), so a run can only ever grow and no seal has to come apart
     mid-game. If any of those three ever stops being true, this block is where
     the un-merge beat it would need goes missing. */
  await table([[], [], []], [[5, 5, 2], [6, 6], []], 5);
  await page.waitForTimeout(SEAL_SETTLE);
  out.sealLone = await sealOf('top', 0);
  /* ...and it arrives as a BEAT, on the placement that fills the neighbour: the
     longer mark draws itself shut. It does not appear between two frames. */
  out.sealGrew = await page.evaluate(async () => {
    const k = window.__kb, col = document.querySelector('#topBoard .col[data-col="0"]');
    k.S.boards[0][1] = [6, 6, 1];              // the neighbour fills: the run grows
    k.renderAll(false);
    const anims = new Set(); let on = false;
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 40));
      for (const a of col.getAnimations({ subtree: true })) anims.add(a.animationName);
      if (col.classList.contains('sealon')) on = true;
    }
    return { anims: [...anims].sort(), on };
  });
  await page.waitForTimeout(SEAL_SETTLE);
  out.sealRun = await sealOf('top', 0);
  out.sealInside = await sealOf('top', 1);
  check(out.sealGrew.on && out.sealGrew.anims.includes('sealdraw'),
    'A RUN THAT GREW NEVER REDREW — the longer seal appeared between frames', out.sealGrew);
  check(out.sealRun.spans === 2 && out.sealRun.parts.includes('sl'),
    'two shielded neighbours did not become one seal', { spans: out.sealRun.spans, parts: out.sealRun.parts });
  check(out.sealInside.merged && !out.sealInside.drawn,
    'BOTH NEIGHBOURS STILL DRAW A SEAL — two lines 1.2px apart read as one smear', out.sealInside);
  check(!!out.sealRun.out && Object.values(out.sealRun.out).every((v) => v > 0.3 && v < 3),
    'the merged seal does not enclose the whole run', { out: out.sealRun.out, spans: out.sealRun.spans });
  /* ONE loop, round BOTH columns, AT THE SAME WEIGHT. A single 62-wide loop
     stretched across two columns would paint its vertical sides twice as thick
     as its horizontal ones and round its corners into ellipses, so the line's
     rendered width is what proves the frame GREW rather than being stretched. */
  check(Math.abs(out.sealRun.thick - out.sealLone.thick) < 0.3,
    'THE MERGED SEAL WAS STRETCHED, NOT GROWN — its line is a different weight',
    { lone: out.sealLone.thick, run: out.sealRun.thick });
  /* ...and the corner is the SAME corner however many columns the loop goes
     round. A frame that grows with the run keeps it; one stretched across the
     run does not, and the wider the run the flatter it gets. */
  cornerOk('merged', out.sealRun, 'portrait/390 span 2');
  check(Math.abs(out.sealRun.corner - out.sealLone.corner) < 0.5,
    'the merged seal rounded its corners differently from the lone one',
    { lone: out.sealLone.corner, run: out.sealRun.corner });
  check(out.sealRun.toChip > 0.5 && out.sealRun.toPlateInk > 0.5,
    'the merged seal reaches the chip strip or the nameplate',
    { chip: out.sealRun.toChip, plate: out.sealRun.toPlateInk });
  // ...and a third neighbour joins the same one mark rather than starting a second
  await page.evaluate(() => { window.__kb.S.boards[0][2] = [3, 3, 3]; window.__kb.renderAll(false); });
  await page.waitForTimeout(SEAL_SETTLE);
  out.sealRun3 = await sealOf('top', 0);
  out.sealRun3b = [await sealOf('top', 1), await sealOf('top', 2)];
  check(out.sealRun3.spans === 3 && !!out.sealRun3.out
    && Object.values(out.sealRun3.out).every((v) => v > 0.3 && v < 3),
    'a third sealed neighbour did not join the run', { spans: out.sealRun3.spans, out: out.sealRun3.out });
  cornerOk('merged', out.sealRun3, 'portrait/390 span 3');
  check(out.sealRun3b.every((s) => s.merged && !s.drawn),
    'a column INSIDE the run still draws a seal of its own', out.sealRun3b.map((s) => s.parts));
  /* AND A STRIKE INSIDE THE RUN FLARES THE MARK THAT EXISTS. The chip's shield
     still belongs to the struck column — every column in the run really is
     shielded — but the seal belongs to whoever is carrying it, so the beat has
     to travel (ui/render.ts sealHost). Aimed at the struck column it would run
     the whole harden on a display:none element and the player would see the
     chip twitch beside a line that never answered. */
  await table([[], [], []], [[5, 5, 2], [6, 6, 1], []], 6);
  await page.waitForTimeout(SEAL_SETTLE);
  out.runStruck = await strikeBeat('top', 1, 1, 1);
  check(out.runStruck.flare.includes('sh:block'),
    'a strike inside a run never flared the struck column\'s chip', out.runStruck.flare);
  check(out.runStruck.hostMarks.includes('sealhit') && out.runStruck.hostAnims.includes('sealharden'),
    'THE MERGED SEAL DID NOT ANSWER A STRIKE ON THE COLUMN IT ENCLOSES', out.runStruck);
  check(!out.runStruck.marks.includes('sealhit'),
    'the beat played on the hidden seal of the struck column instead of the run\'s', out.runStruck.marks);
  check(await page.evaluate(() => JSON.stringify(window.__kb.S.boards[0][1])) === '[6,6,1]',
    'a column inside the run lost dice');

  /* ---------- 10a-iii. reduced motion still tells them apart ----------
     Every beat above is one-shot and collapses to its end state under the OS
     setting, which is exactly why the DISTINCTION may not live in the
     animation. With motion reduced the two marks must still be there and still
     be two different shapes. */
  {
    const { ctx: rctx, page: rp } = await sidePage({ name: 'reduce', device: devices['iPhone 13'], opts: { reducedMotion: 'reduce' } });
    await newGame({ spell: 'ward', mode: 3 }, rp);
    check(await waitChoose(rp), 'game never reached choose (reduced motion)');
    await table([[], [], []], [[5, 5, 2], [4], []], 5, rp);
    await guard(1, 0, rp);
    await rp.waitForTimeout(400);
    out.sealReduced = await rp.evaluate(() => {
      const look = (c) => {
        const col = document.querySelector('#topBoard .col[data-col="' + c + '"]');
        const shown = [...col.querySelectorAll('.seal path,.seal circle')].filter((n) => {
          let p = n, a = 1;
          while (p && p !== col) { const st = getComputedStyle(p);
            if (st.display === 'none') return 0; a *= +st.opacity; p = p.parentElement; }
          return a > 0.05;
        });
        return { parts: shown.map((n) => n.getAttribute('class').split(' ')[0]).sort(),
                 shape: shown.map((n) => n.getAttribute('d') || n.tagName).sort().join('|'),
                 // the line is fully drawn, not frozen part-way through a draw-on
                 offsets: shown.map((n) => getComputedStyle(n).strokeDashoffset) };
      };
      return { reduced: window.__kb.reduced, shield: look(0), ward: look(1) };
    });
    await rctx.close();
    check(out.sealReduced.reduced, 'the reduced-motion probe did not get the setting', out.sealReduced);
    check(out.sealReduced.shield.parts.includes('sl') && out.sealReduced.ward.parts.includes('sv'),
      'WITH MOTION REDUCED A PLAYER CANNOT TELL A SHIELD FROM A WARD', out.sealReduced);
    check(out.sealReduced.shield.shape !== out.sealReduced.ward.shape,
      'the two seals collapse to the same shape with motion reduced', out.sealReduced);
    check(!out.sealReduced.shield.parts.includes('sb'),
      'the circling bead froze mid-travel and left a stray tick on the loop', out.sealReduced.shield);
    check(out.sealReduced.ward.offsets.every((o) => parseFloat(o) === 0),
      'a seal froze part-drawn with motion reduced', out.sealReduced.ward);
  }

  /* ---------- 10a-iv. THE SAME MARK, TURNED ----------
     --seal-turn ships FOUR values — one per half, per orientation — and until
     now no suite put a seal on a landscape table at all. The turn decides where
     the MOUTH goes, and the rule is that the mouth is the end AWAY from the
     chip strip (which is also the end the next die lands at). A sign flip on
     either rotate() would have put the ward's clasp on the chip strip with
     nothing here going red. The clasp is the only mouth a resting seal SHOWS —
     the shield's join sits at opacity 0 — but both kinds read the one token, so
     measuring the ward measures the turn.
     BOTH HALVES, because their turns are opposite; and the portrait viewport is
     deliberately the widest the cell cap allows — at 88px the ink stands
     furthest out and every clearance here is at its tightest. */
  for (const view of [{ name: 'portrait', w: 430, h: 932 }, { name: 'landscape', w: 667, h: 375 }]) {
    const { ctx: vctx, page: vp } = await sidePage(view);
    await newGame({ spell: 'ward', mode: 3 }, vp);
    check(await waitChoose(vp), 'game never reached choose (turn/' + view.name + ')');
    await table([[3, 3, 1], [], []], [[5, 5, 2], [4], []], 5, vp);
    await guard(1, 0, vp); await guard(1, 1, vp);      // a ward on column 1 of each half
    await vp.waitForTimeout(SEAL_SETTLE);
    const turn = {
      land: await vp.evaluate(() => document.documentElement.classList.contains('land')),
      cell: await vp.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cell')),
    };
    for (const half of ['top', 'bot']) {
      turn[half + 'Shield'] = await sealOf(half, 0, vp);
      turn[half + 'Ward'] = await sealOf(half, 1, vp);
    }
    /* RECORDED, NOT ASSERTED — a real defect, and not one the seal can fix
       from here. At 667x375 `fit()`'s landscape width budget (ui/layout.ts)
       lands on a 75px cell that puts BOTH boards flush against the screen
       edges, and the seal is drawn outside the stack: the line's ink is clipped
       by ~1.9px and the ward's clasp — which straddles the mouth, outside the
       element — by ~6.1px, so half the diamond that carries "this one can
       break" is off the edge. Pre-existing and unrelated to merging: it is the
       same at span 1 as at span 3, and it is the same for a lone ward. Every
       wider landscape has room to spare (the cell caps at 84 from 844px up,
       where the ink clears the edge by ~59px), and portrait is never close.
       Left here as a number rather than a red gate because the lane budget that
       would fix it lives in a file the seal work may not touch — but the next
       person to open ui/layout.ts should spend ~8px per side on it. */
    turn.inkEdge = await vp.evaluate(() => {
      let lo = Infinity, hi = -Infinity;
      for (const n of document.querySelectorAll('.col>.seal path,.col>.seal circle')) {
        const col = n.closest('.col'); let p = n, ok = true;
        while (p && p !== col) { const st = getComputedStyle(p);
          if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity < 0.05) { ok = false; break; }
          p = p.parentElement; }
        if (!ok) continue;
        const seal = n.closest('.seal'), vb = seal.viewBox.baseVal, sr = seal.getBoundingClientRect();
        const land = document.documentElement.classList.contains('land');
        const hx = (parseFloat(getComputedStyle(n).strokeWidth) || 0)
                 * (land ? sr.width / vb.height : sr.width / vb.width) / 2;
        const b = n.getBoundingClientRect();
        lo = Math.min(lo, b.x - hx); hi = Math.max(hi, b.x + b.width + hx);
      }
      return { left: +lo.toFixed(2), right: +(window.innerWidth - hi).toFixed(2) };
    });
    out['sealTurn_' + view.name] = turn;
    check(turn.land === (view.name === 'landscape'), 'the seal-turn probe was in the wrong orientation', turn.land);
    for (const half of ['top', 'bot']) {
      const sh = turn[half + 'Shield'], wd = turn[half + 'Ward'], where = view.name + '/' + half;
      check(sh.drawn && wd.drawn, 'a protection lost its seal in ' + where, { shield: sh.parts, ward: wd.parts });
      check(!!wd.mouth && wd.mouth.dx * wd.chipAt.dx + wd.mouth.dy * wd.chipAt.dy < 0,
        'THE SEAL CLOSES ON THE CHIP STRIP in ' + where + ' — the mouth belongs at the far end',
        { mouth: wd.mouth, chip: wd.chipAt });
      for (const [name, s] of [['shield', sh], ['ward', wd]]) {
        check(!!s.out && Object.values(s.out).every((v) => v > 0.3 && v < 3),
          'the ' + name + ' seal left the stack in ' + where, s.out);
        check(!s.onDie, 'the ' + name + ' seal crosses a die face in ' + where, s);
        check(s.toChip > 0.5, 'the ' + name + ' seal reaches the column chip in ' + where, { gap: s.toChip });
        check(s.toPlateInk > 0.5, 'the ' + name + ' seal reaches the nameplate in ' + where,
          { ink: s.toPlateInk, box: s.toPlate });
        cornerOk(name, s, where + '/cell ' + turn.cell.trim());
      }
    }
    /* ONE OUTLINE, HERE TOO — and this is the scene the report came from: the
       near half's column 1 carries a ward AND has room left, so it is `.legal`
       and `.warded` at once. Both viewports, because the doubling gets worse as
       the cell grows and 430x932 is the widest the cap allows. */
    out['sealOutlines_' + view.name] = await outlinesOf(vp);
    oneOutline(out['sealOutlines_' + view.name], view.name);
    /* ...and a run is the same geometry turned with it: across the screen in
       portrait, DOWN it in landscape. One offset token, two orientations. */
    await vp.evaluate(() => { window.__kb.S.boards[0][1] = [6, 6, 1]; window.__kb.renderAll(false); });
    await vp.waitForTimeout(SEAL_SETTLE);
    const run = await sealOf('top', 0, vp), inside = await sealOf('top', 1, vp);
    out['sealTurnRun_' + view.name] = { run, merged: inside.merged, drawn: inside.drawn };
    check(run.spans === 2 && !!run.out && Object.values(run.out).every((v) => v > 0.3 && v < 3),
      'the merged seal does not enclose its run in ' + view.name, { out: run.out, spans: run.spans });
    check(inside.merged && !inside.drawn, 'the run drew two seals in ' + view.name, inside.parts);
    await vctx.close();
  }

  /* ---------- 10a-v. A PROTECTED COLUMN YOU MAY PLAY INTO ----------
     The reported scene, on the phone it was reported from: your own column,
     warded, with room left. It is `.warded` and `.legal` at the same time and
     the two statements used to be two rings — the seal's line 1.6px outside the
     column box and the placement hint's dashed ring at 4px, 2.4px of gap
     between them, which is one doubled edge to look at.
     BOTH FACTS SURVIVE. The hint stands down as a RING only, and the seal it
     stood down for takes the hint up: the line goes to full strength, thickens,
     and breathes on the hint's own beat. So the column still answers "you may
     play here" — with the outline it already had, instead of a second one.
     A column with NO seal is untouched, and that is asserted here rather than
     assumed: the dashed ring is the affordance the whole placement flow rests
     on, and it is also the aim ring (docs/SPELLS.md §7). */
  await newGame({ spell: 'ward', mode: 3 });
  check(await waitChoose(), 'game never reached choose (one outline)');
  await table([[], [4], []], [[5, 5, 2], [], []], 5);
  await guard(1, 1);                            // MY column 1: a ward, and room left
  await page.waitForTimeout(SEAL_SETTLE);
  out.outlines = await outlinesOf();
  oneOutline(out.outlines, 'portrait/390');
  out.bare = out.outlines.find((o) => o.id === 'botBoard#0');
  check(!!out.bare && out.bare.rings.length === 1 && /^::after\(dashed [\d.]+px @-4px\)$/.test(out.bare.rings[0]),
    'A COLUMN WITH NO SEAL LOST THE HINT IT HAS ALWAYS HAD — that ring is the whole placement flow',
    out.bare);
  out.sealedLegal = out.outlines.find((o) => o.id === 'botBoard#1');
  check(!!out.sealedLegal && /legal/.test(out.sealedLegal.cls) && /warded/.test(out.sealedLegal.cls)
    && String(out.sealedLegal.rings) === 'seal',
    'the warded column a player may play into must wear ITS SEAL and nothing else', out.sealedLegal);
  /* ...and the seal is visibly carrying the hint, not merely surviving it. In
     computed pixels and in animations, and compared against the SAME seal with
     the hint taken away — a static probe cannot tell "lit" from "drawn". */
  out.hintWorn = await page.evaluate(() => {
    const col = document.querySelector('#botBoard .col[data-col="1"]');
    const seal = col.querySelector('.seal'), line = seal.querySelector('.sal');
    const read = () => ({ w: getComputedStyle(line).strokeWidth,
      anim: seal.getAnimations({ subtree: true }).map((a) => a.animationName).sort().join(',') });
    const on = read();
    col.classList.remove('legal');
    const off = read();
    col.classList.add('legal');
    return { on, off };
  });
  check(parseFloat(out.hintWorn.on.w) > parseFloat(out.hintWorn.off.w),
    'A PLAYABLE PROTECTED COLUMN SAYS NOTHING — the hint stood down and the seal never took it up',
    out.hintWorn);
  check(out.hintWorn.on.anim.includes('sealready') && !out.hintWorn.off.anim.includes('sealready'),
    'the seal on a playable column does not breathe on the hint\'s beat', out.hintWorn);
  /* AND THE AIM RING STILL WINS. While a spell aims, the hints stand down and
     the ::after becomes the aim ring on the columns the cast can land on — the
     rule that hides hints hid it once already (docs/SPELLS.md §7). A sealed
     column is aimable like any other, so it must show that ring even though its
     hint is the seal. */
  out.aimRing = await page.evaluate(() => {
    const col = document.querySelector('#botBoard .col[data-col="1"]');
    document.documentElement.classList.add('casting'); col.classList.add('aim');
    const s = getComputedStyle(col, '::after');
    const r = { display: s.display, w: s.borderTopWidth, style: s.borderTopStyle };
    col.classList.remove('aim'); document.documentElement.classList.remove('casting');
    return r;
  });
  check(out.aimRing.display !== 'none' && parseFloat(out.aimRing.w) > 0,
    'THE AIM RING VANISHED ON A SEALED COLUMN — the hint suppressor took it with it', out.aimRing);

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


  /* ---------- 12. the armed line fits the lane it was given ----------
     The status has a RESERVED box, and the reserve is the whole rule: ONE line
     in portrait, TWO in landscape's fixed 104px lane (`.status` / `.land
     .status` min-height). A box that sizes itself to its text walks the stage
     die up the screen — the drift test8 guards for ordinary turns. The ARMED
     line is that same box with longer words in it and was never measured:
     ANVIL's "Tap a filled column to recast its weakest die" took FOUR lines in
     landscape (die shoved 12.6px) and TWO in portrait on a 320px phone (user
     report), with WARD and PILFER quietly over in landscape.

     Measured through arm(), the path a real press takes, once per REGISTRY
     entry — so the next spell is measured the day it is written rather than
     the day someone plays it on a small phone. The budget is READ FROM THE
     CSS, never typed here, so the reserve and its guard cannot drift apart.
     Two viewports are the whole family: the narrowest portrait phone (the box
     is shrink-to-fit there, so the narrowest lane is the one that wraps first)
     and any landscape (that lane is a fixed 104px — the wrap depends on the
     words alone). */
  for (const view of [{ name: 'portrait', w: 320, h: 568 }, { name: 'landscape', w: 667, h: 375 }]) {
    const vctx = await browser.newContext({ viewport: { width: view.w, height: view.h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    await vctx.addInitScript(() => { const k = 'knucklebones.v1', c = JSON.parse(localStorage.getItem(k) || '{}'); c.played = true; localStorage.setItem(k, JSON.stringify(c)); });
    const vp = await vctx.newPage();
    vp.on('pageerror', e => problems.push('PAGEERROR(' + view.name + '): ' + e.message));
    await vp.goto(F); await vp.waitForTimeout(400);
    await vp.evaluate(() => window.__kb.openPractice());
    await vp.tap('#btnPlay'); await vp.waitForTimeout(2200);
    /* one synchronous pass: nothing re-renders between two arms, so every row
       is measured against the same resting stage. Line boxes are counted with
       a Range, not by dividing by line-height — portrait's line-height is
       `normal`, which parses to NaN and quietly makes every row look fine. */
    const lane = await vp.evaluate((ids) => {
      const st = document.getElementById('status'), stage = document.getElementById('dieStage');
      const reserve = parseFloat(getComputedStyle(st).minHeight);
      const restY = stage.getBoundingClientRect().y;
      const lines = () => { const rg = document.createRange(); rg.selectNodeContents(st); return rg.getClientRects().length; };
      const rows = ids.map((id) => {
        window.__kb.spells.arm(id);
        const b = st.getBoundingClientRect();
        return { id, text: st.textContent, lines: lines(), h: +b.height.toFixed(1), w: +b.width.toFixed(1),
                 offscreen: b.right > window.innerWidth + 0.5 || b.left < -0.5,
                 dieMoved: +Math.abs(stage.getBoundingClientRect().y - restY).toFixed(1) };
      });
      window.__kb.spells.disarm();
      return { land: document.documentElement.classList.contains('land'), reserve, rows };
    }, SPELLS.map((s) => s.id));
    out['aimLane_' + view.name] = lane;
    check(lane.land === (view.name === 'landscape'), 'the aim-lane probe was in the wrong orientation', { view, land: lane.land });
    check(lane.rows.every((r) => r.text), 'an armed rune said nothing', lane.rows);
    check(lane.rows.every((r) => r.h <= lane.reserve + 0.5),
      'an armed line outgrows the box ' + view.name + ' reserves for it',
      { reserve: lane.reserve, over: lane.rows.filter((r) => r.h > lane.reserve + 0.5) });
    check(lane.rows.every((r) => !r.offscreen),
      'an armed line runs off the edge of a ' + view.name + ' phone',
      lane.rows.filter((r) => r.offscreen));
    check(lane.rows.every((r) => r.dieMoved <= 0.5),
      'arming a rune walked the stage die off its place in ' + view.name,
      lane.rows.filter((r) => r.dieMoved > 0.5));
    await vctx.close();
  }

  console.log(JSON.stringify({ out, problems }, null, 2));
} finally { await browser.close(); }
process.exit(problems.length ? 1 : 0);
