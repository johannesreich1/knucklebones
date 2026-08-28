// THE DECK IS THE COLLECTION, NOT THE REGISTRY.
//
// The broad reveal test deals in local multiplayer, which deliberately exposes
// the whole roster. Versus the AI the deck must be exactly what could have been
// drawn: a fan showing a rune this device has never collected is a shuffle that
// cannot produce what it is offering. Both ×2 decks got that wrong until
// 2026-08-28 — only the SECOND was ever handed its candidates, so a player
// holding two runes watched six cards, then one.
import { SPELLS } from '../../../src/core/spells.ts';
import { lendCollectedRunes, restoreCollectedRunes } from './random-two-reveal.mjs';

/* One deal against the AI under a CHOSEN mode, so there is no dial to wait
   through and the only thing being read is the deck the shuffle assembled. */
async function collectedDeal(page, collected, spell) {
  await lendCollectedRunes(page, collected);
  await page.evaluate(() => {
    const k = window.__kb;
    k.goHome(); k.openPractice();
  });
  await page.click('#modeSeg button[data-m="cpu"]');
  await page.click('#modePick button[data-v="0"]');
  await page.click(`#spellPick button[data-v="${spell}"]`);
  await page.evaluate(() => { window.__kb.S.timer = 0; });
  await page.click('#btnPlay');
  await page.waitForSelector('#ovWheel.dealing .rdealt.up', { timeout: 15000 });
  const first = await page.evaluate(() => ({
    card: document.querySelector('.rdealt').dataset.rune,
    deck: [...document.querySelectorAll('.rcard')].map((e) => e.dataset.rune),
  }));
  let second = null;
  if (spell === 'random2') {
    await page.waitForFunction((shown) => {
      const card = document.querySelector('.rdealt');
      return card && card.dataset.rune !== shown && !card.classList.contains('up');
    }, first.card, { timeout: 10000 });
    second = await page.evaluate(() => ({
      deck: [...document.querySelectorAll('.rcard')].map((e) => e.dataset.rune),
    }));
    await page.waitForSelector('.rdealt.up', { timeout: 15000 });
    second.card = await page.evaluate(() => document.querySelector('.rdealt').dataset.rune);
  }
  await page.waitForFunction(() => document.querySelector('#ovWheel')?.classList.contains('holding'),
    null, { timeout: 10000 });
  await page.click('#ovWheel');
  await page.waitForFunction(() => !document.querySelector('#ovWheel')?.classList.contains('on'),
    null, { timeout: 8000 });
  await page.evaluate(() => { window.__kb.S.gen++; });
  return { first, second };
}

/* Leaves the whole roster collected again: a two-card fan is a different table
   from the six-card felt every geometry reading after this one measures. */
export async function verifyCollectedDecks(page, out, check) {
  const held = SPELLS.slice(0, 3).map(({ id }) => id);
  out.collectedDual = await collectedDeal(page, held, 'random2');
  check(out.collectedDual.first.deck.length === held.length
      && out.collectedDual.first.deck.every((rune) => held.includes(rune))
      && new Set(out.collectedDual.first.deck).size === held.length,
    'the first ×2 deck showed runes this device has not collected', out.collectedDual.first);
  check(out.collectedDual.second.deck.length === held.length - 1
      && out.collectedDual.second.deck.every((rune) => held.includes(rune))
      && !out.collectedDual.second.deck.includes(out.collectedDual.first.card),
    'the second ×2 deck was not the rest of the collection', out.collectedDual);

  const pair = SPELLS.slice(2, 4).map(({ id }) => id);
  out.collectedShared = await collectedDeal(page, pair, 'random');
  check(out.collectedShared.first.deck.length === pair.length
      && out.collectedShared.first.deck.every((rune) => pair.includes(rune))
      && pair.includes(out.collectedShared.first.card),
    'the shared RANDOM deck showed the whole registry instead of the collection',
    out.collectedShared.first);

  await restoreCollectedRunes(page, JSON.stringify({
    version: 1,
    accountId: '11111111-2222-4333-8444-555555555555',
    verifiedAt: 1,
    collected: SPELLS.map(({ id }) => id),
  }));
}
