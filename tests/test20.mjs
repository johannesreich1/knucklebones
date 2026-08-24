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
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, locale: 'en-US' });
  await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the tutorial offer is test19's subject
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message));
  await page.goto(F);
  await page.waitForTimeout(400);

  /* one deal, driven exactly as a player drives it: pick RANDOM in the spell
     row, press Play, and read only what is on screen */
  const deal = async (localMode, liveLocale = false) => {
    await page.evaluate((m) => {
      const k = window.__kb;
      k.goHome(); k.openPractice();
      document.querySelector(`#modePick button[data-v="${m}"]`).click();
      document.querySelector('#spellPick button[data-v="random"]').click();
      k.S.timer = 0;
    }, localMode);
    await page.click('#btnPlay');
    const localeRepaint = {};
    if (liveLocale) {
      await page.waitForSelector('#wheelDial', { timeout: 14000 });
      await page.waitForTimeout(700); // clear tap()'s native-click guard
      localeRepaint.mode = await page.evaluate(() => {
        const overlay = document.getElementById('ovWheel');
        const stage = document.getElementById('wheelStage');
        const dial = document.getElementById('wheelDial');
        const comet = document.getElementById('wheelComet');
        const animation = comet.getAnimations()[0] ?? null;
        window.__localeReveal = { overlay, stage, dial, comet, animation };
        const state = () => JSON.stringify({
          gen: window.__kb.S.gen,
          scoring: window.__kb.S.scoring,
          spellCharges: window.__kb.S.spellCharges,
          boards: window.__kb.S.boards,
        });
        const stateBefore = state();
        document.getElementById('languageNext').click();
        return {
          locale: window.__kb.S.localeOverride,
          title: document.getElementById('wheelTitle').textContent.trim(),
          sameOverlay: document.getElementById('ovWheel') === overlay,
          sameStage: document.getElementById('wheelStage') === stage,
          sameDial: document.getElementById('wheelDial') === dial,
          sameComet: document.getElementById('wheelComet') === comet,
          sameAnimation: !animation || comet.getAnimations().includes(animation),
          stateBefore,
          stateAfter: state(),
        };
      });
    }
    await page.waitForSelector('#ovWheel.dealing', { timeout: 14000 });
    if (liveLocale) {
      await page.waitForTimeout(30); // fanIn has installed its live WAAPI animations
      localeRepaint.rune = await page.evaluate(() => {
        const stage = document.getElementById('wheelStage');
        const card = stage.querySelector('.rdealt');
        const label = card.querySelector('.rlbl');
        const deckCard = stage.querySelector('.rcard');
        const animation = deckCard.getAnimations()[0] ?? null;
        const before = label.textContent.trim();
        const state = () => JSON.stringify({
          gen: window.__kb.S.gen,
          scoring: window.__kb.S.scoring,
          spellCharges: window.__kb.S.spellCharges,
          boards: window.__kb.S.boards,
        });
        const stateBefore = state();
        Object.assign(window.__localeReveal, { runeStage: stage, card, label, deckCard, animation });
        document.getElementById('languageNext').click();
        return {
          locale: window.__kb.S.localeOverride,
          title: document.getElementById('wheelTitle').textContent.trim(),
          before,
          label: label.textContent.trim(),
          sameStage: document.getElementById('wheelStage') === stage,
          sameCard: stage.querySelector('.rdealt') === card,
          sameLabel: card.querySelector('.rlbl') === label,
          sameDeckCard: stage.querySelector('.rcard') === deckCard,
          sameAnimation: !animation || deckCard.getAnimations().includes(animation),
          stateBefore,
          stateAfter: state(),
        };
      });
    }
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
    if (liveLocale) {
      await page.waitForFunction(() => document.querySelector('#ovWheel')?.classList.contains('holding'),
        null, { timeout: 8000 });
      localeRepaint.hold = await page.evaluate(() => {
        const overlay = document.getElementById('ovWheel');
        const stage = document.getElementById('wheelStage');
        const card = stage.querySelector('.rdealt');
        const label = card.querySelector('.rlbl');
        const name = document.querySelector('#wheelName .wcopy');
        const blurb = document.getElementById('wheelBlurb');
        const settled = document.querySelector('#wheelSettled .wsett');
        const before = {
          name: name.textContent.trim(),
          blurb: blurb.textContent.trim(),
          settled: settled?.textContent.trim() ?? '',
          hint: document.getElementById('wheelHint').textContent.trim(),
        };
        const state = () => JSON.stringify({
          gen: window.__kb.S.gen,
          scoring: window.__kb.S.scoring,
          spellCharges: window.__kb.S.spellCharges,
          boards: window.__kb.S.boards,
        });
        const stateBefore = state();
        document.getElementById('languageNext').click();
        const after = {
          name: name.textContent.trim(),
          blurb: blurb.textContent.trim(),
          settled: settled?.textContent.trim() ?? '',
          hint: document.getElementById('wheelHint').textContent.trim(),
        };
        return {
          locale: window.__kb.S.localeOverride,
          before,
          after,
          sameOverlay: document.getElementById('ovWheel') === overlay,
          sameStage: document.getElementById('wheelStage') === stage,
          sameCard: stage.querySelector('.rdealt') === card,
          sameLabel: card.querySelector('.rlbl') === label,
          sameName: document.querySelector('#wheelName .wcopy') === name,
          sameBlurb: document.getElementById('wheelBlurb') === blurb,
          sameSettled: document.querySelector('#wheelSettled .wsett') === settled,
          stateBefore,
          stateAfter: state(),
        };
      });
    }
    await page.click('#ovWheel');            // "I have read it" — cuts the hold short
    await page.waitForFunction(() => !document.querySelector('#ovWheel')?.classList.contains('on'),
      null, { timeout: 8000 });
    const played = await page.evaluate(() => ({
      // the rune BOTH seats hold, named by the registry's stable id
      mine: Object.keys(window.__kb.S.spellCharges[1])[0] ?? null,
      theirs: Object.keys(window.__kb.S.spellCharges[0])[0] ?? null,
      mode: window.__kb.modeByEnum(window.__kb.S.scoring).id,
    }));
    if (liveLocale) {
      await page.evaluate(() => {
        window.__kb.S.localeOverride = null;
        const key = 'knucklebones.v1';
        const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
        saved.localeOverride = null;
        localStorage.setItem(key, JSON.stringify(saved));
      });
    }
    return { shuffling, shuffleMs, turned, played, localeRepaint };
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
  const both = await deal('-1', true);                            // -1 = RANDOM
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
  check(both.localeRepaint.mode.locale === 'de'
    && both.localeRepaint.mode.title === 'SPIELMODUS'
    && both.localeRepaint.mode.sameOverlay && both.localeRepaint.mode.sameStage
    && both.localeRepaint.mode.sameDial && both.localeRepaint.mode.sameComet
    && both.localeRepaint.mode.sameAnimation
    && both.localeRepaint.mode.stateAfter === both.localeRepaint.mode.stateBefore,
  'changing locale rebuilt or restarted the live mode dial', both.localeRepaint.mode);
  check(both.localeRepaint.rune.locale === 'fr'
    && both.localeRepaint.rune.title === 'VOTRE RUNE'
    && both.localeRepaint.rune.label !== both.localeRepaint.rune.before
    && both.localeRepaint.rune.sameStage && both.localeRepaint.rune.sameCard
    && both.localeRepaint.rune.sameLabel && both.localeRepaint.rune.sameDeckCard
    && both.localeRepaint.rune.sameAnimation
    && both.localeRepaint.rune.stateAfter === both.localeRepaint.rune.stateBefore,
  'changing locale rebuilt/restarted the rune deal or left its card label stale',
  both.localeRepaint.rune);
  check(both.localeRepaint.hold.locale === 'en'
    && both.localeRepaint.hold.before.name !== both.localeRepaint.hold.after.name
    && both.localeRepaint.hold.before.blurb !== both.localeRepaint.hold.after.blurb
    && both.localeRepaint.hold.before.settled !== both.localeRepaint.hold.after.settled
    && both.localeRepaint.hold.before.hint !== both.localeRepaint.hold.after.hint
    && both.localeRepaint.hold.sameOverlay && both.localeRepaint.hold.sameStage
    && both.localeRepaint.hold.sameCard && both.localeRepaint.hold.sameLabel
    && both.localeRepaint.hold.sameName && both.localeRepaint.hold.sameBlurb
    && both.localeRepaint.hold.sameSettled
    && both.localeRepaint.hold.stateAfter === both.localeRepaint.hold.stateBefore,
  'holding reveal did not repaint every answer in place or changed game state',
  both.localeRepaint.hold);

  // ---- RANDOM ×2: two honest shuffles, two owners, one final countdown ----
  const dualDeal = async () => {
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
    return { firstMs, secondMs, first, secondDeck, second, played };
  };
  const dual = await dualDeal();
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
  /* ---- THE REVEAL'S PARTS DO NOT SIT ON EACH OTHER ----
     Every part of this screen is absolutely positioned against the stage's
     edge through --stage, which is what lets a beat change the stage's size
     without the readout jumping. The failure mode of that design is total: if
     --stage ever fails to resolve for one of them, its calc() is invalid, `top`
     falls back to auto, and an absolutely positioned child of a centred flex
     column lands in the MIDDLE — the title and the answer printed across the
     dial they describe. Nothing about the markup or the classes would look
     wrong, so this is measured in pixels, at two sizes, in BOTH dressings: the
     ranked one carries a versus line the offline one does not. */
  const overlaps = async (page, label) => {
    const r = await page.evaluate(() => {
      const box = (q) => { const e = document.querySelector(q); if (!e) return null;
        const b = e.getBoundingClientRect();
        return (e.textContent || '').trim() && b.height > 0
          ? { left: b.left, right: b.right, top: b.top, bot: b.bottom }
          : null; };
      const st = document.querySelector('#wheelStage').getBoundingClientRect();
      const stage = { left: st.left, right: st.right, top: st.top, bot: st.bottom };
      /* A short landscape phone deliberately puts the hold in the free right
         gutter at the stage's vertical midpoint. Measure rectangle overlap,
         not vertical-range overlap, or that valid side-by-side layout reads
         as though the copy were painted across the cards. */
      const over = (a) => a ? Math.round(Math.min(
        Math.max(0, Math.min(a.right, stage.right) - Math.max(a.left, stage.left)),
        Math.max(0, Math.min(a.bot, stage.bot) - Math.max(a.top, stage.top)),
      )) : 0;
      return { title: over(box('#wheelTitle')), name: over(box('#wheelName')),
               blurb: over(box('#wheelBlurb')), settled: over(box('#wheelSettled')),
               who: over(box('#wheelWho')), hold: over(box('#wheelHold')),
               stageH: Math.round(st.height) };
    });
    out['overlap_' + label] = r;
    check(r.stageH > 0, `${label}: the reveal has no stage at all`, r);
    for (const part of ['title', 'name', 'blurb', 'settled', 'who', 'hold']) {
      check(r[part] === 0, `${label}: the reveal's ${part} is printed across the stage`, r);
    }
  };

  /* deal() above always draws a RUNE, which is the offline dressing. Ranked
     reveals the mode alone, so this one holds on whichever beat is last. */
  const revealHeld = async (mode, spell) => {
    await page.evaluate(([m, sp]) => {
      const k = window.__kb;
      k.goHome(); k.openPractice();
      document.querySelector(`#modePick button[data-v="${m}"]`).click();
      document.querySelector(`#spellPick button[data-v="${sp}"]`).click();
      k.S.timer = 0;
    }, [mode, spell]);
    await page.click('#btnPlay');
    await page.waitForFunction(() => document.querySelector('#ovWheel')?.classList.contains('holding'), { timeout: 20000 });
    await page.waitForTimeout(250);
  };
  const dismiss = async () => {
    await page.click('#ovWheel');
    await page.waitForFunction(() => !document.querySelector('#ovWheel')?.classList.contains('on'), { timeout: 12000 });
  };

  for (const [w, h] of [[390, 844], [375, 667]]) {
    await page.setViewportSize({ width: w, height: h });
    // OFFLINE dressing: mode then rune, so the settled strip is on screen too
    await revealHeld('-1', 'random');
    await overlaps(page, `offline-${w}x${h}`);
    await dismiss();
    // RANKED dressing: the mode alone, plus the versus line ranked fills in
    await revealHeld('-1', 'ward');
    await page.evaluate(() => { document.querySelector('#wheelWho').innerHTML =
      '<div class="dside me"><span class="dav"></span><span class="dnm">FrostLynx303</span><span class="rt">1284</span></div>'
      + '<span class="dvs">VS</span>'
      + '<div class="dside foe"><span class="dav"></span><span class="dnm">EmberCrow896</span><span class="rt">1310</span></div>'; });
    await page.waitForTimeout(200);
    await overlaps(page, `ranked-${w}x${h}`);
    await dismiss();
  }
  /* The hardest geometry is random mode + two runes on a short landscape
     phone: two prior answers must share the safe top gutter above the final
     five-card deck. */
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
} catch (e) {
  problems.push('THREW :: ' + e.message);
} finally { await browser.close(); }

console.log(JSON.stringify({ out, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
