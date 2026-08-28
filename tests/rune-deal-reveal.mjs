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
//   · the card comes off the TOP of the deck the shuffle assembled (the S9
//     pile deal, 2026-08-26). A card that always appeared from the middle made
//     the shuffle decoration — nothing that happened to the deck could have
//     decided anything; here the last gather the player watched decides it.
//   · the shuffle takes real time. "Too quick" is the note the whole beat
//     exists to answer, and a shuffle is the one part a screenshot cannot check.
//
// Plus the deck's own contract: it is the WHOLE roster, cut fresh each deal.
import pkg from 'playwright';
import {
  gameCopyFor,
  localeCycleFrom,
  observeLocale,
  restoreLocale,
  verifyDealLocaleRepaint,
} from './browser/support/locale-reveal.mjs';
import {
  verifyRandomTwoLandscape,
  verifyRandomTwoReveal,
} from './browser/support/random-two-reveal.mjs';
import { SPELLS } from '../src/core/spells.ts';
import {
  readTurnedDeal,
  checkDealPhysique,
  verifyPileDealClearance,
} from './browser/support/deal-stack.mjs';
const { chromium } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
/* The ONE draw this fixes is the offline RANDOM seed, and it is fixed to a
   value that lands on an ordinary mode: Rune Trial answers RANDOM with a
   private choice instead of a rune deal, so a seed that reaches it would leave
   this test waiting for a deck that is never dealt. Verified under both the
   permanent 40/60 weights and the temporary Trial share. */
/* PRIMED AND PRESSED IN ONE TASK: the stub restores itself on first use, so
   anything that draws before Play is pressed eats the fixed seed and the mode
   goes back to chance — a previous duel's timer is exactly that thief, and a
   Playwright click's round trip is all the room it needs. Since Rune Ritual is
   temporarily 60% of the draw, a stolen seed usually lands there, and the
   Ritual answers RANDOM with a private choice instead of a rune deal: this
   test would then wait for a deck that is never dealt. */
