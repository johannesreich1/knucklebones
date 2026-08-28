import { armSheetArrival, dragSheetAndHold, sheetGone } from '../../support/sheet-card.mjs';
import { grabCentre, openFaceoff, tapGrabAndReport, touchDragAndRelease } from '../harness/faceoff-sheet.mjs';
import { readFaceoffCard, readGrabMetrics, sampleEscapeExitFlight } from '../harness/faceoff-metrics.mjs';

export async function probeFaceoff(page, { door, motion }) {
  /* the tap: a board row deals the face-off. The reader here is signed OUT,
     so the card must be the one-column variant — a VS against nobody is the
     kind of half-rendered state only a click can reveal.
     And the card is a SHEET now (design 30c, user call 2026-08-22): no ✕
     anywhere, a grabber on its top edge, up from the bottom on arrival and
     back down there on a drag. Every line below reads PIXELS — a sheet that
     merely appeared, or a drag the card ignored, agrees with the DOM
     perfectly (single-strike-visibility's lesson). */
  let faceoff = null;
  if (door === 'board') {
    await armSheetArrival(page);
    await openFaceoff(page);
    faceoff = await readFaceoffCard(page);
    faceoff.grab = await readGrabMetrics(page);
    /* MOTION REDUCED: the sheet still arrives and still leaves, it simply does
       not travel to do either. A drag is the player's own finger and is never
       reduced: sample a deliberately slow one before testing the instant exit.
       The global reduced-motion duration used to synthesize transition:all on
       every pointer step, leaving the card visibly chasing the finger. */
    if (motion === 'reduce') {
      const grip = await page.evaluate(() => {
        const c = document.querySelector('.focard').getBoundingClientRect();
        return { x: Math.round(c.x + c.width / 2), y: Math.round(c.top + 7), rest: c.top };
      });
      faceoff.dragTrack = [];
      await dragSheetAndHold(page, grip, 48, { steps: 6, pace: 40, onStep: async (distance) => {
        faceoff.dragTrack.push(await page.evaluate(({ rest, distance }) => {
          const ov = document.querySelector('.faceoff');
          const card = ov.querySelector('.focard');
          return { distance, actual: Math.round((card.getBoundingClientRect().top - rest) * 10) / 10,
                   transition: getComputedStyle(card).transitionDuration };
        }, { rest: grip.rest, distance }));
      } });
      await page.waitForTimeout(120); // a paused short drag is not a flick
      await page.mouse.up();
      await page.waitForTimeout(100);
      faceoff.dragSprung = await page.evaluate((rest) => {
        const card = document.querySelector('.faceoff .focard');
        return { alive: !!card, top: card ? Math.round(card.getBoundingClientRect().top - rest) : null };
      }, grip.rest);
      await page.keyboard.press('Escape');
      // read at once, with no grace: an exit FLIGHT would still be on screen
      faceoff.escInstant = await page.evaluate(() => !document.querySelector('.faceoff'));
    } else {
      /* THE TIGHTEST PHONE. 320px wide: the card is 292px, and the grabber must
         still be centred on its edge and still cost it nothing horizontally. */
      await page.setViewportSize({ width: 320, height: 640 });
      await page.waitForTimeout(120);
      // the same measurement, not a second copy of it — a narrow phone is a
      // width the grabber is measured AT, not a different grabber
      faceoff.narrow = {
        card: await page.evaluate(() =>
          Math.round(document.querySelector('.focard').getBoundingClientRect().width)),
        ...await readGrabMetrics(page),
      };
      await page.setViewportSize({ width: 430, height: 932 });
      await page.waitForTimeout(120);

      /* THE DRAG. Two of them, synthesised on the card itself — one short, one
         past the 96px commit line — and both read as pixels: where the card is
         while the finger holds it, and whether it is still on screen after. */
      const grip = await page.evaluate(() => {
        const c = document.querySelector('.focard').getBoundingClientRect();
        return { x: Math.round(c.x + c.width / 2), y: Math.round(c.top + 7), rest: Math.round(c.top) };
      });
      // (a) 48px, half the line: the card follows the finger and the wash
      //     lightens with it — then the release springs it home.
      await dragSheetAndHold(page, grip, 48);
      faceoff.held = await page.evaluate(() => {
        const ov = document.querySelector('.faceoff');
        const c = ov?.querySelector('.focard')?.getBoundingClientRect();
        const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(ov).backgroundColor || '');
        const p = m ? m[1].split(',') : [];
        return { top: c ? Math.round(c.top) : null, wash: p.length > 3 ? parseFloat(p[3]) : 1 };
      });
      // a finger that pauses before lifting is a change of mind, not a flick —
      // and it keeps this assertion about the DISTANCE rule, not the velocity one
      await page.waitForTimeout(160);
      await page.mouse.up();
      await page.waitForTimeout(400);
      faceoff.sprung = await page.evaluate(() => {
        const ov = document.querySelector('.faceoff');
        const c = ov?.querySelector('.focard')?.getBoundingClientRect();
        return { alive: !!ov, top: c ? Math.round(c.top) : null };
      });
      // (b) the backdrop, which the ✕ never was and still has to be: a tap on
      //     the wash outside the card closes it — and the click that ends a
      //     drag must never be mistaken for one (it is swallowed above).
      await page.mouse.click(8, 8);
      faceoff.backdropClosed = await sheetGone(page);
      /* (b2) THE SAME PAIR, ON A FINGER. Every drag above is driven with the
         mouse, which always emits the compatibility click that spends the
         one-click swallow. A TOUCH that moved emits no click at all, so the
         flag outlived its gesture and ate the player's next honest tap on the
         wash — the tap of someone who started a drag, thought better of it,
         and reached for the way out. Measured 3/3 on a trusted touch stream
         before the fix; the mouse path could not see it, which is why this
         step exists in the finger's own idiom. */
      await openFaceoff(page);
      const tgrip = await grabCentre(page);
      await page.touchscreen.tap(tgrip.x, tgrip.y + 0);          // settle the surface
      if (!await sheetGone(page)) throw new Error('touchscreen setup tap did not dismiss the face-off');
      await openFaceoff(page);
      await touchDragAndRelease(page, tgrip);
      await page.waitForTimeout(300);
      faceoff.touchSprung = await page.evaluate(() => {
        const c = document.querySelector('.faceoff .focard')?.getBoundingClientRect();
        return { alive: !!document.querySelector('.faceoff'), top: c ? Math.round(c.top) : null };
      });
      await page.touchscreen.tap(8, 8);
      faceoff.touchBackdropClosed = await sheetGone(page);
      /* and if it was eaten, take the card off by hand so the walk continues:
         a sheet left standing intercepts every later click and the suite would
         report a 30s timeout instead of the door that stopped answering. */
      if (!faceoff.touchBackdropClosed) await page.evaluate(() => document.querySelector('.faceoff')?.remove());
      // (c) 140px, past the line: released, it goes, and the ladder is back
      await openFaceoff(page);
      await dragSheetAndHold(page, grip, 140);
      await page.waitForTimeout(160);
      await page.mouse.up();
      faceoff.dragClosed = await sheetGone(page);
      /* (c2) THE FLICK: 40px, less than half the commit line, but thrown and
         released while still moving. Distance alone would spring this home, and
         a flick that springs back feels stuck — so velocity commits it too. */
      await openFaceoff(page);
      await dragSheetAndHold(page, grip, 40, { steps: 4, pace: 0 });
      await page.mouse.up();
      faceoff.flickClosed = await sheetGone(page);
      // (d) the keyboard: Escape, the door that was never visible — and the
      //     exit flight it starts, which blocks the ladder after the wash has
      //     already faded out of sight (sampleEscapeExitFlight owns that read)
      await openFaceoff(page);
      faceoff.exit = await sampleEscapeExitFlight(page);
      faceoff.escClosed = await sheetGone(page);
      /* (e) THE PLAIN TAP, which is the door most players will use. It is not
         the keyboard's door wearing gloves: a press that captured the pointer
         on contact handed the tap's click to .focard, so the grabber's own
         listener never ran, the backdrop's `target === ov` was false, and the
         sheet sat exactly where it was — green tests and all, because the only
         one asked was Enter. What the click LANDED on is reported beside
         whether the card left, because the target IS the bug. */
      await openFaceoff(page);
      faceoff.tapTarget = await tapGrabAndReport(page, 'bar');
      faceoff.tapClosed = await sheetGone(page);
      /* (f) …and the same tap on the half of the target that is not drawn. 2px
         below the bar's box is off the 14px wrapper and onto the invisible
         expander that carries it to 44px. Same finger, same door — or the
         expander is gone and the tap lands on the card, which has no answer. */
      await openFaceoff(page);
      faceoff.expandTarget = await tapGrabAndReport(page, 'under');
      faceoff.expandClosed = await sheetGone(page);
      /* (g) THE ANNOUNCEABLE DOOR. With the ✕ gone the gesture is the only exit
         a sighted mouse user can see, and a gesture is nothing to a screen
         reader. The grabber is therefore a real button: it takes focus, it has
         a name, and Enter on it dismisses through the same close(). The modal
         owns that key: dismissing it must not also reach Home's game shortcut. */
      await openFaceoff(page);
      faceoff.focused = await page.evaluate(() => {
        const b = document.querySelector('.fograb');
        b.focus();
        return document.activeElement === b;
      });
      await page.keyboard.press('Enter');
      faceoff.keyClosed = await sheetGone(page);
      faceoff.keyRoute = await page.evaluate(() => ({
        firstRunVisible: document.getElementById('ovFirst')?.classList.contains('on') ?? false,
        phase: window.__kb.S.phase,
      }));
    }
  }
  return faceoff;
}
