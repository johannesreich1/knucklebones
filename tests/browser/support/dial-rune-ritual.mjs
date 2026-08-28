// RANDOM CAN LAND ON RUNE RITUAL, AND THE DIAL STILL RUNS ONCE.
//
// The Ritual answers RANDOM with a private choice instead of a rule, and that
// choice belongs to the reveal the dial just landed: the cards open ON TOP of
// the overlay that is still showing the mode, and both hands turn over on that
// same stage, under one countdown. What this replaced spun, closed, took the
// choice on a screen of its own, and opened the overlay a SECOND time to show
// the runes — "it spins again and I see the runes again" (user report,
// 2026-08-28). So one dial and one overlay is the whole contract.
import { primeRandomStart, SEED_LANDS_ON_RITUAL } from './random-start.mjs';

export async function verifyRitualLanding(page, out, check) {
  await page.waitForFunction(() => !document.querySelector('#ovWheel')?.classList.contains('on'),
    null, { timeout: 20000 });
  await page.evaluate(() => {
    const k = window.__kb;
    k.goHome(); k.openPractice();
    k.S.mode = 'duo'; k.S.seat = 'face'; k.S.timer = 0; k.S.spell = ''; k.S.localMode = -1;
    const overlay = document.getElementById('ovWheel');
    const watch = { dials: 0, opens: 0, wasOn: overlay.classList.contains('on') };
    window.__ritualWatch = watch;
    new MutationObserver(() => {
      const on = overlay.classList.contains('on');
      if (on && !watch.wasOn) watch.opens++;
      watch.wasOn = on;
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(() => {
      if (document.getElementById('wheelDial')) watch.dials++;
    }).observe(document.getElementById('wheelStage'), { childList: true });
  });
  await page.waitForTimeout(700);          // clear tap()'s global native-click guard
  /* Local multiplayer is the one setup always offered a Ritual, so this is
     where the seed can reach it. Why the prime and the press are one task, and
     why the seed survives both mode-weight regimes, is random-start.mjs. */
  await page.evaluate(primeRandomStart, SEED_LANDS_ON_RITUAL);
  await page.waitForSelector('#ovWheel.landed', { timeout: 20000 });
  out.ritualDraw = await page.evaluate(() =>
    document.querySelector('#wheelDial .dnode.on')?.dataset.mode ?? null);
  check(out.ritualDraw === 'rune_trial',
    'the fixed RANDOM draw did not reach Rune Ritual — the seed stub was eaten',
    out.ritualDraw);
  await page.waitForSelector('#ovTrialSelect.on.handoff', { timeout: 20000 });
  /* The mode is still on the stage behind the choice, and the choice is what a
     tap reaches: one room in front of another, not one room after another. */
  out.ritualChoosing = await page.evaluate(() => {
    const picker = document.getElementById('ovTrialSelect');
    const box = picker.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      wheelOn: document.getElementById('ovWheel').classList.contains('on'),
      dialOnStage: !!document.getElementById('wheelDial'),
      found: document.querySelector('#wheelDial .dnode.on')?.dataset.mode ?? null,
      pickerOwnsHit: picker.contains(hit),
    };
  });
  check(out.ritualChoosing.wheelOn && out.ritualChoosing.dialOnStage
      && out.ritualChoosing.found === 'rune_trial' && out.ritualChoosing.pickerOwnsHit,
    'the Ritual choice did not open over the reveal that found it', out.ritualChoosing);
  for (const seat of [0, 1]) {
    if (seat) await page.waitForSelector('#ovTrialSelect.on.handoff', { timeout: 20000 });
    await page.click('#trialSelectReady');
    await page.waitForSelector('#ovTrialSelect.on:not(.handoff) #trialSelectCards button',
      { timeout: 20000 });
    const card = await page.getAttribute('#trialSelectCards button', 'data-rune');
    await page.click(`#trialSelectCards button[data-rune="${card}"]`);
  }
  await page.waitForFunction(() => document.querySelector('#ovWheel')?.classList.contains('holding'),
    null, { timeout: 20000 });
  out.ritualRevealed = await page.evaluate(() => ({
    ...window.__ritualWatch,
    settled: [...document.querySelectorAll('#wheelSettled .wsett .wpill b')].map((b) => b.textContent),
    turned: [...document.querySelectorAll('#wheelStage .trial-reveal__card')]
      .map((c) => c.classList.contains('up')),
  }));
  check(out.ritualRevealed.dials === 1 && out.ritualRevealed.opens === 1,
    'the Ritual reveal spun the dial or opened the overlay more than once', out.ritualRevealed);
  check(out.ritualRevealed.settled.length === 1 && out.ritualRevealed.turned.length === 2
      && out.ritualRevealed.turned.every(Boolean),
    'both hands did not turn over under the mode the dial had settled', out.ritualRevealed);

  /* AND THE OVERLAY COMES OFF EVEN WHEN THE ACT THROWS. A deferred act does
     server work — ranked throws outright on a Trial offer this build cannot
     read — and the reveal is full-screen with no dismissal of its own until
     the hold installs one. An escaping rejection therefore used to mean a
     frozen room and a reload. Nothing a player taps can produce it, so it is
     driven through the published reveal. */
  await page.waitForTimeout(200);
  out.revealThrew = await page.evaluate(async () => {
    const overlay = document.getElementById('ovWheel');
    let threw = false;
    try {
      await window.__kb.reveal({
        mode: { id: 'classic' },
        trial: { resolve: () => Promise.reject(new Error('offer unreadable')) },
      });
    } catch { threw = true; }
    return {
      threw,
      on: overlay.classList.contains('on'),
      dressed: overlay.className.replace(/\s+/g, ' ').trim(),
      hit: document.elementFromPoint(215, 466) === overlay,
    };
  });
  check(out.revealThrew.threw && !out.revealThrew.on && !out.revealThrew.hit,
    'a rejected act left the reveal on screen with nothing to dismiss it', out.revealThrew);
}
