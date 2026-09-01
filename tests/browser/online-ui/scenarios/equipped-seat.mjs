// THE RUNE YOU CARRY, IN THE SEAT THAT GATES IT.
//
// The equipped-rune migration (`20260828192801_equipped_rune.sql`) shipped with
// nothing able to watch it. The client reads it with a THIRD query against
// `profiles` — `select=equipped_rune`
// — and the harness told its profile reads apart with a single
// `url.includes('ranked_pool_tier')`. So the equipped read fell through to the
// account-profile branch and was answered with `{id, nickname, rating,
// named_at}`: a row with no equipped_rune in it. The seat could only ever paint
// empty, and every suite agreed with it. Nothing was red; nothing was covered.
//
// So this pins the read END TO END — the stub's column reaches the cache, the
// cache reaches the seat, and the seat paints — rather than any one hop.
//
// The gate is the carried ladder peak: an equipped rune becomes permanently
// LIVE after SILVER has been reached once, while a never-SILVER seat keeps
// waiting. Current points alone cannot distinguish those accounts.

import {
  measureEquippedSeat,
  readEquipmentSheet,
  readEquippedSeat,
  readRandomChoice,
} from '../harness/equipped-seat-probes.mjs';

const isEquipmentWrite = (request) => request.method() === 'POST'
  && request.url().includes('/rest/v1/rpc/set_rune_equipment');

