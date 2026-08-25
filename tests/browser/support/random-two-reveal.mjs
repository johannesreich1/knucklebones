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
  const secondDeck = await page.evaluate(() => {
    const owner = document.querySelector('#wheelSettled .wowner');
    const pill = document.querySelector('#wheelSettled .wpill');
    const ownerBox = owner?.getBoundingClientRect();
    const pillBox = pill?.getBoundingClientRect();
    const dot = owner ? getComputedStyle(owner, '::before') : null;
    const playerProbe = document.createElement('i');
    playerProbe.style.color = 'var(--p1)';
    document.getElementById('kbroot').appendChild(playerProbe);
    const playerColor = getComputedStyle(playerProbe).color;
    playerProbe.remove();
    return {
      title: document.getElementById('wheelTitle').textContent.trim(),
      deck: [...document.querySelectorAll('.rcard')].map((item) => item.dataset.rune),
      settledOwner: owner?.textContent.trim() ?? '',
      settledRune: pill?.querySelector('b')?.textContent.trim() ?? '',
      pillText: pill?.textContent.trim() ?? '',
      ownerOutsidePill: !!owner && !owner.closest('.wpill'),
      ownerAbovePill: !!ownerBox && !!pillBox && ownerBox.bottom <= pillBox.top,
      ownerGap: ownerBox && pillBox ? Math.round((pillBox.top - ownerBox.bottom) * 10) / 10 : -1,
      dot: dot ? {
        width: parseFloat(dot.width), height: parseFloat(dot.height),
        color: dot.backgroundColor, ownerColor: getComputedStyle(owner).color, playerColor,
      } : null,
    };
  });
  /* Locale repaint must update the new eyebrow in place while the second deck
     is still moving. Rebuilding either node would restart the visual story. */
  const localizedOwner = await page.evaluate(() => {
    const owner = document.querySelector('#wheelSettled .wowner');
    const pill = document.querySelector('#wheelSettled .wpill');
    const stage = document.getElementById('wheelStage');
    const moving = [...stage.querySelectorAll('*')]
      .flatMap((node) => node.getAnimations()).find((animation) => animation.playState === 'running') ?? null;
    const state = () => JSON.stringify({
      gen: window.__kb.S.gen,
      scoring: window.__kb.S.scoring,
      spellCharges: window.__kb.S.spellCharges,
      boards: window.__kb.S.boards,
    });
    const before = {
      owner: owner.textContent.trim(), pill: pill.textContent.trim(),
      title: document.getElementById('wheelTitle').textContent.trim(),
    };
    const stateBefore = state();
    document.getElementById('languageNext').click();
    const after = {
      owner: owner.textContent.trim(), pill: pill.textContent.trim(),
      title: document.getElementById('wheelTitle').textContent.trim(),
    };
    const sameOwner = document.querySelector('#wheelSettled .wowner') === owner;
    const samePill = document.querySelector('#wheelSettled .wpill') === pill;
    const sameStage = document.getElementById('wheelStage') === stage;
    const sameAnimation = !moving || [...stage.querySelectorAll('*')]
      .flatMap((node) => node.getAnimations()).includes(moving);
    document.getElementById('languageNext').click();
    document.getElementById('languageNext').click();
    const restored = {
      owner: owner.textContent.trim(),
      title: document.getElementById('wheelTitle').textContent.trim(),
    };
    return { before, after, restored, sameOwner, samePill, sameStage, sameAnimation,
      stateBefore, stateAfter: state() };
  });
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
  const dual = { firstMs, secondMs, first, secondDeck, localizedOwner, second, played };
  out.dual = dual;
  check(dual.first.title === 'RUNE FOR YOU' && dual.second.title === 'RUNE FOR AI'
      && dual.secondDeck.settledOwner === 'YOU'
      && dual.secondDeck.ownerOutsidePill && dual.secondDeck.ownerAbovePill
      && dual.secondDeck.ownerGap >= 5 && dual.secondDeck.ownerGap <= 8
      && dual.secondDeck.pillText === dual.secondDeck.settledRune
      && dual.secondDeck.dot?.width >= 3.5 && dual.secondDeck.dot?.width <= 4.5
      && dual.secondDeck.dot?.height >= 3.5 && dual.secondDeck.dot?.height <= 4.5
      && dual.secondDeck.dot?.color === dual.secondDeck.dot?.ownerColor
      && dual.secondDeck.dot?.ownerColor === dual.secondDeck.dot?.playerColor,
    'the two shuffle beats do not identify which player receives each rune', dual);
  check(dual.localizedOwner.before.owner !== dual.localizedOwner.after.owner
      && dual.localizedOwner.before.title !== dual.localizedOwner.after.title
      && dual.localizedOwner.restored.owner === dual.localizedOwner.before.owner
      && dual.localizedOwner.restored.title === dual.localizedOwner.before.title
      && dual.localizedOwner.sameOwner && dual.localizedOwner.samePill
      && dual.localizedOwner.sameStage && dual.localizedOwner.sameAnimation
      && dual.localizedOwner.stateAfter === dual.localizedOwner.stateBefore,
    'locale repaint rebuilt, skipped, or restarted the owner eyebrow during the second shuffle', dual.localizedOwner);
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
    const title = document.getElementById('wheelTitle').getBoundingClientRect();
    const answers = [...document.querySelectorAll('#wheelSettled .wsett')];
    const answerBoxes = answers.map((answer) => answer.getBoundingClientRect());
    const pills = answers.map((answer) => answer.querySelector('.wpill').getBoundingClientRect());
    const owner = document.querySelector('#wheelSettled .wowner');
    const ownerBox = owner?.getBoundingClientRect();
    const ownedPill = owner?.parentElement?.querySelector('.wpill')?.getBoundingClientRect();
    const blurbs = [...document.querySelectorAll('#wheelSettled .wblurb')];
    return {
      count: answers.length,
      top: settled.top,
      bottom: settled.bottom,
      titleTop: title.top,
      viewport: innerHeight,
      blurbs: blurbs.map((node) => getComputedStyle(node).display),
      ownerOutsidePill: !!owner && !owner.closest('.wpill'),
      ownerGap: ownerBox && ownedPill
        ? Math.round((ownedPill.top - ownerBox.bottom) * 10) / 10 : -1,
      answerGap: answerBoxes.length === 2 ? answerBoxes[1].left - answerBoxes[0].right : -1,
      pillBottomSpread: pills.length === 2 ? Math.abs(pills[0].bottom - pills[1].bottom) : -1,
    };
  });
  check(out.dualLandscape.count === 2 && out.dualLandscape.top >= 0
      && out.dualLandscape.bottom <= out.dualLandscape.viewport
      && out.dualLandscape.bottom <= out.dualLandscape.titleTop
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
  out.dualOwnedLandscape = await page.evaluate(() => {
    const settled = document.getElementById('wheelSettled').getBoundingClientRect();
    const title = document.getElementById('wheelTitle').getBoundingClientRect();
    const owner = document.querySelector('#wheelSettled .wowner');
    const ownerBox = owner?.getBoundingClientRect();
    const pill = document.querySelector('#wheelSettled .wpill')?.getBoundingClientRect();
    const blurb = document.querySelector('#wheelSettled .wblurb');
    return {
      count: document.querySelectorAll('#wheelSettled .wsett').length,
      top: settled.top, bottom: settled.bottom, titleTop: title.top,
      ownerOutsidePill: !!owner && !owner.closest('.wpill'),
      ownerGap: ownerBox && pill ? Math.round((pill.top - ownerBox.bottom) * 10) / 10 : -1,
      blurb: blurb ? getComputedStyle(blurb).display : '',
    };
  });
  check(out.dualOwnedLandscape.count === 1 && out.dualOwnedLandscape.top >= 0
      && out.dualOwnedLandscape.bottom <= out.dualOwnedLandscape.titleTop
      && out.dualOwnedLandscape.ownerOutsidePill
      && out.dualOwnedLandscape.ownerGap >= 5 && out.dualOwnedLandscape.ownerGap <= 8
      && out.dualOwnedLandscape.blurb === 'none',
    'the owned rune eyebrow clipped or kept its rule in the short landscape lane', out.dualOwnedLandscape);
  await dismiss();

  await page.setViewportSize({ width: 320, height: 568 });
  await revealHeld('0', 'random2');
  await overlaps(page, 'dual-owned-320x568');
  out.dualOwnedPortrait = await page.evaluate(() => {
    const settled = document.getElementById('wheelSettled').getBoundingClientRect();
    const title = document.getElementById('wheelTitle').getBoundingClientRect();
    const owner = document.querySelector('#wheelSettled .wowner');
    const ownerBox = owner?.getBoundingClientRect();
    const pill = document.querySelector('#wheelSettled .wpill')?.getBoundingClientRect();
    const blurb = document.querySelector('#wheelSettled .wblurb');
    return {
      count: document.querySelectorAll('#wheelSettled .wsett').length,
      top: settled.top, bottom: settled.bottom, titleTop: title.top,
      ownerOutsidePill: !!owner && !owner.closest('.wpill'),
      ownerGap: ownerBox && pill ? Math.round((pill.top - ownerBox.bottom) * 10) / 10 : -1,
      blurb: blurb ? getComputedStyle(blurb).display : '',
    };
  });
  check(out.dualOwnedPortrait.count === 1 && out.dualOwnedPortrait.top >= 0
      && out.dualOwnedPortrait.bottom <= out.dualOwnedPortrait.titleTop
      && out.dualOwnedPortrait.ownerOutsidePill
      && out.dualOwnedPortrait.ownerGap >= 5 && out.dualOwnedPortrait.ownerGap <= 8
      && out.dualOwnedPortrait.blurb !== 'none',
    'the owned rune eyebrow clipped or lost its readable rule at 320px portrait', out.dualOwnedPortrait);
  await dismiss();
}
