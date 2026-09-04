// A PROMOTION WIDENS BOTH, TOGETHER.
//
// BONE hands over Row Multiply — its sole outcome unlock on curve v2, where
// Row Switch and Limited wait for GOLD. (Under v1 it handed over the last
// three ordinary modes at once, which is what this file used to say.) The
// picker and the wheel read one roster, so proving they widen together is the
// whole point: a ring built from its own list is how they drift.
import { pressOnSetupSheet } from './hittable.mjs';

export async function verifyPromotedRoster(page, out, check) {
  await page.evaluate(() => {
    const account = '11111111-2222-4333-8444-555555555555';
    localStorage.setItem('knucklebones.runes.v1', JSON.stringify({
      version: 1,
      accountId: account,
      verifiedAt: 1,
      collected: [],
      poolTier: 'bone',
    }));
    /* The pool tier alone described a BONE player under v1, where the tier WAS
       the entitlement. v2 wants the account-owned grant list and exposes clean
       STONE without it (local-options.ts), so the tier by itself promoted
       nobody and the picker stayed on STONE's four. */
    localStorage.setItem('knucklebones.progression.v1', JSON.stringify({
      version: 1,
      accountId: account,
      confirmedAt: 1,
      curveVersion: 2,
      scoringVersion: 2,
      admissionPaused: false,
      outcomes: ['classic', 'singlestrike', 'colshield', 'bounty', 'rowmult'],
      weeklyUnlocked: false,
      pendingBotDebuts: [],
      neonMedalSeasons: [],
      weekly: null,
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
  /* BONE's five on curve v2: STONE's four plus Row Multiply, which is its sole
     outcome unlock (docs/MODES.md). Under v1 BONE opened all seven ordinary
     modes at once, which is why this listed them all; v2 holds Row Switch and
     Limited back to GOLD, so promotion here must widen the roster and NOT
     finish it. Both halves are checked — a BONE that opened everything would
     have passed the old assertion and be wrong now. */
  const BONE_OPEN = ['0', '3', '4', '5', '2'];   // classic, colshield, singlestrike, bounty, rowmult
  const BONE_HELD = ['1', '6'];                  // rowswitch, limited — GOLD
  check(BONE_OPEN.every((v) => out.bonePicker[v] === false)
      && BONE_HELD.every((v) => out.bonePicker[v] === true),
    'BONE did not open exactly its own five ordinary modes', out.bonePicker);
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
  check(out.boneRing.length === 5 && new Set(out.boneRing).size === 5
      && out.boneRing.includes('rowmult')
      && !out.boneRing.includes('limited') && !out.boneRing.includes('rune_trial'),
    'the BONE wheel did not widen to exactly its five ordinary modes', out.boneRing);
}