const primeRandomStart = (randomMode) => {
  const natural = Math.random; if (randomMode) Math.random = () => { Math.random = natural; return .375; };
  window.__kb.S.timer = 0;
  const play = document.getElementById('btnPlay');
  const box = play.getBoundingClientRect();
  const at = { bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  play.dispatchEvent(new PointerEvent('pointerdown', at));
  play.dispatchEvent(new PointerEvent('pointerup', at));
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, locale: 'en-US' });
  await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: tests/first-run-offer.mjs owns the first-run offer
  await ctx.addInitScript((collected) => localStorage.setItem('knucklebones.runes.v1', JSON.stringify({
    version: 1,
    accountId: '11111111-2222-4333-8444-555555555555',
    verifiedAt: 1,
    collected,
  })), SPELLS.map(({ id }) => id));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message));
  await page.goto(F);
  await page.waitForTimeout(400);
  const initialLocale = await observeLocale(page);
  const initialGame = gameCopyFor(initialLocale);

  /* one deal, driven exactly as a player drives it: pick RANDOM in the spell
     row, press Play, and read only what is on screen */
  const deal = async (localMode, liveLocale = false) => {
    const localeRepaint = {};
    if (liveLocale) {
      const dealLocale = await observeLocale(page);
      localeRepaint.cycle = localeCycleFrom(dealLocale, 3);
    }
    await page.evaluate(() => {
      const k = window.__kb;
      k.goHome(); k.openPractice();
    });
    /* The reveal contract is independent of progression. Local multiplayer is
       the one mode that intentionally exposes the complete rune roster, so it
       keeps this animation probe deterministic even with no signed-in cache. */
    await page.click('#modeSeg button[data-m="duo"]');
    await page.click(`#modePick button[data-v="${localMode}"]`);
    await page.click('#spellPick button[data-v="random"]');
    await page.evaluate(primeRandomStart, localMode === '-1');
    if (liveLocale) {
      await page.waitForSelector('#ovWheel.on #wheelDial', { timeout: 20000 }); // never stale hidden DOM
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
    await page.waitForSelector('#ovWheel.dealing', { timeout: 20000 });
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
        const beforeTitle = document.getElementById('wheelTitle').textContent.trim();
        Object.assign(window.__localeReveal, { runeStage: stage, card, label, deckCard, animation });
        document.getElementById('languageNext').click();
        return {
          locale: window.__kb.S.localeOverride,
          rune: card.dataset.rune,
          beforeTitle,
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
      title: document.querySelector('#wheelTitle .wtitlecopy').textContent.trim(),
      named: document.querySelector('#wheelName').textContent.trim(),
      turned: !!document.querySelector('.rdealt.up'),
      deck: [...document.querySelectorAll('.rcard')].map((e) => e.dataset.rune),
      owner: document.getElementById('wheelOwner')?.textContent.trim() ?? '',
      ownerHidden: document.getElementById('wheelOwner')?.hidden ?? true,
      hold: getComputedStyle(document.querySelector('.dhold')).visibility,
    }));
    await page.waitForSelector('.rdealt.up', { timeout: 12000 });
    const shuffleMs = Date.now() - t0;
    await page.waitForTimeout(700);          // the turn itself
    const turned = await page.evaluate(readTurnedDeal);
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
          rune: card.dataset.rune,
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
      localeRepaint.restoredLocale = await restoreLocale(page, localeRepaint.cycle[0]);
    }
    return { shuffling, shuffleMs, turned, played, localeRepaint };
  };
  // ---- a deal under a mode the player CHOSE: one beat, one countdown ----
  const solo = await deal('0');                                   // 0 = CLASSIC
  out.solo = solo;
  check(solo.shuffling.title === initialGame.reveal.matchRune,
    'the shared RANDOM reveal used the wrong locale or player-relative copy', solo.shuffling);
  check(solo.shuffling.named === '', 'the deal named its rune while still shuffling', solo.shuffling);
  check(!solo.shuffling.turned, 'the card was already face-up while still shuffling', solo.shuffling);
  check(solo.shuffling.hold === 'hidden', 'the countdown ran before anything was dealt', solo.shuffling);
  check(solo.shuffling.ownerHidden && solo.shuffling.owner === '',
    'the shared RANDOM rune inherited a stale per-player owner', solo.shuffling);
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
  verifyDealLocaleRepaint(both, initialLocale, check);

  await verifyRandomTwoReveal(page, out, check, SPELLS.map(({ id }) => id));

  // ---- the deck is cut fresh: three deals must not fan out identically ----
  const third = await deal('0');
  check(third.shuffling.ownerHidden && third.shuffling.owner === '',
    'the reveal kept RANDOM ×2 owner copy on the next shared-rune deal', third.shuffling);
  const orders = [solo, both, third].map((d) => d.shuffling.deck.join(','));
  out.orders = orders;
  /* the deck is PHYSICALLY re-ordered as it is worked (the S9 pile deal,
     2026-08-26): runes carried, one squared stack, drawn card off its top —
     the contract lives in browser/support/deal-stack.mjs */
  out.carried = checkDealPhysique([solo, both, third], check);
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

  /* Hold the reveal on whichever beat is last. */
  const revealHeld = async (mode, spell, playMode = 'cpu') => {
    await page.evaluate(({ activeMode, collected }) => {
      if (activeMode === 'cpu') {
        localStorage.setItem('knucklebones.runes.v1', JSON.stringify({
          version: 1,
          accountId: '11111111-2222-4333-8444-555555555555',
          verifiedAt: 1,
          collected,
        }));
      }
      const k = window.__kb;
      k.goHome(); k.openPractice();
    }, { activeMode: playMode, collected: SPELLS.map(({ id }) => id) });
    await page.click(`#modeSeg button[data-m="${playMode}"]`);
    await page.click(`#modePick button[data-v="${mode}"]`);
    await page.click(`#spellPick button[data-v="${spell}"]`);
    await page.evaluate(primeRandomStart, mode === '-1');
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
  /* The hardest geometry is random mode + two runes on a short landscape. */
  await verifyRandomTwoLandscape(page, out, check, revealHeld, overlaps, dismiss);
  /* The rotated painted bodies of the pile deal, at the two tight rests. */
  await verifyPileDealClearance(page, out, check, revealHeld, dismiss);
} catch (e) {
  problems.push('THREW :: ' + e.message);
} finally { await browser.close(); }

console.log(JSON.stringify({ out, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
