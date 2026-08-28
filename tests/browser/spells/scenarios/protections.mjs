import { createColumnOutlineProbe } from '../harness/column-outlines.mjs';
import { createSealMarkProbe, readSealTiming } from '../harness/seal-mark.mjs';
import { runProtectionBeatScenarios } from './protection-beats.mjs';
import { runProtectionColourScenarios } from './protection-colours.mjs';
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
     column carries `.warded`, and that is the DOM-deep assertion
     single-strike-visibility exists to warn against: it passed for BOTH rules
     on every day the two drew the
     same ring. So this measures the SHAPE a player sees — one closed line
     against a line held by one clasp — and then measures what a strike leaves
     behind, which is where the two rules actually part company.

     COLUMN SHIELD with a rune in hand, both protections on the FOE's board, so
     one placement can strike each in turn. */
  /* The beats, the painted mark and the two rules that read them live in the
     harness beside this file. Every wait from here down derives from the
     stylesheet's own beats — "measure the RESTING mark" must outlast the
     engage beat — and the three scenarios composed at the end measure the same
     seal through the same probe. */
  const sealTiming = await readSealTiming(page);
  const { sealOf, cornerOk } = createSealMarkProbe({ page, check });
  const { outlinesOf, oneOutline } = createColumnOutlineProbe({ page, check });

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
  await runProtectionColourScenarios(protectionSuite);
}
