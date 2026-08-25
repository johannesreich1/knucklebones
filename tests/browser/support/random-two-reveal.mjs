// Player-visible RANDOM ×2 contracts shared by the broad reveal owner test.
// Keep the full two-beat story together: each honest shuffle names its owner,
// deals the card it showed, and reaches one compact final countdown.
import {
  gameCopyFor,
  localeCycleFrom,
  observeLocale,
  repaintRandomTwoOwner,
  verifyRandomTwoLocaleRepaint,
} from './locale-reveal.mjs';

async function inspectActiveHeading(page) {
  return page.evaluate(() => {
    const title = document.getElementById('wheelTitle');
    const prompt = title?.querySelector('.wtitlecopy');
    const owner = document.getElementById('wheelOwner');
    const stage = document.getElementById('wheelStage');
    const titleBox = title?.getBoundingClientRect();
    const promptBox = prompt?.getBoundingClientRect();
    const ownerBox = owner?.getBoundingClientRect();
    const stageBox = stage?.getBoundingClientRect();
    const ownerStyle = owner ? getComputedStyle(owner) : null;
    const dot = owner ? getComputedStyle(owner, '::before') : null;
    const visibleCards = [...document.querySelectorAll('#wheelStage .rcard, #wheelStage .rdealt')]
      .filter((card) => {
        const style = getComputedStyle(card);
        return style.visibility !== 'hidden' && Number(style.opacity) > 0;
      }).map((card) => card.getBoundingClientRect());
    const visualCardTop = visibleCards.length
      ? Math.min(...visibleCards.map((card) => card.top)) : stageBox?.top ?? 0;
    return {
      prompt: prompt?.textContent.trim() ?? '',
      owner: owner?.textContent.trim() ?? '',
      ownerHidden: owner?.hidden ?? true,
      ownerClass: owner?.classList.contains('wowner') ?? false,
      inlineColor: owner?.style.color ?? '',
      promptOwnerGap: promptBox && ownerBox
        ? Math.round((ownerBox.top - promptBox.bottom) * 10) / 10 : -1,
      titleStageGap: titleBox && stageBox
        ? Math.round((stageBox.top - titleBox.bottom) * 10) / 10 : -1,
      promptAboveOwner: !!promptBox && !!ownerBox && promptBox.bottom <= ownerBox.top,
      ownerAboveStage: !!ownerBox && !!stageBox && ownerBox.bottom <= stageBox.top,
      visualCardGap: ownerBox
        ? Math.round((visualCardTop - ownerBox.bottom) * 10) / 10 : -1,
      paint: ownerStyle && dot ? {
        fontSize: parseFloat(ownerStyle.fontSize), fontWeight: ownerStyle.fontWeight,
        letterSpacing: ownerStyle.letterSpacing, lineHeight: ownerStyle.lineHeight,
        color: ownerStyle.color, dotColor: dot.backgroundColor,
        dotWidth: parseFloat(dot.width), dotHeight: parseFloat(dot.height),
      } : null,
    };
  });
}

