// A PROMOTION WIDENS BOTH, TOGETHER.
//
// BONE is the tier that hands over the last three ordinary modes. The picker
// and the wheel read one roster, so proving they widen together is the whole
// point: a ring built from its own list is how they drift.
import { pressOnSetupSheet } from './hittable.mjs';

export async function verifyPromotedRoster(page, out, check) {
  await page.evaluate(() => {
    localStorage.setItem('knucklebones.runes.v1', JSON.stringify({
      version: 1,
      accountId: '11111111-2222-4333-8444-555555555555',
      verifiedAt: 1,
      collected: [],
      poolTier: 'bone',
    }));
  });
  /* Reopening is its own problem: the Ritual above left a game starting, and
     starting one hides this sheet. openSetupSheet owns that race. */
  await page.waitForTimeout(700);          // clear tap()'s global native-click guard
  /* DRIVE IT THE WAY A PLAYER DOES. In the app a confirmed collection arrives
     through writeRuneCollectionSnapshot, which publishes to the rows; a test
     that writes the cache key directly has skipped that, so it must activate
     the choice slot with the real control. __kb.openPractice() only shows the
     sheet — it is a visibility hook, not the menu's openPractice. */
  await pressOnSetupSheet(page, '#modeSeg button[data-m="cpu"]');
  await page.waitForTimeout(150);
  out.bonePicker = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('#modePick button')].map((b) => [b.dataset.v,
      b.classList.contains('locked')])));
  check(['0', '1', '2', '3', '4', '5', '6'].every((v) => out.bonePicker[v] === false),
    'BONE still locked one of the seven ordinary modes', out.bonePicker);
  check(out.bonePicker['-2'] === true,
    'BONE offered Rune Ritual, which belongs to IVORY', out.bonePicker);

  await page.click('#modePick button[data-v="-1"]');
  await page.evaluate(() => {
    window.__kb.S.spell = ''; window.__kb.S.timer = 0;
    const play = document.getElementById('btnPlay');
    const box = play.getBoundingClientRect();
    const at = { bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    play.dispatchEvent(new PointerEvent('pointerdown', at));
    play.dispatchEvent(new PointerEvent('pointerup', at));
  });
  await page.waitForSelector('#ovWheel.hunting', { timeout: 8000 });
  out.boneRing = await page.evaluate(() =>
    [...document.querySelectorAll('#wheelDial .dnode')].map((n) => n.dataset.mode));
  check(out.boneRing.length === 7 && new Set(out.boneRing).size === 7
      && out.boneRing.includes('bounty') && !out.boneRing.includes('rune_trial'),
    'the BONE wheel did not widen to the seven ordinary modes', out.boneRing);
}
