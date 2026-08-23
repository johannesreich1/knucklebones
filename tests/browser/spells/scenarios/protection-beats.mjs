export async function runProtectionBeatScenarios(suite) {
  const {
    page, out, check, devices, newGame, waitChoose, table, guard, sidePage,
    sealOf, cornerOk, sealTiming,
  } = suite;
  /* ---------- 10a-i. A STRIKE MEETS A PROTECTION, AND IT IS SEEN ----------
     shieldBlocked() and wardBurned() (ui/game/seals.ts) were extracted from two
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
  }, [side, c, who, at, sealTiming.strikeTicks]);

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
  await page.waitForTimeout(sealTiming.settle);
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
  await page.waitForTimeout(sealTiming.settle);
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
  await page.waitForTimeout(sealTiming.settle);
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
  await page.waitForTimeout(sealTiming.settle);
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
     to travel (ui/game/seals.ts sealHost). Aimed at the struck column it would run
     the whole harden on a display:none element and the player would see the
     chip twitch beside a line that never answered. */
  await table([[], [], []], [[5, 5, 2], [6, 6, 1], []], 6);
  await page.waitForTimeout(sealTiming.settle);
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

}
