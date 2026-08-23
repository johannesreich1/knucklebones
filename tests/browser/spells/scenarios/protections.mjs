import { runProtectionBeatScenarios } from './protection-beats.mjs';
import { runProtectionLayoutScenarios } from './protection-layout.mjs';

export async function runProtectionScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, guard } = suite;
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
     design/screens/product/39c-guard-seal.html, approved and shipped. The mark both
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
  /* THE BEATS, ASKED FOR RATHER THAN TYPED. The stylesheet owns each one and
     every wait below is derived from them: "measure the RESTING mark" must
     outlast the engage beat, and a strike probe must watch the longest beat.
     Keep the reader unit-aware because the build minifier may rewrite `950ms`
     as `.95s`; a bare parseFloat would turn the shipped beat into 1ms. */
  const cssMs = (key) => page.evaluate((k) => {
    const root = document.getElementById('kbroot');
    const value = getComputedStyle(root).getPropertyValue(k).trim();
    const number = parseFloat(value);
    return !(number > 0) ? 0 : /ms$/.test(value) ? number : /s$/.test(value) ? number * 1000 : number;
  }, key);
  const sealTiming = {
    engage: await cssMs('--seal-engage'),
    strike: await cssMs('--seal-strike'),
    snap: await cssMs('--seal-snap'),
  };
  sealTiming.settle = Math.round(sealTiming.engage) + 300;
  /* Die flight (300ms), the pre-strike pause (120ms), the longest seal beat,
     and enough time after it to observe a spent ward's mark leave. */
  sealTiming.strikeTicks = Math.ceil((420 + Math.max(sealTiming.strike, sealTiming.snap) + 700) / 40);
  const sealOf = (side, c, pg = page) => pg.evaluate(([sd, cc]) => {
    const col = document.querySelector('#' + sd + 'Board .col[data-col="' + cc + '"]');
    const seal = col.querySelector('.seal');
    const chip = document.querySelectorAll('#' + sd + 'Cols .chip')[cc];
    const plate = document.getElementById('plate' + (sd === 'bot' ? 'Bot' : 'Top'));
    const centre = document.getElementById('dieStage');
    const land = document.getElementById('kbroot').classList.contains('land');
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
       beats are (ui/game/seals.ts sealHost), so the stand-off below is measured
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
         same offset. The rectangle a player sees there is the cell — the slot
         and die share one corner — so the honest target is the cell radius plus
         the stand-off, one number checked at every cell size. */
      corner: cornerOf(line), cell: +parseFloat(getComputedStyle(col.querySelector('.slot')).borderRadius).toFixed(2),
      standoff: +parseFloat(getComputedStyle(seal).getPropertyValue('--seal-out')).toFixed(2),
      col: cb, loop: one('sl'), arc: one('sal'),
      clasp: rivet ? r(seal.querySelector('.sclasp')) : null,
      // how far the painted line stands OUTSIDE the run, on each side
      out: box && run && { l: +(run.x - box.x).toFixed(2), t: +(run.y - box.y).toFixed(2),
                           r: +(box.x + box.w - run.x - run.w).toFixed(2), b: +(box.y + box.h - run.y - run.h).toFixed(2) },
      toChip: gap(all, cr), toPlate: gap(all, plate ? r(plate) : null), toPlateInk: mark,
      // where the mouth, chip strip and table centre sit relative to the
      // column. The ward's mouth is independently turned toward the centre;
      // the shield keeps the shared frame's original closure direction.
      mouth: rivet ? { dx: +(mid(r(rivet)).x - mid(cb).x).toFixed(1), dy: +(mid(r(rivet)).y - mid(cb).y).toFixed(1) } : null,
      chipAt: { dx: +(mid(cr).x - mid(cb).x).toFixed(1), dy: +(mid(cr).y - mid(cb).y).toFixed(1) },
      centerAt: centre ? { dx: +(mid(r(centre)).x - mid(cb).x).toFixed(1), dy: +(mid(r(centre)).y - mid(cb).y).toFixed(1) } : null,
      onDie: [...col.querySelectorAll('.die')].some((d) => {
        const b = r(d); return !!box && (b.x < box.x || b.y < box.y
          || b.x + b.w > box.x + box.w || b.y + b.h > box.y + box.h); }),
    };
  }, [side, c]);

  /* THE CORNER IS THE CELL'S, AT EVERY CELL SIZE — asserted through one
     helper wherever a seal is measured (this phone, the 88px cap, landscape,
     and every span), because the number moves with the cell and a single
     viewport cannot see it. --seal-out and the cell radius are both read, so
     the mark and its guard cannot drift apart. */
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
  /* The one-shot class must outlive its animation. Without checking during
     the beat, every later assertion would still see a valid resting mark after
     the class had cut the draw-on short. */
  out.sealWindow = await page.evaluate(async (beat) => {
    const col = document.querySelector('#topBoard .col[data-col="1"]');
    const t0 = performance.now();
    let held = 0;
    for (let i = 0; i < 120; i++) {
      if (!col.classList.contains('sealon')) break;
      held = performance.now() - t0;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return { held: Math.round(held), beat };
  }, sealTiming.engage);
  check(out.sealWindow.held > sealTiming.engage * 0.9,
    'THE ENGAGE BEAT IS CUT SHORT — the seal gets less time than its own animation', out.sealWindow);
  await page.waitForTimeout(sealTiming.settle); // the engage beat is over; measure the RESTING mark
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
  check(out.sealShield.lines === 1,
    'THE SHIELD PAINTS A SECOND LINE INSIDE ITS OWN — an inset hairline is another outline',
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


  const protectionSuite = { ...suite, sealOf, cornerOk, outlinesOf, oneOutline, sealTiming };
  await runProtectionBeatScenarios(protectionSuite);
  await runProtectionLayoutScenarios(protectionSuite);
}
