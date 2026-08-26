// The dealt deck, read and judged as the player sees it (test20's owner).
//
// Since the S9 pile deal (2026-08-26) the shuffle is PHYSICAL: the runes never
// relabel — each card carries its rune through the piles — so proving the
// shuffle mattered is geometric, not textual: the fan the player was handed
// has been dealt into ONE SQUARED STACK, and the card they receive came off
// its TOP.
import { squaredOf, stackOf } from '../../../src/ui/runefelt.ts';

/* Page-side reader for the turned deal — passed to page.evaluate, so it must
   stay closure-free. Measures the assembled stack the way the player sees it:
   the visible cards' horizontal spread (a fan is ~2 card widths, a squared
   deck a few px of jitter) and the stacking order (z). */
export const readTurnedDeal = () => {
  const d = document.querySelector('.rdealt');
  const face = getComputedStyle(d.querySelector('.rface'));
  const back = getComputedStyle(d.querySelector('.rback'));
  const deck = [...document.querySelectorAll('.rcard')];
  const visible = deck.filter((e) => getComputedStyle(e).visibility === 'visible');
  const centers = visible.map((e) => { const b = e.getBoundingClientRect(); return b.x + b.width / 2; });
  const z = (e) => +getComputedStyle(e).zIndex || 0;
  const drawnEl = deck.find((e) => e.classList.contains('drawn'));
  return {
    card: d.dataset.rune,
    label: d.querySelector('.rlbl').textContent.trim(),
    // which slot of the fan the card came off the top from, and that only one left
    drawnSlot: deck.findIndex((e) => e.classList.contains('drawn')),
    drawnRune: drawnEl?.dataset.rune ?? null,
    deck: deck.map((e) => e.dataset.rune),
    stillInFan: visible.length,
    squaredSpreadPx: Math.max(...centers) - Math.min(...centers),
    cardWidthPx: deck[0].offsetWidth,
    drawnZ: drawnEl ? z(drawnEl) : -1,
    maxOtherZ: Math.max(...visible.map(z)),
    faceOpacity: +face.opacity, backOpacity: +back.opacity,
    faceBg: face.backgroundImage !== 'none',
    named: document.querySelector('#wheelName').textContent.trim(),
    settled: [...document.querySelectorAll('.wsett')].map((e) => ({
      name: e.querySelector('.wpill b').textContent.trim(),
      rule: e.querySelector('.wblurb').textContent.trim(),
    })),
    hold: getComputedStyle(document.querySelector('.dhold')).visibility,
  };
};

/** the physical re-order contract, judged across several deals */
export function checkDealPhysique(deals, check) {
  const carried = deals.map((d) => d.shuffling.deck.join(',') === d.turned.deck.join(','));
  check(carried.every(Boolean),
    'a card changed its rune mid-shuffle — the deal relabeled instead of dealing',
    deals.map((d) => ({ before: d.shuffling.deck.join(','), after: d.turned.deck.join(',') })));
  check(deals.every((d) => d.turned.squaredSpreadPx < d.turned.cardWidthPx / 2),
    'the deal did not end on a squared deck',
    deals.map((d) => ({ spread: d.turned.squaredSpreadPx, card: d.turned.cardWidthPx })));
  check(deals.every((d) => d.turned.drawnZ >= d.turned.maxOtherZ),
    'the drawn card did not come off the TOP of the assembled deck',
    deals.map((d) => ({ drawnZ: d.turned.drawnZ, maxOtherZ: d.turned.maxOtherZ })));
  return carried;
}

/* Deterministic pixel probe for one readable rest in the pile deal. Sampling
   the running WAAPI by wall-clock time makes a layout test depend on scheduler
   jitter; this clone uses the animation's shared authored poses and lets the
   browser compute the exact painted card bodies. It stays fully transparent
   and never joins layout or hit testing. */
