import { armSheetArrival, dragSheetAndHold, sheetGone } from '../../support/sheet-card.mjs';
import { readLearnLibraryEntry } from '../harness/learn-library.mjs';

export async function runBadgeCardScenarios(suite) {
  const { page, out, check, modeCopy, spellCopy, t } = suite;
  // ===== the HUD badge names what is in play, and explains each of it =====
  // Reported bug: tapping the badge opened the modes library online and did
  // nothing offline, because the listener lived inside the online chunk. Both
  // flows now paint the badge through render.paintBadge and boot binds ONE
  // delegated tap against the chip's data-lib, so neither the affordance nor a
  // second roster can go missing on one side.
  //
  // The badge is a row of chips: the mode always, the dealt spell beside it. It
  // carries no tally (user call) — and the tally was how classic alone lost the
  // affordance, since S.scoring is 0 for CLASSIC and the old `if (S.scoring)`
  // fell straight through to the win/loss line. So classic is tested FIRST here.
  const chipsNow = () => page.evaluate(() => {
    const r = document.getElementById('rec');
    const badge = r.getBoundingClientRect();
    const hud = r.closest('.hud').getBoundingClientRect();
    const leave = document.getElementById('btnLeave').getBoundingClientRect();
    return {
      text: r.textContent.replace(/\s+/g, ' ').trim(),
      geometry: { badgeCenter: badge.left + badge.width / 2,
                  hudCenter: hud.left + hud.width / 2,
                  badgeRight: badge.right, leaveLeft: leave.left },
      chips: [...r.querySelectorAll('.rchip')].map(c => {
        const b = c.getBoundingClientRect(), i = c.querySelector('.mi');
        return { lib: c.dataset.lib ?? null, id: c.dataset.id ?? null,
                 owner: c.dataset.owner ?? null,
                 name: c.textContent.replace(/[\sⓘⓘ]+/g, ' ').trim(),
                 tappable: c.classList.contains('tapmode'), icon: !!c.querySelector('svg'),
                 shown: b.width > 0 && b.height > 0,
                 // the ⓘ rule must reach OFFLINE — it lived in the online chunk once
                 infoStyled: !!i && getComputedStyle(i).marginLeft !== '0px' };
      }),
    };
  });
  /* THE ROSTERS, READ FROM HOW TO PLAY — twice a guard. They are the source of
     truth the badge's card must agree with word for word and hue for hue (both
     are built from the registries by ui/library, and the sheet reuses the very
     markup the roster card is made of), and they are the door that had to SURVIVE
     the badge changing destination: a chip no longer opens a roster, so if the
     Learn hub had come along with it the whole library would be unreachable. */
  out.rosterMode = await readLearnLibraryEntry(page, '#btnLearnModes', 'ovModes', 'singlestrike');
  out.rosterSpell = await readLearnLibraryEntry(page, '#btnLearnSpells', 'ovSpells', 'ward');
  check(out.rosterMode.title === t('learn', 'library.gameModes')
      && out.rosterSpell.title === t('learn', 'library.runes'),
    'the Learn libraries do not use their player-facing category names',
    { modes: out.rosterMode.title, runes: out.rosterSpell.title });
  for (const [k, r] of [['modes', out.rosterMode], ['spells', out.rosterSpell]]) {
    check(r.on, `HOW TO PLAY no longer opens the ${k} library`, r);
    check(r.name.length > 0 && r.detail.length > 20, `the ${k} roster entry is empty`, r);
    check(r.nav.buttons === 1 && r.nav.backs === 1 && r.nav.duel
      && r.nav.label === t('common', 'actions.back') && r.nav.left && r.nav.noX,
      `the ${k} library does not use the one shared Learn-page Back header`, r.nav);
    check(!r.back.child && r.back.learn,
      `the ${k} Back did not close only the library and return to HOW TO PLAY`, r.back);
  }

  const playLocal = async (mode, spell) => {
    await page.evaluate(([m, s]) => {
      /* This scenario owns HUD cards, not collection gating. Re-establish its
         all-runes account fixture after any preceding reload reconciled an
         orphaned cache away. */
      localStorage.setItem('knucklebones.runes.v1', JSON.stringify({
        version: 1,
        accountId: '11111111-2222-4333-8444-555555555555',
        verifiedAt: 1,
        collected: ['fate', 'nudge', 'ward', 'sunder', 'pilfer', 'anvil'],
        poolTier: 'ivory',
      }));
      window.__kb.S.localMode = m; window.__kb.S.spell = s; window.__kb.openPractice();
    }, [mode, spell]);
    await page.tap('#btnPlay'); await page.waitForTimeout(1200);
  };
  const leaveGame = async () => {
    await page.tap('#btnLeave'); await page.waitForTimeout(250);
    await page.tap('#btnAskYes'); await page.waitForTimeout(400);
  };
  const portraitBadgeCentred = (badge) =>
    Math.abs(badge.geometry.badgeCenter - badge.geometry.hudCenter) <= .5
    && badge.geometry.badgeRight <= badge.geometry.leaveLeft - 4;

  // CLASSIC, no spell: one chip, naming the mode, tappable — no record anywhere
  await playLocal(0, '');
  out.badgeClassic = await chipsNow();
  check(out.badgeClassic.chips.length === 1, 'classic should show exactly one chip', out.badgeClassic);
  check(out.badgeClassic.chips[0]?.id === 'classic' && out.badgeClassic.chips[0]?.tappable,
    'CLASSIC must name itself and open its rules like every other mode', out.badgeClassic);
  check(!/\bW\b|\bL\b|\bP1\b|\bP2\b/.test(out.badgeClassic.text),
    'the badge still carries a tally — it names what is played, not the score', out.badgeClassic.text);
  check(portraitBadgeCentred(out.badgeClassic),
    'the portrait game mode is not centred clear of Leave', out.badgeClassic.geometry);
  await leaveGame();

  // SINGLE STRIKE + WARD: two chips, each iconed, tappable and ⓘ-marked
  await playLocal(4, 'ward');
  out.badge = await chipsNow();
  check(out.badge.chips.length === 2, 'a dealt spell must add its own chip', out.badge);
  check(out.badge.chips[0]?.id === 'singlestrike'
      && out.badge.chips[0]?.name === modeCopy('singlestrike').compactName,
    'the mode chip does not name the mode in play', out.badge);
  check(out.badge.chips[1]?.id === 'ward' && out.badge.chips[1]?.lib === 'spells'
      && out.badge.chips[1]?.name === spellCopy('ward').compactName,
    'the spell chip does not name the rune dealt', out.badge);
  check(out.badge.chips.every(c => c.shown && c.icon && c.tappable && c.infoStyled),
    'a chip is not a shown, iconed, tappable, ⓘ-marked control offline', out.badge);
  check(portraitBadgeCentred(out.badge),
    'the portrait game mode and current rune are not centred as one badge', out.badge.geometry);
  const portraitViewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 568 }); await page.waitForTimeout(160);
  out.badgeCompact = await chipsNow();
  check(portraitBadgeCentred(out.badgeCompact),
    'the compact portrait mode+rune badge is not centred clear of Leave', out.badgeCompact.geometry);
  await page.setViewportSize(portraitViewport); await page.waitForTimeout(160);

  /* ===== EACH CHIP DEALS ITS OWN CARD (user call 2026-08-23) =====
     A chip used to throw the WHOLE roster up as a full-screen overlay and leave
     the player to find the line they asked about. It deals the ONE entry now, on
     the sheet the ladder's face-off rides in (ui/sheet) — the SAME component, so
     the arrival, the wash, the 96px commit line, the flick, the spring home, the
     backdrop tap and the grabber are one implementation guarded in two suites
     (online-ui's ladder-faceoff scenario drives the face-off's copy of these
     very numbers, and both suites clock the arrival and pull the card down
     through the one support/sheet-card.mjs).
     Every line below reads PIXELS: a card that merely appeared in the DOM, a
     tint that never reached the paint, or a drag the card ignored all agree with
     the DOM perfectly (single-strike-visibility's lesson). And both chips walk
     the same steps,
     because a row of chips that behaves differently per roster is the bug the
     badge was made a row to prevent. */
  // one door in, used for every reopen below: arm the sampler, tap the chip, and
  // let the 340ms arrival land before anything is measured
  const openCard = async (lib) => {
    await armSheetArrival(page);
    await page.tap(`#rec .rchip[data-lib="${lib}"]`);
    await page.waitForTimeout(520);
    /* A chip must deal a CARD, not a roster. Whatever else the tap threw up is
       reported and then swept: a regression that reopens the old full-screen
       library leaves it covering the screen, and every later step of this walk
       would report a 30s timeout on it instead of the door that actually broke. */
    const left = await page.evaluate(() =>
      [...document.querySelectorAll('.ov.on')].map((o) => o.id).join(','));
    if (left) {
      await page.evaluate((ids) => ids.split(',').forEach((i) =>
        document.getElementById(i)?.classList.remove('on')), left);
      await page.waitForTimeout(320);   // .ov hides .28s after .on drops
    }
    return left;
  };
  const readCard = () => page.evaluate(() => {
    const ov = document.querySelector('.faceoff'), c = ov?.querySelector('.focard');
    if (!ov || !c) return null;
    const r = c.getBoundingClientRect();
    /* the pixel test, not the rect test: a card under something else is present
       in the DOM and invisible on screen. elementFromPoint answers what the
       PLAYER gets. */
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const head = ov.querySelector('.mchead');
    return {
      visible: r.width > 0 && r.height > 0 && ov.contains(hit),
      role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'),
      label: c.getAttribute('aria-label'),
      name: ov.querySelector('.mcname')?.textContent?.trim() ?? '',
      blurb: ov.querySelector('.mcblurb')?.textContent?.trim() ?? '',
      detail: ov.querySelector('.mcdetail')?.textContent?.trim() ?? '',
      icon: !!ov.querySelector('.mchead svg'),
      /* THE TINT, AS PAINTED. The heading burns with the entry's own hue and the
         frame catches it; the rule text must NOT — a detail paragraph tinted to
         its mode is a detail paragraph nobody finishes. */
      hue: head ? getComputedStyle(head).color : '',
      border: getComputedStyle(c).borderTopColor,
      detailColor: getComputedStyle(ov.querySelector('.mcdetail')).color,
      arrive: window.__fo.arrival(),
      rest: Math.round(r.top),
    };
  });

  const WANT = { modes: out.rosterMode, spells: out.rosterSpell };
  for (const lib of ['modes', 'spells']) {
    const roster = WANT[lib];
    // no roster came with it: a chip is not a door to the whole library any more
    const left = out['cardRosters_' + lib] = await openCard(lib);
    const c = out['card_' + lib] = await readCard();
    check(!!c && c.visible, `tapping the ${lib} chip deals no card the player can see`, c);
    check(c?.name === roster.name && c?.detail === roster.detail,
      `the ${lib} card does not say what the roster says about the entry in play`,
      { card: { name: c?.name, detail: c?.detail }, roster });
    check((c?.detail?.length ?? 0) > 20 && c?.icon && (c?.blurb?.length ?? 0) > 0,
      `the ${lib} card is missing the entry's icon, blurb or rule`, c);
    check(left === '', `the ${lib} chip still throws the whole roster up instead of the entry`, left);
    // the tint is the ENTRY'S OWN, the same hue the roster paints it in
    check(c?.hue === roster.hue, `the ${lib} card is not lit by that entry's hue`,
      { card: c?.hue, roster: roster.hue });
    check(c?.border !== 'rgba(255, 255, 255, 0.15)' && c?.border !== c?.detailColor,
      `the ${lib} card wears the plain frame — the tint never reached the border`, c);
    check(c?.detailColor === 'rgb(198, 211, 238)',
      `the ${lib} card tinted its rule text; the rule has to stay readable`, c?.detailColor);
    // it ARRIVED, from below, with the wash thickening behind it
    check(c?.arrive?.rose === true && (c?.arrive?.first - c?.arrive?.last) > 40,
      `the ${lib} card did not travel up from the bottom`, c?.arrive);
    check((c?.arrive?.washFirst ?? 1) < (c?.arrive?.washLast ?? 0),
      `the wash did not fade in with the ${lib} card`, c?.arrive);
    // the screen reader's door: a real labelled dialog on a real labelled button
    check(c?.role === 'dialog' && c?.modal === 'true' && c?.label === roster.name,
      `the ${lib} card is not an announceable dialog naming its entry`, c);
    // and the same way out on both: a tap outside
    await page.mouse.click(8, 8);
    out['cardBackdrop_' + lib] = await sheetGone(page);
    check(out['cardBackdrop_' + lib], `a tap outside does not dismiss the ${lib} card`, null);
  }
  // the two cards are LIT DIFFERENTLY — one tint for the mode, another for the
  // rune, both straight off the registry
  check(out.card_modes?.hue !== out.card_spells?.hue &&
        out.card_modes?.border !== out.card_spells?.border,
    'a mode and a spell were dealt in the same colour', { m: out.card_modes?.hue, s: out.card_spells?.hue });

  /* THE DRAG, on the badge's card as on the ladder's: past 96px the release
     sends it away, short of that it springs home. Both are read as pixels —
     where the card is while the finger holds it, and whether it is on screen
     after the lift. */
  await openCard('modes');
  const grip = await page.evaluate(() => {
    const el = document.querySelector('.focard');
    if (!el) return null;
    const c = el.getBoundingClientRect();
    return { x: Math.round(c.x + c.width / 2), y: Math.round(c.top + 7), rest: Math.round(c.top) };
  });
  check(!!grip, 'the mode chip dealt no card to drag', null);
  if (grip) {
    // (a) 44px, short of the line: the card follows the finger, then springs home
    await dragSheetAndHold(page, grip, 44);
    out.cardHeld = await page.evaluate(() => {
      const c = document.querySelector('.focard')?.getBoundingClientRect();
      return c ? Math.round(c.top) : null;
    });
    check(out.cardHeld - grip.rest > 30, 'the card did not follow the finger down', { held: out.cardHeld, rest: grip.rest });
    // a finger that pauses before lifting is a change of mind, not a flick — which
    // keeps this about the DISTANCE rule, not the velocity one
    await page.waitForTimeout(160);
    await page.mouse.up();
    await page.waitForTimeout(420);
    out.cardSprung = await page.evaluate(() => {
      const c = document.querySelector('.faceoff .focard')?.getBoundingClientRect();
      return { alive: !!document.querySelector('.faceoff'), top: c ? Math.round(c.top) : null };
    });
    check(out.cardSprung.alive && Math.abs(out.cardSprung.top - grip.rest) <= 2,
      'a short drag did not spring the card home', { ...out.cardSprung, rest: grip.rest });
    // (b) 150px, past the line: released, it goes
    await dragSheetAndHold(page, grip, 150);
    await page.waitForTimeout(160);
    await page.mouse.up();
    out.cardDragClosed = await sheetGone(page);
    check(out.cardDragClosed, 'a drag past the commit line did not dismiss the card', null);
  }

  /* THE KEYBOARD AND THE SCREEN READER. A gesture is silent and unreachable, so
     the mark that promises it is also a real, labelled, focusable button. */
  await openCard('spells');
  out.cardGrab = await page.evaluate(() => {
    const b = document.querySelector('.fograb');
    if (!b) return null;
    b.focus();
    return { tag: b.tagName, label: b.getAttribute('aria-label') ?? '',
             focusable: b.tabIndex >= 0 && !b.disabled, focused: document.activeElement === b };
  });
  check(out.cardGrab?.tag === 'BUTTON' && out.cardGrab?.label.length > 0 &&
        out.cardGrab?.focusable && out.cardGrab?.focused,
    'the card has no announceable, focusable way out', out.cardGrab);
  await page.keyboard.press('Enter');
  out.cardKeyClosed = await sheetGone(page);
  check(out.cardKeyClosed, 'the keyboard door does not dismiss the card', null);
  /* Escape too — and, the half that matters, IT MUST NOT REACH PAST THE CARD.
     boot.ts stands its own Escape handler down while a sheet is up, because that
     handler also disarms an armed spell and sweeps the overlays behind. Without
     that guard the player aims a rune, taps the chip to check what the mode
     does, presses Escape to put the card away — and the rune is disarmed too.
     The old assertion only asked whether the card went, which a broken guard
     also satisfies: deleting boot's `if(sheetOpen()) return;` left this suite
     green while the rune was quietly lost. So this arms a spell FIRST and reads
     it back afterwards. */
  await openCard('modes');
  await page.evaluate(() => window.__kb.spells.arm('ward'));
  out.armedBeforeEsc = await page.evaluate(() => ({
    armed: window.__kb.S.spellArmed,
    casting: document.getElementById('kbroot').classList.contains('casting'),
  }));
  await page.keyboard.press('Escape');
  out.cardEscClosed = await sheetGone(page);
  out.armedAfterEsc = await page.evaluate(() => ({
    armed: window.__kb.S.spellArmed,
    casting: document.getElementById('kbroot').classList.contains('casting'),
  }));
  check(out.cardEscClosed, 'Escape does not dismiss the card', null);
  check(out.armedBeforeEsc?.armed === 'ward', 'the probe never armed the rune', out.armedBeforeEsc);
  check(out.armedAfterEsc?.armed === 'ward',
    'ESCAPE REACHED PAST THE CARD AND DISARMED THE RUNE the player had aimed',
    { before: out.armedBeforeEsc, after: out.armedAfterEsc });
  // and a SECOND Escape, with no card up, is the one that disarms
  await page.keyboard.press('Escape');
  out.armedAfterSecond = await page.evaluate(() => window.__kb.S.spellArmed);
  check(out.armedAfterSecond === null,
    'with the card gone, Escape must go back to disarming the rune', out.armedAfterSecond);
  await leaveGame();

  // RANDOM resolves at the deal: the badge must name the rune, never "random"
  await playLocal(0, 'random');
  out.badgeRandom = await chipsNow();
  check(out.badgeRandom.chips.length === 2 && out.badgeRandom.chips[1].id !== 'random',
    'RANDOM must name the rune actually dealt, not the promise to draw one', out.badgeRandom);
  await leaveGame();

}