export async function runEquippedSeatScenarios({ visit, out, check }) {
  const collected = ['fate', 'ward', 'pilfer'];

  /* A current 1,218 with a 1,259 peak has never crossed SILVER. RANDOM is
     saved, but its seat is still waiting. This is deliberately paired with the
     demoted case below: current points alone cannot distinguish the two. */
  const waiting = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward', randomRuneMode: true,
    standingPoints: 1218, standingPeak: 1259,
    probe: readEquippedSeat,
  });
  out.equippedSeatWaiting = waiting.probeResult;
  const w = waiting.probeResult;
  check(!!w && !w.hidden && w.painted,
    'a player holding runes has no equipped seat on screen at all', w);
  check(!!w && !w.none && w.hasRune && w.random,
    'THE EQUIPPED RUNE NEVER REACHED THE SEAT — it painted as empty', w);
  check(!!w && w.waiting,
    'a never-SILVER seat did not say the carried rune is still waiting', w);
  check(!!w && /RANDOM RUNE MODE/i.test(w.label),
    'the waiting seat does not name its RANDOM selection', w);

  /* The exact same current 1,218 and current-season 1,259 peak can still
     belong to a player who reached SILVER in a prior season. The permanent
     all-season fact, not a rollover convention, must keep RANDOM live. */
  const demoted = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward', randomRuneMode: true,
    standingPoints: 1218, standingPeak: 1259, historicalSilverReached: true,
    probe: readEquippedSeat,
  });
  out.equippedSeatDemoted = demoted.probeResult;
  const d = demoted.probeResult;
  check(!!d && !d.hidden && d.painted && !d.none && d.hasRune && d.random
      && !d.waiting && /RANDOM RUNE MODE/i.test(d.label),
    'a prior-season SILVER player still paints RANDOM as waiting after rollover', d);

  /* First SILVER crossing: the same rune is now permanently in play. */
  const live = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward', standingPoints: 1400,
    probe: readEquippedSeat,
  });
  out.equippedSeatLive = live.probeResult;
  const l = live.probeResult;
  check(!!l && !l.none && l.hasRune && !l.waiting,
    'a first-SILVER seat is still shown as waiting', l);
  check(!!l && /WARD/i.test(l.label),
    'the live seat does not name the rune it is holding', l);
  /* The hue is the rune's, not the panel's — the same rune from both sides of
     the threshold, so a seat that lost its colour cannot pass as gated. */
  check(!!d && !!l && !!d.hue && !!l.hue,
    'the live seat lost its painted rune colour', { d, l });

  /* Nothing equipped: the seat is present but empty, and says so. */
  const empty = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: null,
    probe: readEquippedSeat,
  });
  out.equippedSeatEmpty = empty.probeResult;
  const e = empty.probeResult;
  check(!!e && !e.hidden && e.none && !e.hasRune && e.hasSocket,
    'with nothing equipped the seat still painted a rune', e);
  check(!!e && e.label.length > 0 && !/WARD/i.test(e.label),
    'the empty seat is unlabelled or still names the last rune', e);
  check(!!e && !e.hasInnerSocket && e.iconCentreDx <= 0.5 && e.iconCentreDy <= 0.5,
    'the empty seat plus drew a second dotted ring or was not centred in the outer circle', e);

  /* ONE RUNE, EMPTY SEAT — the exact condition the removed auto-equip fired on
     (`collected.length === 1 && equipped === null`). Winning a first rune used
     to seat it without asking; that was removed 2026-08-28 by owner call, to be
     solved differently. A player holding their first rune is therefore expected
     to sit at 'none' until they choose, and a refresh must not quietly fill the
     seat behind them — which is what the old convenience write did. */
  const firstRune = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: ['ward'], equippedRune: null,
    probe: async (page) => {
      await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
      const seat = await page.evaluate(measureEquippedSeat);
      await page.click('#accSeat');
      await page.waitForSelector('#accSeatRandom', { timeout: 5000 });
      const randomChoice = await readRandomChoice(page);
      await page.keyboard.press('Escape');
      return { ...seat, randomChoice };
    },
  });
  out.equippedSeatFirstRune = firstRune.probeResult;
  const f = firstRune.probeResult;
  check(!!f && !f.hidden && f.none && !f.hasRune && f.hasSocket,
    'A FIRST RUNE SEATED ITSELF — the removed auto-equip is back', f);
  check(!!f && f.randomChoice.visible && f.randomChoice.disabled
      && f.randomChoice.ariaDisabled === 'true'
      && f.randomChoice.describedBy === 'accSeatRandomDetail'
      && f.randomChoice.color === f.randomChoice.opponentColor
      && /at least two runes/i.test(f.randomChoice.detail),
    'RANDOM RUNE MODE was hidden, enabled for one owned rune, or gave no visible reason', f);

  /* ---- THE SEAT OPENS A DECISION, THEN THE PROFILE BECOMES THE PICKER ----
     The sheet is intentionally NOT a second copy of the collection. EQUIP
     dismisses it and turns the existing six-slot grid into an obvious,
     selection-only surface: owned runes are the only live targets. */
  const picked = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: null,
    probe: async (page) => {
      await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
      const before = await page.evaluate(measureEquippedSeat);
      const writes = [];
      const recordWrite = (request) => {
        if (!isEquipmentWrite(request)) return;
        try { writes.push(request.postDataJSON()); } catch { writes.push(null); }
      };
      page.on('request', recordWrite);
      await page.click('#accSeat');
      await page.waitForSelector('.faceoff .focard', { timeout: 8000 }).catch(() => undefined);
      /* Sample after the shared sheet's arrival transform. Mid-flight the
         visual button and its hit-test point intentionally do not yet agree. */
      await page.waitForTimeout(380);
      const sheet = await readEquipmentSheet(page);
      await page.click('#accSeatEquip', { timeout: 4000 }).catch(() => undefined);
      await page.waitForSelector('.faceoff', { state: 'detached', timeout: 4000 })
        .catch(() => undefined);
      const choosing = await page.evaluate(() => {
        const panel = document.getElementById('onAccount');
        const host = document.getElementById('accRunes');
        const hint = document.getElementById('accRunePick');
        const hintBox = hint?.getBoundingClientRect() ?? null;
        const cards = [...document.querySelectorAll('#accRuneGrid .accrune')].map((button) => {
          const box = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return {
            rune: button.dataset.rune,
            collected: button.classList.contains('collected'),
            disabled: button.disabled,
            ariaDisabled: button.getAttribute('aria-disabled'),
            hasPopup: button.getAttribute('aria-haspopup'),
            tabIndex: button.tabIndex,
            pointerEvents: style.pointerEvents,
            opacity: parseFloat(style.opacity),
            borderColor: style.borderColor,
            centreHit: button === hit || button.contains(hit),
            height: box.height,
          };
        });
        const outside = panel
          ? [...panel.children].filter((element) => element.id !== 'accRunes')
          : [];
        return {
          active: !!host?.classList.contains('choosing')
            && !!panel?.classList.contains('rune-picking'),
          hintVisible: !!hintBox && hintBox.width > 0 && hintBox.height > 0,
          hintText: hint?.textContent?.trim() ?? '',
          outsideInert: outside.length > 0 && outside.every((element) => element.inert),
          cards,
        };
      });
      await page.click('#accRuneGrid .accrune[data-rune="pilfer"]', { timeout: 4000 })
        .catch(() => undefined);
      await page.waitForTimeout(700);
      page.off('request', recordWrite);
      return {
        before, sheet, choosing, writes,
        choosingAfter: await page.evaluate(() => document.getElementById('accRunes')
          ?.classList.contains('choosing') ?? false),
        after: await page.evaluate(measureEquippedSeat),
      };
    },
  });
  out.equippedSeatPicker = picked.probeResult;
  const p = picked.probeResult;

  check(!!p && !p.before.hasRune && p.before.hasSocket,
    'the picker probe did not start from an empty seat', p);
  check(!!p && p.sheet.runes.length === 0,
    'the equipped-seat sheet duplicated the rune collection instead of presenting actions', p);
  check(!!p && p.sheet.detail === 'Choose one unlocked rune for ranked matches.'
      && !/\b[A-Z]{2,}\b/.test(p.sheet.detail),
    'the equipped-seat intro repeated RANDOM/Ritual guidance or retained all-caps prose', p);
  check(!!p && /^equip rune$/i.test(p.sheet.equip?.text ?? '')
      && p.sheet.equip.height >= 44 && p.sheet.equip.centreHit
      && p.sheet.primaryShadow.left >= 8 && p.sheet.primaryShadow.right >= 8,
    'the empty seat sheet did not offer a reachable EQUIP RUNE action', p);
  check(!!p && /random rune mode/i.test(p.sheet.random?.text ?? '')
      && p.sheet.random.equipmentKind === 'random'
      && !p.sheet.random.disabled && p.sheet.random.ariaDisabled === null
      && p.sheet.random.height >= 44 && p.sheet.random.centreHit
      && p.sheet.random.color === p.sheet.random.opponentColor,
    'the seat sheet has no explicit, reachable RANDOM RUNE MODE choice seam', p);
  const ownedCards = p?.choosing.cards.filter((card) => card.collected) ?? [];
  const lockedCards = p?.choosing.cards.filter((card) => !card.collected) ?? [];
  check(!!p && p.choosing.active && p.choosing.hintVisible && p.choosing.hintText.length > 0
      && p.choosing.outsideInert,
    'EQUIP RUNE did not dismiss the sheet into an obvious selection-only profile state', p);
  check(ownedCards.length === collected.length
      && ownedCards.every((card) => !card.disabled && card.ariaDisabled === null
        && card.hasPopup === null && card.tabIndex >= 0
        && card.pointerEvents !== 'none' && card.centreHit && card.height >= 44)
      && lockedCards.length > 0
      && lockedCards.every((card) => card.disabled && card.ariaDisabled === 'true'
        && card.tabIndex < 0 && card.pointerEvents === 'none')
      && Math.min(...ownedCards.map((card) => card.opacity))
        > Math.max(...lockedCards.map((card) => card.opacity)),
    'selection mode did not make only owned rune cards actionable and visually dominant',
    p?.choosing);
  check(!!p && !p.choosingAfter
      && JSON.stringify(p.writes) === JSON.stringify([{
        p_equipped_rune: 'pilfer', p_random_rune_mode: false,
      }]) && p.after.hasRune && !p.after.none
      && /PILFER/i.test(p.after.label),
    'selecting an owned rune did not exit selection and persist through the profile write seam', p);

  /* Unequip is the quiet third path. It reuses the canonical `.btn.small`
     primitive (the compact ask/forfeit action), not another seat-only button
     treatment that happens to look similar today. */
  const cleared = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward',
    probe: async (page) => {
      await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
      await page.click('#accSeat');
      await page.waitForSelector('.faceoff .focard', { timeout: 8000 });
      const button = await page.evaluate(() => {
        const target = document.getElementById('accSeatClear');
        if (!target) return null;
        const box = target.getBoundingClientRect();
        const style = getComputedStyle(target);
        return {
          classes: target.className,
          fontSize: style.fontSize,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          height: box.height,
          sheetRunes: document.querySelectorAll('.faceoff .accrune').length,
        };
      });
      await page.click('#accSeatClear', { timeout: 4000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      return { button, after: await page.evaluate(measureEquippedSeat) };
    },
  });
  out.equippedSeatUnequip = cleared.probeResult;
  const c = cleared.probeResult;
  check(!!c && c.button?.sheetRunes === 0
      && c.button.classes.split(/\s+/).includes('btn')
      && c.button.classes.split(/\s+/).includes('soft')
      && c.button.classes.split(/\s+/).includes('small')
      && c.button.fontSize === '12px' && c.button.paddingTop === '12px'
      && c.button.paddingBottom === '12px' && c.button.height >= 44,
    'UNEQUIP did not reuse the canonical computed small-button treatment', c);
  check(!!c && c.after.none && !c.after.hasRune,
    'UNEQUIP did not clear the equipped seat through its existing persistence seam', c);

  /* RANDOM is not an alias for the fallback rune stored for old clients. The
     UI sends the semantic mode atomically, then repaints a shuffle seat rather
     than exposing that compatibility rune as the active fixed choice. */
  const randomized = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward', randomRuneMode: false,
    probe: async (page) => {
      await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
      const writes = [];
      const recordWrite = (request) => {
        if (!isEquipmentWrite(request)) return;
        try { writes.push(request.postDataJSON()); } catch { writes.push(null); }
      };
      page.on('request', recordWrite);
      await page.click('#accSeat');
      await page.click('#accSeatRandom');
      await page.waitForTimeout(700);
      await page.click('#accSeat');
      await page.waitForSelector('.faceoff .focard', { timeout: 8000 });
      const selectedSheet = await page.evaluate(() => ({
        randomChoices: document.querySelectorAll('#accSeatRandom').length,
        equipChoices: document.querySelectorAll('#accSeatEquip').length,
        clearChoices: document.querySelectorAll('#accSeatClear').length,
      }));
      await page.keyboard.press('Escape');
      page.off('request', recordWrite);
      return { writes, selectedSheet, seat: await page.evaluate(measureEquippedSeat) };
    },
  });
  out.equippedSeatRandom = randomized.probeResult;
  const r = randomized.probeResult;
  check(!!r && JSON.stringify(r.writes) === JSON.stringify([{
    p_equipped_rune: 'ward', p_random_rune_mode: true,
  }]), 'RANDOM RUNE MODE did not atomically retain its owned fallback and enable its flag', r);
  check(!!r && r.seat.random && !r.seat.none && r.seat.hasRune
      && /RANDOM RUNE MODE/i.test(r.seat.label) && !/WARD/i.test(r.seat.label),
    'RANDOM RUNE MODE repainted as the fixed compatibility rune instead of a random seat', r);
  check(!!r && r.selectedSheet.randomChoices === 0
      && r.selectedSheet.equipChoices === 1 && r.selectedSheet.clearChoices === 1,
    'the already-selected RANDOM action was still offered in its own equipment sheet', r);

  /* All three answers share one persistence seam. A refusal must therefore
     retain the last confirmed semantic mode whichever answer was attempted,
     and every sheet/selection teardown must release its inert background. */
  const refused = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward', randomRuneMode: false,
    probe: async (page, routes) => {
      await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
      const read = () => page.evaluate(() => {
        const panel = document.getElementById('onAccount');
        return {
          choosing: document.getElementById('accRunes')?.classList.contains('choosing') ?? false,
          sheet: !!document.querySelector('.faceoff'),
          inert: [document.querySelector('#ovOnline .shead'),
            ...(panel ? [...panel.children].filter((element) => element.id !== 'accRunes') : [])]
            .filter(Boolean).some((element) => element.inert),
        };
      }).then(async (state) => ({
        ...state, seat: await page.evaluate(measureEquippedSeat),
      }));

      routes.failNextEquipmentWrite();
      await page.click('#accSeat');
      await page.click('#accSeatRandom');
      await page.waitForTimeout(300);
      const afterRandom = await read();

      routes.failNextEquipmentWrite();
      await page.click('#accSeat');
      await page.click('#accSeatEquip');
      await page.click('#accRuneGrid .accrune[data-rune="pilfer"]');
      await page.waitForTimeout(300);
      const afterFixed = await read();

      routes.failNextEquipmentWrite();
      await page.click('#accSeat');
      await page.click('#accSeatClear');
      await page.waitForTimeout(300);
      const afterNone = await read();
      return { afterRandom, afterFixed, afterNone };
    },
  });
  out.equippedSeatRefusedWrites = refused.probeResult;
  const refusedStates = refused.probeResult
    ? [refused.probeResult.afterRandom, refused.probeResult.afterFixed, refused.probeResult.afterNone]
    : [];
  check(refusedStates.length === 3 && refusedStates.every((state) =>
    state.seat.hasRune && !state.seat.random && !state.seat.none && /WARD/i.test(state.seat.label)
      && !state.choosing && !state.sheet && !state.inert),
  'a refused RANDOM/FIXED/NONE write changed the confirmed seat or leaked an inert picker state',
  refused.probeResult);

}