export async function probePileDealClearance(page, pilePoses, stockPoses) {
  return page.evaluate(({ landed, stock }) => {
    const stageElement = document.getElementById('wheelStage');
    const source = stageElement?.querySelector('.rfelt');
    if (!stageElement || !source) throw new Error('the rune-deal stage is missing');

    const probe = source.cloneNode(true);
    probe.setAttribute('aria-hidden', 'true');
    Object.assign(probe.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      translate: '-50% -50%',
      opacity: '0',
      pointerEvents: 'none',
    });
    probe.querySelector('.rdealt')?.remove();
    stageElement.append(probe);

    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        width: box.width, height: box.height,
      };
    };
    const inside = (inner, outer, tolerance = 0.75) =>
      inner.left >= outer.left - tolerance && inner.right <= outer.right + tolerance
      && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance;
    const applyPose = (card, pose) => {
      card.classList.remove('drawn');
      Object.assign(card.style, {
        visibility: 'visible',
        opacity: '1',
        transform: 'none',
        scale: '1',
        translate: `${pose.x}% ${pose.y}%`,
        rotate: `${pose.rot}deg`,
      });
    };

    try {
      const cards = [...probe.querySelectorAll('.rcard')];
      if (cards.length < landed.length + stock.length) {
        throw new Error(`the pixel probe needs ${landed.length + stock.length} rune cards`);
      }
      const pileCards = cards.slice(0, landed.length);
      const stockCards = cards.slice(landed.length, landed.length + stock.length);
      pileCards.forEach((card, index) => applyPose(card, landed[index]));
      stockCards.forEach((card, index) => applyPose(card, stock[index]));
      cards.slice(landed.length + stock.length).forEach((card) => {
        card.style.visibility = 'hidden';
      });

      const pileBoxes = pileCards.map(rect);
      const stockBoxes = stockCards.map(rect);
      const stockTop = Math.min(...stockBoxes.map((box) => box.top));
      const gaps = pileBoxes.map((box) => stockTop - box.bottom);
      const stage = rect(stageElement);
      const felt = rect(probe);
      const title = rect(document.getElementById('wheelTitle'));
      const root = rect(document.getElementById('kbroot'));
      const cardWidth = pileCards[0].offsetWidth;

      return {
        cardWidth,
        pileBoxes,
        stockBoxes,
        stockTop,
        gaps,
        minGap: Math.min(...gaps),
        stage,
        felt,
        title,
        root,
        pilesInsideStage: pileBoxes.every((box) => inside(box, stage)),
        stockInsideRoot: stockBoxes.every((box) => inside(box, root)),
        feltInsideRoot: inside(felt, root),
        titleInsideRoot: inside(title, root),
        titleGap: Math.min(
          ...pileBoxes.map((box) => box.top),
          ...stockBoxes.map((box) => box.top),
        ) - title.bottom,
      };
    } finally {
      probe.remove();
    }
  }, { landed: pilePoses, stock: stockPoses });
}

/* Rebuild the two tight readable rests from runefelt's shared poses and
   measure the rotated, painted bodies — unrotated offsets missed the
   overlap this guards. After two flicks the centre pile first shares the
   stock's horizontal lane; after three, all three upper piles are present. */
export async function verifyPileDealClearance(page, out, check, revealHeld, dismiss) {
  const clearanceFrames = [2, 3].map((dealt) => ({
    dealt,
    pilePoses: Array.from({ length: dealt }, (_, step) =>
      stackOf(step % 3, Math.floor(step / 3))),
    stockPoses: Array.from({ length: 6 - dealt }, (_, depth) => squaredOf(depth)),
  }));
  out.pileDealClearance = {};
  for (const [width, height] of [[390, 844], [568, 320]]) {
    await page.setViewportSize({ width, height });
    await revealHeld('0', 'random');
    for (const frame of clearanceFrames) {
      const label = `${width}x${height}/after-${frame.dealt}`;
      const measured = await probePileDealClearance(
        page,
        frame.pilePoses,
        frame.stockPoses,
      );
      out.pileDealClearance[label] = measured;
      /* A hairline non-overlap is not the requested breathing room. Keep a
         small card-relative floor so the gap remains visible as --card scales. */
      check(measured.gaps.length === frame.dealt
        && measured.gaps.every((gap) => gap >= measured.cardWidth * .04),
        `${label}: the remaining rune stock crowds a landed pile`, measured);
      check(measured.pilesInsideStage && measured.stockInsideRoot && measured.feltInsideRoot
        && measured.titleInsideRoot && measured.titleGap >= 1,
      `${label}: the separated pile deal escaped its stage or title bounds`, measured);
    }
    await dismiss();
  }
}
