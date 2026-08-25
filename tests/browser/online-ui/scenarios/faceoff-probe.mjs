export async function probeFaceoff(page, { door, motion }) {
  /* the tap: a board row deals the face-off. The reader here is signed OUT,
     so the card must be the one-column variant — a VS against nobody is the
     kind of half-rendered state only a click can reveal.
     And the card is a SHEET now (design 30c, user call 2026-08-22): no ✕
     anywhere, a grabber on its top edge, up from the bottom on arrival and
     back down there on a drag. Every line below reads PIXELS — a sheet that
     merely appeared, or a drag the card ignored, agrees with the DOM
     perfectly (test13's lesson). */
  let faceoff = null;
  if (door === 'board') {
    /* THE ARRIVAL, sampled frame by frame — armed BEFORE the tap, because the
       flight is 340ms and the interesting part is its first frame. One custom
       property drives the card's transform and the wash's alpha, so both are
       read here: if they ever disagree, the fade lands somewhere the card is
       not. */
    const armFlight = () => page.evaluate(() => {
      window.__fo = { vh: window.innerHeight, frames: [] };
      const alpha = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c || '');
        if (!m) return 1;
        const p = m[1].split(',');
        return p.length > 3 ? parseFloat(p[3]) : 1;
      };
      const tick = () => {
        const c = document.querySelector('.focard'), ov = document.querySelector('.faceoff');
        if (c && ov) window.__fo.frames.push({ top: Math.round(c.getBoundingClientRect().top),
                                               a: alpha(getComputedStyle(ov).backgroundColor) });
        if (window.__fo.frames.length < 36) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // one door in, used for every reopen below: tap a row, wait for the RPC's
    // digits, then let the 340ms arrival land before anything is measured
    const open = async () => {
      await page.click('#ovOnline .lb .lrow');
      await page.waitForFunction(() =>
        /\d/.test(document.querySelector('.faceoff .fostreak')?.textContent ?? ''), null, { timeout: 15000 });
      await page.waitForTimeout(450);
    };
    const gone = () => page.waitForFunction(() => !document.querySelector('.faceoff'),
                                            null, { timeout: 4000 }).then(() => true, () => false);
    /* THE GRABBER, MEASURED AS THE PLAYER MEETS IT (design 30c-foexit-grabber).
       No ✕ lives on this card any more — not in the corner, not in a header,
       not under the stats. What replaces it is a 40×4 bar on the card's top
       EDGE that is also a real, labelled, focusable button, because a gesture
       alone is silent to a screen reader and unreachable from a keyboard.
       ONE measurement, taken at every width this suite tries: the painted box,
       the TIGHTEST distance to anything the card draws below it — reported as
       a number, because a boolean that passes by 0.00px says nothing about how
       close the next change came — and the size of the area that actually
       answers a finger, which only elementFromPoint can see: a 14px control
       carrying an invisible expander and a 14px control without one have the
       same rect and are not the same control. */
    const grabMetrics = () => page.evaluate(() => {
      const ov = document.querySelector('.faceoff');
      const b = ov?.querySelector('.fograb'), bar = ov?.querySelector('.fobar');
      const cb = ov?.querySelector('.focard')?.getBoundingClientRect();
      const bb = b?.getBoundingClientRect(), rb = bar?.getBoundingClientRect();
      if (!b || !bb || !cb) return null;
      const bits = [...ov.querySelectorAll('.focols .av,.focols .fnm,.focols .gpill,.focols .fovs')]
        .map((el) => el.getBoundingClientRect());
      // how far two boxes stand apart along the axis that separates them,
      // negative where they overlap — so a regression states HOW far it went
      const apart = (q) => Math.max(q.left - bb.right, bb.left - q.right,
                                    q.top - bb.bottom, bb.top - q.bottom);
      /* the hit band, walked outward from the middle of the bar one pixel at a
         time. It counts the points that ANSWER, and a box owns its top-left
         edge but not its bottom-right one, so the outermost answering points
         span exactly one pixel less than the box they belong to — hence the
         +1 below, which makes these the box's own numbers again. */
      const mine = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && (el === b || b.contains(el)); };
      const cx = (bb.left + bb.right) / 2, cy = (bb.top + bb.bottom) / 2;
      let top = cy, bot = cy, left = cx, right = cx;
      while (top > 1 && mine(cx, top - 1)) top--;
      while (bot < window.innerHeight - 1 && mine(cx, bot + 1)) bot++;
      while (left > 1 && mine(left - 1, cy)) left--;
      while (right < window.innerWidth - 1 && mine(right + 1, cy)) right++;
      return {
        tag: b.tagName, label: b.getAttribute('aria-label') ?? '',
        focusable: b.tabIndex >= 0 && !b.disabled,
        bar: rb ? { w: Math.round(rb.width), h: Math.round(rb.height) } : null,
        /* centred on the card, and standing on its top edge */
        centred: Math.abs(cx - (cb.left + cb.right) / 2) < 1,
        fromTop: Math.round(bb.top - cb.top),
        /* and it costs the card NO width: the 46px avatars and the
           130px-capped nickname keep the whole card */
        clearBy: bits.length ? Math.round(Math.min(...bits.map(apart)) * 10) / 10 : null,
        // what a FINGER gets, which is not what is drawn
        tap: { w: Math.round(right - left) + 1, h: Math.round(bot - top) + 1 },
        avatar: Math.round(ov.querySelector('.focol .av')?.getBoundingClientRect().width ?? 0),
      };
    });
    await armFlight();
    await open();
    faceoff = await page.evaluate(() => {
      const ov = document.querySelector('.faceoff');
      const rc = ov?.querySelector('.focard')?.getBoundingClientRect();
      /* the pixel test, not the rect test: the card first shipped at z-index
         60 under the board overlay (z 80) — present in the DOM, invisible on
         screen. elementFromPoint answers what the PLAYER gets. */
      const hit = rc ? document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2) : null;
      const f = window.__fo.frames;
      return {
        visible: !!rc && rc.width > 0 && rc.height > 0 && !!ov?.contains(hit),
        solo: !!ov?.classList.contains('solo'),
        vsShown: !!ov?.querySelector('.fovs'),
        name: ov?.querySelector('.fnm')?.textContent,
        streak: ov?.querySelector('.fostreak')?.textContent,
        record: [...(ov?.querySelectorAll('.fost') ?? [])].map((s) => s.textContent?.trim() ?? '')[1] ?? '',
        /* IT CAME UP FROM THE BOTTOM. Not "a class was added": the card's own
           box started far below where it settled and climbed, and the wash
           was thinner then than it is now. The first sample is whatever frame
           the rAF caught, so the assertion is about DISTANCE TRAVELLED, not
           about catching frame zero. */
        arrive: f.length ? { first: f[0].top, last: f[f.length - 1].top, vh: window.__fo.vh,
                             washFirst: f[0].a, washLast: f[f.length - 1].a,
                             rose: f.every((s, i) => i === 0 || s.top <= f[i - 1].top + 1) } : null,
        /* nothing anywhere still offers the retired shapes */
        noX: !ov?.querySelector('.foexit') && ![...(ov?.querySelectorAll('button') ?? [])]
          .some((b) => (b.textContent ?? '').includes('✕')),
        bottomBtns: [...(ov?.querySelectorAll('.btn') ?? [])].map((b) => b.textContent?.trim() ?? ''),
        gapLine: !!ov?.querySelector('.fogap'),
        rest: rc ? Math.round(rc.top) : null,
      };
    });
    faceoff.grab = await grabMetrics();
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
      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      faceoff.dragTrack = [];
      for (let i = 1; i <= 6; i++) {
        const distance = i * 8;
        await page.mouse.move(grip.x, grip.y + distance);
        faceoff.dragTrack.push(await page.evaluate(({ rest, distance }) => {
          const ov = document.querySelector('.faceoff');
          const card = ov.querySelector('.focard');
          return { distance, actual: Math.round((card.getBoundingClientRect().top - rest) * 10) / 10,
                   transition: getComputedStyle(card).transitionDuration };
        }, { rest: grip.rest, distance }));
        await page.waitForTimeout(40);
      }
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
        ...await grabMetrics(),
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
      const dragTo = async (dist, steps = 8, pace = 16) => {
        await page.mouse.move(grip.x, grip.y);
        await page.mouse.down();
        for (let i = 1; i <= steps; i++) {
          await page.mouse.move(grip.x, grip.y + Math.round((dist * i) / steps));
          if (pace) await page.waitForTimeout(pace);
        }
      };
      // (a) 48px, half the line: the card follows the finger and the wash
      //     lightens with it — then the release springs it home.
      await dragTo(48);
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
      faceoff.backdropClosed = await gone();
      /* (b2) THE SAME PAIR, ON A FINGER. Every drag above is driven with the
         mouse, which always emits the compatibility click that spends the
         one-click swallow. A TOUCH that moved emits no click at all, so the
         flag outlived its gesture and ate the player's next honest tap on the
         wash — the tap of someone who started a drag, thought better of it,
         and reached for the way out. Measured 3/3 on a trusted touch stream
         before the fix; the mouse path could not see it, which is why this
         step exists in the finger's own idiom. */
      await open();
      const tgrip = await page.evaluate(() => {
        const b = document.querySelector('.fograb').getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
      });
      await page.touchscreen.tap(tgrip.x, tgrip.y + 0);          // settle the surface
      if (!await gone()) throw new Error('touchscreen setup tap did not dismiss the face-off');
      await open();
      await page.evaluate(async ([x, y]) => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const fire = (t, cy) => document.elementFromPoint(x, Math.min(cy, innerHeight - 1))
          ?.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true,
            clientX: x, clientY: cy, bubbles: true, cancelable: true }));
        fire('pointerdown', y);
        /* PACED LIKE A FINGER. Dispatched back to back, six 8px steps arrive in
           ~0ms and the velocity rule reads them as a flick — which commits, and
           the card leaves. That is the harness moving impossibly fast, not the
           app being wrong: 8px per 40ms is 0.2px/ms, well under the 0.5 the
           flick asks for. The lift then waits out the 80ms staleness window,
           so this is unambiguously a slow drag released short. */
        for (let i = 1; i <= 6; i++) { await wait(40); fire('pointermove', y + i * 8); }
        await wait(120);
        fire('pointerup', y + 48);
      }, [tgrip.x, tgrip.y]);
      await page.waitForTimeout(300);
      faceoff.touchSprung = await page.evaluate(() => {
        const c = document.querySelector('.faceoff .focard')?.getBoundingClientRect();
        return { alive: !!document.querySelector('.faceoff'), top: c ? Math.round(c.top) : null };
      });
      await page.touchscreen.tap(8, 8);
      faceoff.touchBackdropClosed = await gone();
      /* and if it was eaten, take the card off by hand so the walk continues:
         a sheet left standing intercepts every later click and the suite would
         report a 30s timeout instead of the door that stopped answering. */
      if (!faceoff.touchBackdropClosed) await page.evaluate(() => document.querySelector('.faceoff')?.remove());
      // (c) 140px, past the line: released, it goes, and the ladder is back
      await open();
      await dragTo(140);
      await page.waitForTimeout(160);
      await page.mouse.up();
      faceoff.dragClosed = await gone();
      /* (c2) THE FLICK: 40px, less than half the commit line, but thrown and
         released while still moving. Distance alone would spring this home, and
         a flick that springs back feels stuck — so velocity commits it too. */
      await open();
      await dragTo(40, 4, 0);
      await page.mouse.up();
      faceoff.flickClosed = await gone();
      /* (d) the keyboard: Escape, the door that was never visible — and the
         exit FLIGHT it starts, sampled frame by frame like the arrival. The
         wash is at alpha 0 about 40% of the way down, but the overlay covers
         inset:0 until it is removed, so for the rest of the flight a sheet
         nobody can see is still between the finger and the ladder. Read at the
         middle of the screen, every frame: while the card rests there the
         sheet must answer, and from the moment it starts leaving it must not. */
      await open();
      await page.evaluate(() => {
        window.__exit = { pressed: -1, f: [] };
        const tick = () => {
          const ov = document.querySelector('.faceoff');
          if (!ov) return;
          const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
          window.__exit.f.push({ top: ov.querySelector('.focard').getBoundingClientRect().top,
                                 hit: !!(el && (el === ov || ov.contains(el))) });
          if (window.__exit.f.length < 60) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.waitForTimeout(60);
      await page.evaluate(() => { window.__exit.pressed = window.__exit.f.length; });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(320);
      faceoff.exit = await page.evaluate(() => {
        const { f, pressed } = window.__exit, rest = f.length ? f[0].top : 0;
        /* "leaving" is not a class here, it is the card being visibly lower
           than it rested. The frames between the last one that is certainly
           BEFORE the press and the first one that has certainly MOVED are the
           key's own flight time and belong to neither side. */
        const at = f.slice(0, Math.max(0, pressed));
        const off = f.slice(f.findIndex((s) => s.top > rest + 2));
        return { rested: at.length, restedHit: at.filter((s) => s.hit).length,
                 leaving: off.length, leavingHit: off.filter((s) => s.hit).length };
      });
      faceoff.escClosed = await gone();
      /* (e) THE PLAIN TAP, which is the door most players will use. It is not
         the keyboard's door wearing gloves: a press that captured the pointer
         on contact handed the tap's click to .focard, so the grabber's own
         listener never ran, the backdrop's `target === ov` was false, and the
         sheet sat exactly where it was — green tests and all, because the only
         one asked was Enter. What the click LANDED on is reported beside
         whether the card left, because the target IS the bug. */
      const clickGrab = async (where) => {
        const p = await page.evaluate((w) => {
          const b = document.querySelector('.fograb').getBoundingClientRect();
          window.__ct = null;
          document.addEventListener('click', (e) => {
            window.__ct = e.target instanceof Element ? (e.target.className || e.target.tagName) : '?';
          }, { capture: true, once: true });
          return { x: Math.round((b.left + b.right) / 2),
                   y: Math.round(w === 'bar' ? (b.top + b.bottom) / 2 : b.bottom + 2) };
        }, where);
        await page.mouse.click(p.x, p.y);
        return page.evaluate(() => window.__ct);
      };
      await open();
      faceoff.tapTarget = await clickGrab('bar');
      faceoff.tapClosed = await gone();
      /* (f) …and the same tap on the half of the target that is not drawn. 2px
         below the bar's box is off the 14px wrapper and onto the invisible
         expander that carries it to 44px. Same finger, same door — or the
         expander is gone and the tap lands on the card, which has no answer. */
      await open();
      faceoff.expandTarget = await clickGrab('under');
      faceoff.expandClosed = await gone();
      /* (g) THE ANNOUNCEABLE DOOR. With the ✕ gone the gesture is the only exit
         a sighted mouse user can see, and a gesture is nothing to a screen
         reader. The grabber is therefore a real button: it takes focus, it has
         a name, and Enter on it dismisses through the same close().
         LAST, and it has to be: Home's own Enter shortcut (boot.ts) fires
         through every overlay above it, so this press also starts a local game
         and puts the first-run tutorial offer over the ladder. That is not
         this card's doing and not this suite's business — but anything that
         needs the ladder must happen before it. */
      await open();
      faceoff.focused = await page.evaluate(() => {
        const b = document.querySelector('.fograb');
        b.focus();
        return document.activeElement === b;
      });
      await page.keyboard.press('Enter');
      faceoff.keyClosed = await gone();
    }
  }
  return faceoff;
}
