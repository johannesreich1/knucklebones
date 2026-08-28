/* THE DUAL REVEAL FITS ITS SHORT TOP LANE.
 *
 * RANDOM x2 is the only reveal that must show a settled strip, the prompt, the
 * active eyebrow and the moving cards at the same time, and the lane above the
 * stage is where they compete for room. Every regression here has been an
 * overlap a class-level assertion cannot see: the settled strip growing down
 * into the title, the eyebrow landing on the cards, or the owned rune keeping
 * a rule with no room for it. So it is measured in pixels, at the three
 * combinations that actually differ - 568x320 with neither rune owned, 568x320
 * with the first one settled, and 320x568 portrait where both seats are named.
 *
 * The three beats are stateful: each revealHeld() rebuilds the overlay and
 * each dismiss() closes it, so their order is part of what is asserted.
 */

/* One reading of the lane for all three beats. They differed only in which
   fields each one bothered to collect, so the union is read once and each
   beat asserts over the part it owns. */
async function readRevealLanes(page) {
  return page.evaluate(() => {
    const settled = document.getElementById('wheelSettled').getBoundingClientRect();
    const title = document.getElementById('wheelTitle').getBoundingClientRect();
    const titleCopy = document.querySelector('#wheelTitle .wtitlecopy').getBoundingClientRect();
    const activeOwner = document.getElementById('wheelOwner');
    const activeOwnerBox = activeOwner.getBoundingClientRect();
    const stage = document.getElementById('wheelStage').getBoundingClientRect();
    const visibleCards = [...document.querySelectorAll('#wheelStage .rcard, #wheelStage .rdealt')]
      .filter((card) => Number(getComputedStyle(card).opacity) > 0
        && getComputedStyle(card).visibility !== 'hidden')
      .map((card) => card.getBoundingClientRect());
    const answers = [...document.querySelectorAll('#wheelSettled .wsett')];
    const answerBoxes = answers.map((answer) => answer.getBoundingClientRect());
    const pills = answers.map((answer) => answer.querySelector('.wpill')?.getBoundingClientRect())
      .filter(Boolean);
    const owner = document.querySelector('#wheelSettled .wowner');
    const ownerBox = owner?.getBoundingClientRect();
    /* The owner's OWN pill, not the first one in the strip: with two settled
       answers those are different nodes. */
    const ownedPill = owner?.parentElement?.querySelector('.wpill')?.getBoundingClientRect();
    const blurbs = [...document.querySelectorAll('#wheelSettled .wblurb')]
      .map((node) => getComputedStyle(node).display);
    return {
      count: answers.length,
      top: settled.top,
      bottom: settled.bottom,
      titleTop: title.top,
      titleBottom: title.bottom,
      promptBottom: titleCopy.bottom,
      activeOwnerTop: activeOwnerBox.top,
      activeOwnerBottom: activeOwnerBox.bottom,
      activeOwner: activeOwner.textContent.trim(),
      settledOwner: owner?.textContent.trim() ?? '',
      stageTop: stage.top,
      visualCardTop: Math.min(...visibleCards.map((card) => card.top)),
      viewport: innerHeight,
      blurbs,
      blurb: blurbs[0] ?? '',
      ownerOutsidePill: !!owner && !owner.closest('.wpill'),
      ownerGap: ownerBox && ownedPill
        ? Math.round((ownedPill.top - ownerBox.bottom) * 10) / 10 : -1,
      answerGap: answerBoxes.length === 2 ? answerBoxes[1].left - answerBoxes[0].right : -1,
      pillBottomSpread: pills.length === 2 ? Math.abs(pills[0].bottom - pills[1].bottom) : -1,
    };
  });
}

export async function verifyDualRevealLanes(page, out, check, revealHeld, overlaps, dismiss) {
  await page.setViewportSize({ width: 568, height: 320 });
  await revealHeld('-1', 'random2');
  await overlaps(page, 'dual-568x320');
  out.dualLandscape = await readRevealLanes(page);
  check(out.dualLandscape.count === 2 && out.dualLandscape.top >= 0
      && out.dualLandscape.bottom <= out.dualLandscape.viewport
      && out.dualLandscape.bottom <= out.dualLandscape.titleTop
      && out.dualLandscape.promptBottom <= out.dualLandscape.activeOwnerTop
      && out.dualLandscape.titleBottom <= out.dualLandscape.stageTop
      && out.dualLandscape.activeOwnerBottom + 8 <= out.dualLandscape.visualCardTop
      && out.dualLandscape.activeOwner === 'AI'
      && out.dualLandscape.blurbs.length === 2
      && out.dualLandscape.blurbs.every((display) => display === 'none')
      && out.dualLandscape.ownerOutsidePill
      && out.dualLandscape.ownerGap >= 5 && out.dualLandscape.ownerGap <= 8
      && out.dualLandscape.answerGap >= 0
      && out.dualLandscape.pillBottomSpread <= 1,
    'the compact dual reveal escaped or overfilled the short landscape viewport', out.dualLandscape);
  await dismiss();

  /* With a chosen mode, only the first player's rune is settled. Its added
     eyebrow must fit the same short top lane, while portrait keeps the rule. */
  await revealHeld('0', 'random2');
  await overlaps(page, 'dual-owned-568x320');
  out.dualOwnedLandscape = await readRevealLanes(page);
  check(out.dualOwnedLandscape.count === 1 && out.dualOwnedLandscape.top >= 0
      && out.dualOwnedLandscape.bottom <= out.dualOwnedLandscape.titleTop
      && out.dualOwnedLandscape.promptBottom <= out.dualOwnedLandscape.activeOwnerTop
      && out.dualOwnedLandscape.titleBottom <= out.dualOwnedLandscape.stageTop
      && out.dualOwnedLandscape.activeOwnerBottom + 8 <= out.dualOwnedLandscape.visualCardTop
      && out.dualOwnedLandscape.activeOwner === 'AI'
      && out.dualOwnedLandscape.ownerOutsidePill
      && out.dualOwnedLandscape.ownerGap >= 5 && out.dualOwnedLandscape.ownerGap <= 8
      && out.dualOwnedLandscape.blurb === 'none',
    'the owned rune eyebrow clipped or kept its rule in the short landscape lane', out.dualOwnedLandscape);
  await dismiss();

  await page.setViewportSize({ width: 320, height: 568 });
  await revealHeld('0', 'random2', 'duo');
  await overlaps(page, 'dual-owned-320x568');
  out.dualOwnedPortrait = await readRevealLanes(page);
  check(out.dualOwnedPortrait.count === 1 && out.dualOwnedPortrait.top >= 0
      && out.dualOwnedPortrait.bottom <= out.dualOwnedPortrait.titleTop
      && out.dualOwnedPortrait.promptBottom <= out.dualOwnedPortrait.activeOwnerTop
      && out.dualOwnedPortrait.titleBottom <= out.dualOwnedPortrait.stageTop
      && out.dualOwnedPortrait.activeOwnerBottom + 8 <= out.dualOwnedPortrait.visualCardTop
      && out.dualOwnedPortrait.settledOwner === 'PLAYER 1'
      && out.dualOwnedPortrait.activeOwner === 'PLAYER 2'
      && out.dualOwnedPortrait.ownerOutsidePill
      && out.dualOwnedPortrait.ownerGap >= 5 && out.dualOwnedPortrait.ownerGap <= 8
      && out.dualOwnedPortrait.blurb !== 'none',
    'the owned rune eyebrow clipped or lost its readable rule at 320px portrait', out.dualOwnedPortrait);
  await dismiss();
}
