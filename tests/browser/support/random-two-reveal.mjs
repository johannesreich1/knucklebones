// Player-visible RANDOM ×2 contracts shared by the broad reveal owner test.
// Keep the full two-beat story together: each honest shuffle names its owner,
// deals the card it showed, and reaches one compact final countdown.
export async function verifyRandomTwoReveal(page, out, check) {
  await page.evaluate(() => {
    const k = window.__kb;
    k.goHome(); k.S.mode = 'cpu'; k.openPractice();
    document.querySelector('#modePick button[data-v="0"]').click();
    document.querySelector('#spellPick button[data-v="random2"]').click();
    k.S.timer = 0;
  });
  const started = Date.now();
  await page.click('#btnPlay');
  await page.waitForSelector('#ovWheel.dealing', { timeout: 8000 });
  await page.waitForSelector('.rdealt.up', { timeout: 12000 });
  const firstMs = Date.now() - started;
  const first = await page.evaluate(() => {
    const card = document.querySelector('.rdealt');
    return {
      card: card.dataset.rune,
      title: document.getElementById('wheelTitle').textContent.trim(),
      deck: [...document.querySelectorAll('.rcard')].map((item) => item.dataset.rune),
    };
  });
  await page.waitForFunction((firstCard) => {
    const card = document.querySelector('.rdealt');
    return card && card.dataset.rune !== firstCard && !card.classList.contains('up');
  }, first.card, { timeout: 8000 });
  const secondStarted = Date.now();
  const secondDeck = await page.evaluate(() => ({
    title: document.getElementById('wheelTitle').textContent.trim(),
    deck: [...document.querySelectorAll('.rcard')].map((item) => item.dataset.rune),
    settledOwner: document.querySelector('#wheelSettled .wowner')?.textContent.trim() ?? '',
    settledRune: document.querySelector('#wheelSettled .wpill b')?.textContent.trim() ?? '',
  }));
  await page.waitForSelector('.rdealt.up', { timeout: 12000 });
  const secondMs = Date.now() - secondStarted;
  await page.waitForFunction(() => document.querySelector('#ovWheel')?.classList.contains('holding'),
    null, { timeout: 8000 });
  const second = await page.evaluate(() => ({
    card: document.querySelector('.rdealt').dataset.rune,
    title: document.getElementById('wheelTitle').textContent.trim(),
    settled: document.querySelectorAll('#wheelSettled .wsett').length,
    hold: getComputedStyle(document.getElementById('wheelHold')).visibility,
  }));
  await page.click('#ovWheel');
  await page.waitForFunction(() => !document.querySelector('#ovWheel')?.classList.contains('on'),
    null, { timeout: 8000 });
  const played = await page.evaluate(() => ({
    ai: Object.keys(window.__kb.S.spellCharges[0])[0] ?? null,
    me: Object.keys(window.__kb.S.spellCharges[1])[0] ?? null,
    selector: window.__kb.S.spell,
    visibleCards: [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
      .filter((card) => !!card.offsetParent).length,
  }));
  const dual = { firstMs, secondMs, first, secondDeck, second, played };
  out.dual = dual;
  check(dual.first.title === 'RUNE FOR YOU' && dual.second.title === 'RUNE FOR AI'
      && dual.secondDeck.settledOwner === 'YOU',
    'the two shuffle beats do not identify which player receives each rune', dual);
  check(dual.first.card === dual.played.me && dual.second.card === dual.played.ai
      && dual.played.me !== dual.played.ai && dual.played.selector === 'random2',
    'the cards shown were not the distinct per-player hands actually dealt', dual);
  check(dual.first.deck.length === 6 && new Set(dual.first.deck).size === 6
      && dual.secondDeck.deck.length === 5 && new Set(dual.secondDeck.deck).size === 5
      && !dual.secondDeck.deck.includes(dual.first.card),
    'the second shuffle did not visibly use the five remaining runes', dual);
  check(dual.firstMs > 2000 && dual.secondMs > 2000,
    'RANDOM ×2 skipped or rushed one of its two shuffle animations', dual);
  check(dual.second.settled === 1 && dual.second.hold === 'visible'
      && dual.played.visibleCards === 2,
    'RANDOM ×2 did not finish with one countdown and both live rune cards', dual);
}

export async function verifyRandomTwoLandscape(page, out, check, revealHeld, overlaps, dismiss) {
  await page.setViewportSize({ width: 568, height: 320 });
  await revealHeld('-1', 'random2');
  await overlaps(page, 'dual-568x320');
  out.dualLandscape = await page.evaluate(() => {
    const settled = document.getElementById('wheelSettled').getBoundingClientRect();
    return {
      count: document.querySelectorAll('#wheelSettled .wsett').length,
      top: settled.top,
      bottom: settled.bottom,
      viewport: innerHeight,
      blurbs: [...document.querySelectorAll('#wheelSettled .wblurb')]
        .map((node) => getComputedStyle(node).display),
    };
  });
  check(out.dualLandscape.count === 2 && out.dualLandscape.top >= 0
      && out.dualLandscape.bottom <= out.dualLandscape.viewport
      && out.dualLandscape.blurbs.every((display) => display === 'none'),
    'the compact dual reveal escaped or overfilled the short landscape viewport', out.dualLandscape);
  await dismiss();
}
