// THE REVEAL'S PARTS DO NOT SIT ON EACH OTHER.
//
// Every part of this screen is absolutely positioned against the stage's edge
// through --stage, which is what lets a beat change the stage's size without
// the readout jumping. The failure mode of that design is total: if --stage
// ever fails to resolve for one of them, its calc() is invalid, `top` falls
// back to auto, and an absolutely positioned child of a centred flex column
// lands in the MIDDLE — the title and the answer printed across the dial they
// describe. Nothing about the markup or the classes would look wrong, so this
// is measured in pixels, at two sizes, in BOTH dressings: the ranked one
// carries a versus line the offline one does not.
import { SPELLS } from '../../../src/core/spells.ts';
import { verifyPileDealClearance } from './deal-stack.mjs';
import { primeRandomStart, SEED_AVOIDS_RITUAL } from './random-start.mjs';
import { verifyDualRevealLanes } from './dual-reveal-lanes.mjs';
import { lendCollectedRunes } from './random-two-reveal.mjs';

async function overlaps(page, out, check, label) {
  const r = await page.evaluate(() => {
    const box = (q) => { const e = document.querySelector(q); if (!e) return null;
      const b = e.getBoundingClientRect();
      return (e.textContent || '').trim() && b.height > 0
        ? { left: b.left, right: b.right, top: b.top, bot: b.bottom }
        : null; };
    const st = document.querySelector('#wheelStage').getBoundingClientRect();
    const stage = { left: st.left, right: st.right, top: st.top, bot: st.bottom };
    /* A short landscape phone deliberately puts the hold in the free right
       gutter at the stage's vertical midpoint. Measure rectangle overlap,
       not vertical-range overlap, or that valid side-by-side layout reads
       as though the copy were painted across the cards. */
    const over = (a) => a ? Math.round(Math.min(
      Math.max(0, Math.min(a.right, stage.right) - Math.max(a.left, stage.left)),
      Math.max(0, Math.min(a.bot, stage.bot) - Math.max(a.top, stage.top)),
    )) : 0;
    return { title: over(box('#wheelTitle')), name: over(box('#wheelName')),
             blurb: over(box('#wheelBlurb')), settled: over(box('#wheelSettled')),
             who: over(box('#wheelWho')), hold: over(box('#wheelHold')),
             stageH: Math.round(st.height) };
  });
  out['overlap_' + label] = r;
  check(r.stageH > 0, `${label}: the reveal has no stage at all`, r);
  for (const part of ['title', 'name', 'blurb', 'settled', 'who', 'hold']) {
    check(r[part] === 0, `${label}: the reveal's ${part} is printed across the stage`, r);
  }
}

/* Hold the reveal on whichever beat is last. */
async function revealHeld(page, mode, spell, playMode = 'cpu') {
  if (playMode === 'cpu') await lendCollectedRunes(page, SPELLS.map(({ id }) => id));
  await page.evaluate(() => {
    const k = window.__kb;
    k.goHome(); k.openPractice();
  });
  await page.click(`#modeSeg button[data-m="${playMode}"]`);
  await page.click(`#modePick button[data-v="${mode}"]`);
  await page.click(`#spellPick button[data-v="${spell}"]`);
  await page.evaluate(primeRandomStart, mode === '-1' ? SEED_AVOIDS_RITUAL : null);
  await page.waitForFunction(() => document.querySelector('#ovWheel')?.classList.contains('holding'), { timeout: 20000 });
  await page.waitForTimeout(250);
}

async function dismiss(page) {
  await page.click('#ovWheel');
  await page.waitForFunction(() => !document.querySelector('#ovWheel')?.classList.contains('on'), { timeout: 12000 });
}

export async function verifyRevealGeometry(page, out, check) {
  /* The two delegated beats below still take the drivers as arguments, so bind
     this page once and hand the same three closures to both. */
  const held = (mode, spell, playMode) => revealHeld(page, mode, spell, playMode);
  const boxes = (target, label) => overlaps(target, out, check, label);
  const close = () => dismiss(page);

  for (const [w, h] of [[390, 844], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h });
    // OFFLINE dressing: mode then rune, so the settled strip is on screen too
    await held('-1', 'random');
    await boxes(page, `offline-${w}x${h}`);
    await close();
    // RANKED dressing: the mode alone, plus the versus line ranked fills in
    await held('-1', 'ward');
    await page.evaluate(() => { document.querySelector('#wheelWho').innerHTML =
      '<div class="dside me"><span class="dav"></span><span class="dnm">FrostLynx303</span><span class="rt">1284</span></div>'
      + '<span class="dvs">VS</span>'
      + '<div class="dside foe"><span class="dav"></span><span class="dnm">EmberCrow896</span><span class="rt">1310</span></div>'; });
    await page.waitForTimeout(200);
    await boxes(page, `ranked-${w}x${h}`);
    await close();
  }
  /* The hardest geometry is random mode + two runes on a short landscape. */
  await verifyDualRevealLanes(page, out, check, held, boxes, close);
  /* The rotated painted bodies of the pile deal, at the two tight rests. */
  await verifyPileDealClearance(page, out, check, held, close);
}
