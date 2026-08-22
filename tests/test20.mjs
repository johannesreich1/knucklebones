// THE RUNE DEAL: what the player is dealt is what the card said.
//
// RANDOM spell offline draws a rune for both seats, and since 2026-08-22 the
// draw is SHOWN: the deck shuffles and one card turns over. Three things have
// to hold, and only one of them is visible in the animation:
//   · the rune the card names is the rune both seats then carry (a second draw
//     inside newGame would look identical on screen and be wrong every time —
//     the exact bug the mode dial's `opts.scoring` exists to prevent),
//   · the card that turns over shows its FACE. The first build flipped it in
//     3D, and one grouping property above it (this overlay carries a
//     backdrop-filter) flattened the 3D context, so the card turned and showed
//     its BACK while the readout named the rune. State and DOM agreed perfectly
//     the whole time — only a computed style can see it.
//   · the card comes out of the SLOT the shuffle put it in. A card that always
//     appeared from the middle made the shuffle decoration — nothing that
//     happened to the deck could have decided anything.
//   · the shuffle takes real time. "Too quick" is the note the whole beat
//     exists to answer, and a shuffle is the one part a screenshot cannot check.
//
// Plus the deck's own contract: it is the WHOLE roster, cut fresh each deal.
import pkg from 'playwright';
const { chromium } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the tutorial offer is test19's subject
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message));
  await page.goto(F);
  await page.waitForTimeout(400);

  /* one deal, driven exactly as a player drives it: pick RANDOM in the spell
     row, press Play, and read only what is on screen */
  const deal = async (localMode) => {
    await page.evaluate((m) => {
      const k = window.__kb;
      k.goHome(); k.openPractice();
      document.querySelector(`#modePick button[data-v="${m}"]`).click();
      document.querySelector('#spellPick button[data-v="random"]').click();
      k.S.timer = 0;
    }, localMode);
    await page.click('#btnPlay');
    await page.waitForSelector('#ovWheel.dealing', { timeout: 14000 });
    const t0 = Date.now();
    const shuffling = await page.evaluate(() => ({
      named: document.querySelector('#wheelName').textContent.trim(),
      turned: !!document.querySelector('.rdealt.up'),
      deck: [...document.querySelectorAll('.rcard')].map((e) => e.dataset.rune),
      hold: getComputedStyle(document.querySelector('.dhold')).visibility,
    }));
    await page.waitForSelector('.rdealt.up', { timeout: 12000 });
    const shuffleMs = Date.now() - t0;
    await page.waitForTimeout(700);          // the turn itself
    const turned = await page.evaluate(() => {
      const d = document.querySelector('.rdealt');
      const face = getComputedStyle(d.querySelector('.rface'));
      const back = getComputedStyle(d.querySelector('.rback'));
      const deck = [...document.querySelectorAll('.rcard')];
      return {
        card: d.dataset.rune,
        label: d.querySelector('.rlbl').textContent.trim(),
        // which slot of the fan the card came out of, and that only one left
        drawnSlot: deck.findIndex((e) => e.classList.contains('drawn')),
        drawnRune: deck.find((e) => e.classList.contains('drawn'))?.dataset.rune ?? null,
        deck: deck.map((e) => e.dataset.rune),
        stillInFan: deck.filter((e) => getComputedStyle(e).visibility === 'visible').length,
        faceOpacity: +face.opacity, backOpacity: +back.opacity,
        faceBg: face.backgroundImage !== 'none',
        named: document.querySelector('#wheelName').textContent.trim(),
        settled: [...document.querySelectorAll('.wsett')].map((e) => ({
          name: e.querySelector('.wpill').textContent.trim(),
          rule: e.querySelector('.wblurb').textContent.trim(),
        })),
        hold: getComputedStyle(document.querySelector('.dhold')).visibility,
      };
    });
    await page.click('#ovWheel');            // "I have read it" — cuts the hold short
    await page.waitForFunction(() => !document.querySelector('#ovWheel')?.classList.contains('on'),
      null, { timeout: 8000 });
    const played = await page.evaluate(() => ({
      // the rune BOTH seats hold, named by the registry's stable id
      mine: Object.keys(window.__kb.S.spellCharges[1])[0] ?? null,
      theirs: Object.keys(window.__kb.S.spellCharges[0])[0] ?? null,
      mode: window.__kb.modeByEnum(window.__kb.S.scoring).id,
    }));
    return { shuffling, shuffleMs, turned, played };
  };

  // ---- a deal under a mode the player CHOSE: one beat, one countdown ----
  const solo = await deal('0');                                   // 0 = CLASSIC
  out.solo = solo;
  check(solo.shuffling.named === '', 'the deal named its rune while still shuffling', solo.shuffling);
  check(!solo.shuffling.turned, 'the card was already face-up while still shuffling', solo.shuffling);
  check(solo.shuffling.hold === 'hidden', 'the countdown ran before anything was dealt', solo.shuffling);
  check(solo.shuffling.deck.length === new Set(solo.shuffling.deck).size,
    'the deck deals the same rune twice', solo.shuffling.deck);
  /* THE assertion: the card, the readout and the hand all name one rune. */
  check(solo.turned.card === solo.played.mine && solo.played.mine === solo.played.theirs,
    'THE GAME DEALT A DIFFERENT RUNE THAN THE CARD SHOWED', { turned: solo.turned, played: solo.played });
  check(solo.turned.named.includes(solo.turned.label),
    'the readout and the card face name different runes', solo.turned);
  // the card turned over: its FACE is what is lit, and the face is not see-through
  check(solo.turned.faceOpacity === 1 && solo.turned.backOpacity === 0,
    'THE CARD TURNED OVER AND SHOWED ITS BACK', solo.turned);
  check(solo.turned.faceBg, 'the dealt card has no face — the deck reads straight through it', solo.turned);
  /* the card was taken OUT of the fan, and it is the one the fan showed there */
  check(solo.turned.drawnRune === solo.turned.card,
    'the dealt card did not come out of its own slot in the deck', solo.turned);
  check(solo.turned.stillInFan === solo.shuffling.deck.length - 1,
    'the fan is not one card short after the draw', solo.turned);
  check(!solo.turned.settled.length,
    'a mode the player chose was announced as if it had been drawn', solo.turned.settled);
  /* the shuffle is the beat the player waits through; a flip on its own was the
     rejected version of this screen */
  check(solo.shuffleMs > 2000, 'the shuffle is over before it reads as one', { shuffleMs: solo.shuffleMs });
  check(solo.shuffleMs < 6000, 'the shuffle outstays its welcome', { shuffleMs: solo.shuffleMs });

  // ---- both left to chance: TWO answers, ONE countdown ----
  const both = await deal('-1');                                  // -1 = RANDOM
  out.both = both;
  check(both.turned.settled.length === 1,
    'the mode did not settle above the rune', both.turned.settled);
  /* the name alone is a label — the settled answer keeps the line that says
     what the game you are about to play actually does */
  check(both.turned.settled[0]?.rule?.length > 10,
    'the settled mode kept its name but dropped its rule', both.turned.settled);
  check(both.turned.hold === 'visible', 'the countdown never arrived', both.turned);
  check(both.played.mode !== 'random' && both.turned.card === both.played.mine,
    'the game and the reveal disagree when BOTH were random', { turned: both.turned, played: both.played });

  // ---- the deck is cut fresh: three deals must not fan out identically ----
  const third = await deal('0');
  const orders = [solo, both, third].map((d) => d.shuffling.deck.join(','));
  out.orders = orders;
  /* the deck is RE-ORDERED as it is worked: the fan the player is handed is not
     the fan the card is drawn out of. Asked across three deals because two
     independent shuffles of six can coincide, and a gate may not roll dice. */
  out.reordered = [solo, both, third].map((d) => d.shuffling.deck.join(',') !== d.turned.deck.join(','));
  check(out.reordered.some(Boolean),
    'the shuffle never re-ordered the deck — the cards moved and nothing changed',
    { before: orders, after: [solo, both, third].map((d) => d.turned.deck.join(',')) });
  out.slots = [solo, both, third].map((d) => d.turned.drawnSlot);
  check(new Set(orders).size > 1, 'the deck fans out in the same order every deal', orders);
  check(out.slots.every((i) => i >= 0), 'a deal took no card out of the fan at all', out.slots);
} catch (e) {
  problems.push('THREW :: ' + e.message);
} finally { await browser.close(); }

console.log(JSON.stringify({ out, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
