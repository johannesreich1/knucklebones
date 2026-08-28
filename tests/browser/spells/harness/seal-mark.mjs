/* ONE COLUMN'S PROTECTION MARK, measured one way for the whole suite: the
   stylesheet beats it runs on, the ink a player actually sees of it, and the
   corner/weight rule that reads off that measurement. protections.mjs composes
   this into the suite it hands to the three protection scenarios, so a seal is
   never measured twice by two slightly different probes. */

/* THE BEATS, ASKED FOR RATHER THAN TYPED. The stylesheet owns each one and
   every wait in the protection scenarios is derived from them: "measure the
   RESTING mark" must outlast the engage beat, and a strike probe must watch
   the longest beat. Keep the reader unit-aware because the build minifier may rewrite `950ms`
   as `.95s`; a bare parseFloat would turn the shipped beat into 1ms. */
export async function readSealTiming(page) {
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
  return sealTiming;
}

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
/* Pre-bound the way run.mjs binds newGame/table/guard/look: `page` is the
   default and any caller may hand in another. Deliberately stateless — nothing
   is memoised here, so a second call can never hand out helpers still bound to
   a page the first copy has moved on from. */
export function createSealMarkProbe({ page, check }) {
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
    const rivetBox = rivet ? r(rivet) : null;
    const mouth = rivetBox
      ? { dx: +(mid(rivetBox).x - mid(cb).x).toFixed(1), dy: +(mid(rivetBox).y - mid(cb).y).toFixed(1) }
      : null;
    const arcBox = hull(shown.filter((n) => n.classList.contains('sa')).map(r));
    const claspLine = rivetBox && arcBox && mouth
      ? +(Math.abs(mouth.dx) > Math.abs(mouth.dy)
          ? Math.abs(mid(rivetBox).x - (mouth.dx > 0 ? arcBox.x + arcBox.w : arcBox.x))
          : Math.abs(mid(rivetBox).y - (mouth.dy > 0 ? arcBox.y + arcBox.h : arcBox.y))).toFixed(2)
      : null;
    const join = seal.querySelector('.sj');
    const joinAt = join ? {
      dx: +(mid(r(join)).x - mid(cb).x).toFixed(1),
      dy: +(mid(r(join)).y - mid(cb).y).toFixed(1),
    } : null;
    /* Path direction is authored inside .smint, before that whole group turns
       toward table centre. Keep both endpoints and the clasp in that same
       coordinate system: Chromium's getScreenCTM omits the ancestor's CSS
       transform here, while getBoundingClientRect includes it. */
    const claspMid = rivet
      ? { x: rivet.cx.baseVal.value, y: rivet.cy.baseVal.value }
      : null;
    const flow = claspMid ? [...seal.querySelectorAll('.sa')].map((path) => {
      const start = path.getPointAtLength(0), end = path.getPointAtLength(path.getTotalLength());
      const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      return {
        startToClasp: +distance(start, claspMid).toFixed(2),
        endToClasp: +distance(end, claspMid).toFixed(2),
      };
    }) : null;
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
      mouth, claspLine, joinAt,
      flow,
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
  return { sealOf, cornerOk };
}