export async function verifyRandomTwoReveal(page, out, check, collected) {
  const initialLocale = await observeLocale(page);
  const [beforeLocale, afterLocale] = localeCycleFrom(initialLocale, 1);
  const beforeGame = gameCopyFor(beforeLocale);
  /* Boot hydrates account preferences lazily. Its session check correctly
     removes a cache that is not bound to a live account, so let that one-time
     reconciliation consume the init-script sentinel before installing this
     scenario's returning-player fixture. */
  await page.waitForFunction(() => !localStorage.getItem('knucklebones.runes.v1'),
    null, { timeout: 20000 });
  await page.evaluate((runes) => {
    /* This CPU scenario owns the two-player labels. Reinstall its verified
       collection after startup reconciliation so RANDOM ×2 is admitted for
       the same reason it is admitted for a returning player. */
    localStorage.setItem('knucklebones.runes.v1', JSON.stringify({
      version: 1,
      accountId: '11111111-2222-4333-8444-555555555555',
      verifiedAt: 1,
      collected: runes,
    }));
    const k = window.__kb;
    k.goHome(); k.openPractice();
  }, collected);
  /* Use the setup controls so changing from the preceding local-duo scenario
     activates the CPU choice slot before selecting RANDOM x2. Assigning
     S.mode directly bypasses that slot switch and startLocal() correctly
     restores the old empty CPU rune choice. */
  await page.click('#modeSeg button[data-m="cpu"]');
  await page.click('#modePick button[data-v="0"]');
  await page.click('#spellPick button[data-v="random2"]');
  await page.evaluate(() => { window.__kb.S.timer = 0; });
  const selectedSpell = await page.evaluate(() => window.__kb.S.spell);
  const started = Date.now();
  await page.click('#btnPlay');
  await page.waitForSelector('#ovWheel.dealing.hunting #wheelOwner:not([hidden])', { timeout: 8000 });
  const firstHeading = await inspectActiveHeading(page);
  await page.waitForSelector('.rdealt.up', { timeout: 12000 });
  const firstMs = Date.now() - started;
  const first = await page.evaluate(() => {
    const card = document.querySelector('.rdealt');
    return {
      card: card.dataset.rune,
      title: document.querySelector('#wheelTitle .wtitlecopy').textContent.trim(),
      deck: [...document.querySelectorAll('.rcard')].map((item) => item.dataset.rune),
    };
  });
  await page.waitForFunction((firstCard) => {
    const card = document.querySelector('.rdealt');
    return card && card.dataset.rune !== firstCard && !card.classList.contains('up');
  }, first.card, { timeout: 8000 });
  const secondStarted = Date.now();
  const secondHeading = await inspectActiveHeading(page);
  const secondDeck = await page.evaluate(() => {
    const owner = document.querySelector('#wheelSettled .wowner');
    const pill = document.querySelector('#wheelSettled .wpill');
    const ownerBox = owner?.getBoundingClientRect();
    const pillBox = pill?.getBoundingClientRect();
    const ownerStyle = owner ? getComputedStyle(owner) : null;
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
      ownerFontSize: ownerStyle ? parseFloat(ownerStyle.fontSize) : 0,
      ownerFontWeight: ownerStyle?.fontWeight ?? '',
      ownerLetterSpacing: ownerStyle?.letterSpacing ?? '',
      ownerLineHeight: ownerStyle?.lineHeight ?? '',
      dot: dot ? {
        width: parseFloat(dot.width), height: parseFloat(dot.height),
        color: dot.backgroundColor, ownerColor: ownerStyle.color, playerColor,
      } : null,
    };
  });
  await page.waitForFunction(() => [...document.querySelectorAll('#wheelStage *')]
    .some((node) => node.getAnimations().some((animation) => animation.playState === 'running')),
  null, { timeout: 1000 });
  /* Locale repaint must update the new eyebrow in place while the second deck
     is still moving. Rebuilding either node would restart the visual story. */
  const localizedOwner = await repaintRandomTwoOwner(page, beforeLocale);
  await page.waitForSelector('.rdealt.up', { timeout: 12000 });
  const secondMs = Date.now() - secondStarted;
  await page.waitForFunction(() => document.querySelector('#ovWheel')?.classList.contains('holding'),
    null, { timeout: 8000 });
  const second = await page.evaluate(() => ({
    card: document.querySelector('.rdealt').dataset.rune,
    title: document.querySelector('#wheelTitle .wtitlecopy').textContent.trim(),
    owner: document.getElementById('wheelOwner').textContent.trim(),
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
  const dual = { selectedSpell, firstMs, secondMs, firstHeading, first, secondHeading, secondDeck,
    localizedOwner, second, played };
  out.dual = dual;
  check(dual.first.title === beforeGame.reveal.runeFor
      && dual.firstHeading.owner === beforeGame.player.you
      && dual.firstHeading.inlineColor === 'var(--p1)'
      && dual.second.title === beforeGame.reveal.runeFor
      && dual.second.owner === beforeGame.player.ai
      && dual.secondHeading.prompt === beforeGame.reveal.runeFor
      && dual.secondHeading.owner === beforeGame.player.ai
      && dual.secondHeading.inlineColor === 'var(--p2)'
      && !dual.firstHeading.ownerHidden && !dual.secondHeading.ownerHidden
      && dual.firstHeading.ownerClass && dual.secondHeading.ownerClass
      && dual.firstHeading.promptAboveOwner && dual.secondHeading.promptAboveOwner
      && dual.firstHeading.ownerAboveStage && dual.secondHeading.ownerAboveStage
      && dual.firstHeading.promptOwnerGap >= 5 && dual.firstHeading.promptOwnerGap <= 8
      && dual.secondHeading.promptOwnerGap >= 5 && dual.secondHeading.promptOwnerGap <= 8
      && dual.firstHeading.titleStageGap >= 5 && dual.secondHeading.titleStageGap >= 5
      && dual.firstHeading.visualCardGap >= 5.5 && dual.secondHeading.visualCardGap >= 5.5
      && dual.secondDeck.settledOwner === beforeGame.player.you
      && dual.secondDeck.ownerOutsidePill && dual.secondDeck.ownerAbovePill
      && dual.secondDeck.ownerGap >= 5 && dual.secondDeck.ownerGap <= 8
      && dual.secondDeck.ownerFontSize === 10
      && dual.secondHeading.paint?.fontSize === dual.secondDeck.ownerFontSize
      && dual.secondHeading.paint?.fontWeight === dual.secondDeck.ownerFontWeight
      && dual.secondHeading.paint?.letterSpacing === dual.secondDeck.ownerLetterSpacing
      && dual.secondHeading.paint?.lineHeight === dual.secondDeck.ownerLineHeight
      && dual.secondHeading.paint?.dotWidth === dual.secondDeck.dot?.width
      && dual.secondHeading.paint?.dotHeight === dual.secondDeck.dot?.height
      && dual.secondHeading.paint?.dotColor === dual.secondHeading.paint?.color
      && dual.secondDeck.pillText === dual.secondDeck.settledRune
      && dual.secondDeck.dot?.width >= 3.5 && dual.secondDeck.dot?.width <= 4.5
      && dual.secondDeck.dot?.height >= 3.5 && dual.secondDeck.dot?.height <= 4.5
      && dual.secondDeck.dot?.color === dual.secondDeck.dot?.ownerColor
      && dual.secondDeck.dot?.ownerColor === dual.secondDeck.dot?.playerColor,
    'the two shuffle beats do not identify which player receives each rune', dual);
  verifyRandomTwoLocaleRepaint(dual.localizedOwner, beforeLocale, afterLocale, check);
  check(dual.first.card === dual.played.me && dual.second.card === dual.played.ai
      && dual.played.me !== dual.played.ai && dual.selectedSpell === 'random2',
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
      titleBottom: title.bottom,
      promptBottom: titleCopy.bottom,
      activeOwnerTop: activeOwnerBox.top,
      activeOwnerBottom: activeOwnerBox.bottom,
      activeOwner: activeOwner.textContent.trim(),
      stageTop: stage.top,
      visualCardTop: Math.min(...visibleCards.map((card) => card.top)),
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
  out.dualOwnedLandscape = await page.evaluate(() => {
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
    const owner = document.querySelector('#wheelSettled .wowner');
    const ownerBox = owner?.getBoundingClientRect();
    const pill = document.querySelector('#wheelSettled .wpill')?.getBoundingClientRect();
    const blurb = document.querySelector('#wheelSettled .wblurb');
    return {
      count: document.querySelectorAll('#wheelSettled .wsett').length,
      top: settled.top, bottom: settled.bottom, titleTop: title.top,
      titleBottom: title.bottom, promptBottom: titleCopy.bottom,
      activeOwnerTop: activeOwnerBox.top, activeOwnerBottom: activeOwnerBox.bottom,
      activeOwner: activeOwner.textContent.trim(), stageTop: stage.top,
      visualCardTop: Math.min(...visibleCards.map((card) => card.top)),
      ownerOutsidePill: !!owner && !owner.closest('.wpill'),
      ownerGap: ownerBox && pill ? Math.round((pill.top - ownerBox.bottom) * 10) / 10 : -1,
      blurb: blurb ? getComputedStyle(blurb).display : '',
    };
  });
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
  out.dualOwnedPortrait = await page.evaluate(() => {
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
    const owner = document.querySelector('#wheelSettled .wowner');
    const ownerBox = owner?.getBoundingClientRect();
    const pill = document.querySelector('#wheelSettled .wpill')?.getBoundingClientRect();
    const blurb = document.querySelector('#wheelSettled .wblurb');
    return {
      count: document.querySelectorAll('#wheelSettled .wsett').length,
      top: settled.top, bottom: settled.bottom, titleTop: title.top,
      titleBottom: title.bottom, promptBottom: titleCopy.bottom,
      activeOwnerTop: activeOwnerBox.top, activeOwnerBottom: activeOwnerBox.bottom,
      activeOwner: activeOwner.textContent.trim(),
      settledOwner: owner?.textContent.trim() ?? '', stageTop: stage.top,
      visualCardTop: Math.min(...visibleCards.map((card) => card.top)),
      ownerOutsidePill: !!owner && !owner.closest('.wpill'),
      ownerGap: ownerBox && pill ? Math.round((pill.top - ownerBox.bottom) * 10) / 10 : -1,
      blurb: blurb ? getComputedStyle(blurb).display : '',
    };
  });
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
