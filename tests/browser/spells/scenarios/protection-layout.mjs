export async function runProtectionLayoutScenarios(suite) {
  const {
    page, out, check, newGame, waitChoose, table, guard, sidePage,
    sealOf, cornerOk, outlinesOf, oneOutline, sealTiming,
  } = suite;
  /* ---------- 10a-iv. THE WARD FACES TABLE CENTRE ----------
     --seal-turn ships four frame values — one per half, per orientation — but
     the spendable WARD now owns one additional inner turn. The shield keeps its
     closed-frame direction; the Ward clasp must face the attack across table
     centre: down/up in portrait, right/left in landscape. A whole-SVG flip
     would silently reverse the shield too, and a seat-only rule would fail as
     soon as pass-phone swaps identities, so this measures the painted clasp
     against the live stage rather than trusting a class name.
     BOTH HALVES, because their turns are opposite; and the portrait viewport is
     deliberately the widest the cell cap allows — at 88px the ink stands
     furthest out and every clearance here is at its tightest. */
  for (const view of [{ name: 'portrait', w: 430, h: 932 }, { name: 'landscape', w: 667, h: 375 }]) {
    const { ctx: vctx, page: vp } = await sidePage(view);
    await newGame({ spell: 'ward', mode: 3 }, vp);
    check(await waitChoose(vp), 'game never reached choose (turn/' + view.name + ')');
    await table([[3, 3, 1], [], []], [[5, 5, 2], [4], []], 5, vp);
    await guard(1, 0, vp); await guard(1, 1, vp);      // a ward on column 1 of each half
    const close = await vp.evaluate(() => {
      const animation = [...document.querySelectorAll('.col.warded .sa')]
        .flatMap((arc) => arc.getAnimations())
        .find((item) => item.animationName === 'sealclose');
      return animation?.effect.getKeyframes().map((frame) =>
        parseFloat(String(frame.strokeDashoffset))) ?? null;
    });
    await vp.waitForTimeout(sealTiming.settle);
    const turn = {
      land: await vp.evaluate(() => document.getElementById('kbroot').classList.contains('land')),
      cell: await vp.evaluate(() => getComputedStyle(document.getElementById('kbroot')).getPropertyValue('--cell')),
      close,
    };
    for (const half of ['top', 'bot']) {
      turn[half + 'Shield'] = await sealOf(half, 0, vp);
      turn[half + 'Ward'] = await sealOf(half, 1, vp);
    }
    /* The seal and its clasp paint outside their layout box, so ordinary
       board-fit checks cannot prove they are on-screen. This exact 667x375
       viewport used to put about five pixels of visible ink beyond BOTH edges;
       keep the painted bounds as a release assertion, not merely a report. */
    turn.inkEdge = await vp.evaluate(() => {
      let lo = Infinity, hi = -Infinity;
      for (const n of document.querySelectorAll('.col>.seal path,.col>.seal circle')) {
        const col = n.closest('.col'); let p = n, ok = true;
        while (p && p !== col) { const st = getComputedStyle(p);
          if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity < 0.05) { ok = false; break; }
          p = p.parentElement; }
        if (!ok) continue;
        const seal = n.closest('.seal'), vb = seal.viewBox.baseVal, sr = seal.getBoundingClientRect();
        const land = document.getElementById('kbroot').classList.contains('land');
        const hx = (parseFloat(getComputedStyle(n).strokeWidth) || 0)
                 * (land ? sr.width / vb.height : sr.width / vb.width) / 2;
        const b = n.getBoundingClientRect();
        lo = Math.min(lo, b.x - hx); hi = Math.max(hi, b.x + b.width + hx);
      }
      return { left: +lo.toFixed(2), right: +(window.innerWidth - hi).toFixed(2) };
    });
    out['sealTurn_' + view.name] = turn;
    check(turn.land === (view.name === 'landscape'), 'the seal-turn probe was in the wrong orientation', turn.land);
    check(turn.close?.[0] === 240 && turn.close.at(-1) === 0
        && turn.close.every((offset) => offset >= 0),
      'THE WARD ENGAGES FROM THE CENTRE-FACING CLASP INSTEAD OF THE OUTER HINGE in ' + view.name,
      turn.close);
    check(Object.values(turn.inkEdge).every((edge) => edge >= 0.5),
      'PROTECTION INK IS CLIPPED BY THE VIEWPORT in ' + view.name, turn.inkEdge);
    for (const half of ['top', 'bot']) {
      const sh = turn[half + 'Shield'], wd = turn[half + 'Ward'], where = view.name + '/' + half;
      check(sh.drawn && wd.drawn, 'a protection lost its seal in ' + where, { shield: sh.parts, ward: wd.parts });
      check(!!wd.mouth && !!wd.centerAt
          && wd.mouth.dx * wd.centerAt.dx + wd.mouth.dy * wd.centerAt.dy > 0,
        'THE WARD CLASP FACES AWAY FROM TABLE CENTRE in ' + where,
        { mouth: wd.mouth, centre: wd.centerAt, chip: wd.chipAt });
      /* The positive dash beat removes each path from its END. The endpoint
         must therefore be the centre-facing clasp: placement grows from the
         outer hinge toward it, and a strike opens there and retreats toward
         the outer edge. The path direction is checked in the Ward group's own
         coordinates; the centre-facing assertion above separately proves that
         the whole group turns correctly in every seat and orientation. */
      check(wd.flow?.length === 2
          && wd.flow.every((arc) => arc.endToClasp < 15 && arc.startToClasp > arc.endToClasp * 5),
        'THE WARD OUTLINE ANIMATES AWAY FROM TABLE CENTRE in ' + where,
        { flow: wd.flow, mouth: wd.mouth, centre: wd.centerAt });
      check(!!wd.clasp && Math.max(wd.clasp.w, wd.clasp.h) >= 9,
        'the Ward clasp is still too small to read on the border in ' + where, wd.clasp);
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
    await vp.waitForTimeout(sealTiming.settle);
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
  await page.waitForTimeout(sealTiming.settle);
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
    document.getElementById('kbroot').classList.add('casting'); col.classList.add('aim');
    const s = getComputedStyle(col, '::after');
    const r = { display: s.display, w: s.borderTopWidth, style: s.borderTopStyle };
    col.classList.remove('aim'); document.getElementById('kbroot').classList.remove('casting');
    return r;
  });
  check(out.aimRing.display !== 'none' && parseFloat(out.aimRing.w) > 0,
    'THE AIM RING VANISHED ON A SEALED COLUMN — the hint suppressor took it with it', out.aimRing);

}
