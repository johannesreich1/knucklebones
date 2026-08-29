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
    if (!seat) {
      /* THE CARDS SIT IN THE MIDDLE OF THE SHEET, and the clock sits under them
         rather than shoving them upwards. A child with margin-top:auto in this
         centred column eats the free space and pins everything above it to the
         top — which is what the countdown did when it was first added, and is
         invisible to any assertion that only asks whether the cards exist. */
      out.ritualChoiceLayout = await page.evaluate(() => {
        const box = (selector) => {
          const el = document.querySelector(selector);
          if (!el || el.hidden) return null;
          const r = el.getBoundingClientRect();
          return r.height > 0 ? { top: r.top, bottom: r.bottom, mid: r.top + r.height / 2 } : null;
        };
        return {
          viewportMid: window.innerHeight / 2,
          cards: box('#trialSelectCards'),
          clock: box('#trialSelectClock'),
          who: box('#trialSelectWho'),
        };
      });
      const layout = out.ritualChoiceLayout;
      check(!!layout.cards, 'the Ritual choice painted no cards at all', layout);
      /* Generous: this separates "centred" from "pinned to the top", and must
         not become a pixel budget that fails on a taller phone. */
      check(!!layout.cards
        && Math.abs(layout.cards.mid - layout.viewportMid) < layout.viewportMid * 0.25,
      'the Ritual choice is pinned to the top of the sheet instead of centred', layout);
      check(!layout.clock || layout.clock.top >= layout.cards.bottom - 1,
        'the pick countdown is not below the cards', layout);
      /* Local play has no pairing to show — ranked passes one, this does not. */
      check(!layout.who, 'the local Ritual choice printed a ranked versus line', layout);
    }
    const card = await page.getAttribute('#trialSelectCards button', 'data-rune');
    await page.click(`#trialSelectCards button[data-rune="${card}"]`);
  }
  await page.waitForFunction(() => document.querySelector('#ovWheel')?.classList.contains('holding'),
    null, { timeout: 20000 });
  out.ritualRevealed = await page.evaluate(() => {
    /* PAINTED, not present. The settled strip and the two readout lines are
       still built — a beat still HAS a name and a blurb, and assistive tech
       may quote them — so counting nodes would pass whether the player sees
       them or not. Measure the box. */
    const shown = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const owners = [...document.querySelectorAll('#wheelStage .trial-reveal__owner')];
    return {
      ...window.__ritualWatch,
      turned: [...document.querySelectorAll('#wheelStage .trial-reveal__card')]
        .map((c) => c.classList.contains('up')),
      title: document.querySelector('#wheelTitle .wtitlecopy')?.textContent?.trim() ?? '',
      settledShown: shown('#wheelSettled'),
      nameShown: shown('#wheelName'),
      blurbShown: shown('#wheelBlurb'),
      owners: owners.map((owner) => ({
        name: owner.querySelector('.nm')?.textContent?.trim() ?? '',
        dot: getComputedStyle(owner.querySelector('.dot')).backgroundColor,
      })),
    };
  });
  check(out.ritualRevealed.dials === 1 && out.ritualRevealed.opens === 1,
    'the Ritual reveal spun the dial or opened the overlay more than once', out.ritualRevealed);
  check(out.ritualRevealed.turned.length === 2 && out.ritualRevealed.turned.every(Boolean),
    'both hands did not turn over', out.ritualRevealed);

  /* TITLE AND CARDS, NOTHING ELSE (owner call 2026-08-29). The stage already
     names both players and both runes; the restated mode, the "revealed" line
     and the pair sentence were three more things to read for something already
     on screen. They are hidden rather than emptied — an empty line still holds
     its height and reads as a missing answer. */
  check(!!out.ritualRevealed.title,
    'the Ritual reveal lost its title as well', out.ritualRevealed);
  check(!out.ritualRevealed.settledShown && !out.ritualRevealed.nameShown
      && !out.ritualRevealed.blurbShown,
    'the Ritual reveal still prints the settled mode or its readout lines',
    out.ritualRevealed);
  /* Each name wears its own player dot, the board's idiom, in the side's hue —
     two distinct colours, so a shared or unpainted dot cannot pass. */
  check(out.ritualRevealed.owners.length === 2
      && out.ritualRevealed.owners.every(({ name, dot }) => name
        && dot && dot !== 'rgba(0, 0, 0, 0)')
      && out.ritualRevealed.owners[0].dot !== out.ritualRevealed.owners[1].dot,
    'the Ritual card owners are missing their coloured dots', out.ritualRevealed.owners);

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

  /* THE RANKED SHEET IS THE ONE THAT SHIPS, and it is the only one that carries
     both a pairing and a clock — the two things that decide the layout. It
     needs a live match to reach, so drive it through the presentation hook and
     measure what the player would see. This is the shape the countdown broke:
     a clock with margin-top:auto ate the free space and pinned the cards to the
     top, which the local sheet above cannot reproduce because it has no clock. */
  out.rankedChoiceLayout = await page.evaluate(async () => {
    /* Offline reveals carry no pairing (.dwho:empty is display:none), so give
       the reveal one — that is the ranked condition the alignment exists for,
       and the sheet aligns to whatever is actually beneath it. */
    const beneath = document.getElementById('wheelWho');
    beneath.innerHTML = '<span class="dside me"><span class="dav"></span>'
      + '<span class="dnm">BadRandolf</span><span class="rt">462</span></span>'
      + '<span class="dvs">VS</span>'
      + '<span class="dside foe"><span class="dav"></span>'
      + '<span class="dnm">BoldFox762</span><span class="rt">555</span></span>';
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const done = window.__kbTrialPick(['fate', 'ward', 'sunder'], {
      player: { name: () => 'YOU', hue: 'var(--p1)' },
      deadline: () => new Date(Date.now() + 10_000).toISOString(),
      versus: {
        me: { name: 'BadRandolf', rating: 1200, avatar: 'die:3:cy' },
        foe: { name: 'VelvetPixel129', rating: 1310, avatar: 'die:4:mg' },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 260));
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return r.height > 0 ? { top: r.top, bottom: r.bottom, mid: r.top + r.height / 2 } : null;
    };
    const read = {
      viewportMid: window.innerHeight / 2,
      /* The reveal's OWN pairing, mounted underneath this sheet. The player
         moves between these two screens without a transition, so a pairing
         that jumps between them is the fault being pinned. */
      revealWho: box('#wheelWho'),
      who: box('#trialSelectWho'),
      cards: box('#trialSelectCards'),
      clock: box('#trialSelectClock'),
      count: document.getElementById('trialSelectCount')?.textContent?.trim() ?? '',
      names: [...document.querySelectorAll('#trialSelectWho .dnm')].map((n) => n.textContent),
    };
    document.querySelector('#trialSelectCards button')?.click();
    await done;
    return read;
  });
  const ranked = out.rankedChoiceLayout;
  check(!!ranked.who && ranked.names.join('|') === 'BadRandolf|VelvetPixel129',
    'the ranked choice sheet lost the pairing the reveal was showing', ranked);
  /* SAME PLACE, not merely present. NOTE THIS IS A WEAK CHECK: the pairing
     injected above sits where an offline reveal puts it, which is close to the
     sheet's own fallback, so it passes with the alignment removed and does NOT
     guard it — verified, not assumed. It still catches a gross jump. Proving
     the alignment needs a reveal laid out as RANKED lays it out, which is the
     same fixture gap tracked for the refused aim. */
  check(!!ranked.who && !!ranked.revealWho
    && Math.abs(ranked.who.top - ranked.revealWho.top) <= 1,
  'THE PAIRING JUMPS BETWEEN THE REVEAL AND THE CHOICE SHEET',
  { choice: ranked.who, reveal: ranked.revealWho });
  check(!!ranked.cards && !!ranked.who && ranked.who.bottom <= ranked.cards.top,
    'the pairing is not above the cards', ranked);
  check(!!ranked.clock && !!ranked.cards && ranked.clock.top >= ranked.cards.bottom - 1,
    'the pick countdown is not below the cards', ranked);
  /* 15% of half the viewport. Measured at 52px here against a 466px half, and
     the layout this replaced measured 139 — so the budget separates the two
     rather than merely admitting the one that ships. The remaining offset is
     the title and prompt sitting above the cards inside the centred column. */
  check(!!ranked.cards
    && Math.abs(ranked.cards.mid - ranked.viewportMid) < ranked.viewportMid * 0.15,
  'THE RANKED CHOICE IS PINNED TO THE TOP INSTEAD OF CENTRED', ranked);
  check(/^\d+$/.test(ranked.count) && Number(ranked.count) <= 10 && Number(ranked.count) > 0,
    'the pick countdown is not showing a live number', ranked);
}
