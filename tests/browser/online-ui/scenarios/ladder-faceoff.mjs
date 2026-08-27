async function ladderOpeningProbe(page) {
  await page.click('#btnLadder');
  await page.waitForSelector('#onLadder:not([hidden]) #onLadderList .lrow.me', { timeout: 15000 });
  await page.waitForTimeout(100);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() =>
    requestAnimationFrame(resolve))));
  return page.evaluate(() => {
    const body = document.querySelector('#ovOnline .pbody');
    const head = document.querySelector('#ovOnline .shead');
    const me = document.querySelector('#onLadderList .lrow.me');
    if (!(body instanceof HTMLElement) || !(head instanceof HTMLElement)
        || !(me instanceof HTMLElement)) throw new Error('ladder opening geometry is missing');
    const bodyBox = body.getBoundingClientRect();
    const headBox = head.getBoundingClientRect();
    const meBox = me.getBoundingClientRect();
    const maximum = Math.max(0, body.scrollHeight - body.clientHeight);
    const contentCenter = body.scrollTop + meBox.top - bodyBox.top + meBox.height / 2;
    const desired = contentCenter - body.clientHeight / 2;
    const expected = Math.max(0, Math.min(maximum, desired));
    const hit = document.elementFromPoint(meBox.left + meBox.width / 2,
      meBox.top + meBox.height / 2);
    /* NO HOLES ANYWHERE THE READER IS LOOKING. A windowed list can only fail
       one way that matters here — a gap where a row should be — so sweep the
       visible column and demand every sample land inside the list. This is
       strictly stronger than the row count it replaces, which only ever
       described the arithmetic of the old hand-rolled opening. */
    const list = document.querySelector('#onLadderList');
    const x = bodyBox.left + bodyBox.width / 2;
    /* Bounded by the ROWS, not by the scroller. .pbody reserves real space at
       the bottom for the home indicator (paged-view.css), and at the end of the
       board that reserve is legitimately empty — sweeping into it would call
       the app's own safe-area padding a hole. */
    const listBox = list?.getBoundingClientRect();
    const top = Math.max(headBox.bottom + 2, bodyBox.top + 2, (listBox?.top ?? 0) + 2);
    const bottom = Math.min(bodyBox.bottom - 2, (listBox?.bottom ?? 0) - 2);
    let samples = 0;
    let holes = 0;
    for (let y = top; y < bottom; y += 20) {
      samples++;
      if (!list?.contains(document.elementFromPoint(x, y))) holes++;
    }
    const slots = [...(list?.querySelectorAll('[data-slot]') ?? [])]
      .map((slot) => Number(slot.dataset.slot));
    return {
      samples,
      holes,
      mounted: slots.length,
      window: slots.length ? [Math.min(...slots), Math.max(...slots)] : null,
      rank: me.querySelector('.rk2')?.textContent?.trim(),
      rowCount: document.querySelectorAll('#onLadderList .lrow').length,
      scrollTop: body.scrollTop,
      maximum,
      expected,
      centerError: meBox.top + meBox.height / 2 - (bodyBox.top + body.clientHeight / 2),
      fullyVisible: meBox.top >= headBox.bottom - 1 && meBox.bottom <= bodyBox.bottom + 1,
      centerHit: me.contains(hit),
    };
  });
}

export async function runLadderFaceoffScenarios(suite) {
  const { visit, out, check } = suite;
  // 1b · the ladder that same guest lands on: a row states BOTH sides
  const board = await visit({ door: 'board', probe: async (page) => {
    let localeRequests = 0;
    const countRequest = (request) => {
      if (request.url().includes('/rpc/leaderboard')) localeRequests++;
    };
    page.on('request', countRequest);
    await page.locator('#onLadderList .lrow').first().focus();
    await page.evaluate(() => {
      window.__kbLocaleRow = document.querySelector('#onLadderList .lrow');
      Object.defineProperty(navigator, 'languages', {
        configurable: true, get: () => ['de-DE', 'en-US'],
      });
      Object.defineProperty(navigator, 'language', {
        configurable: true, get: () => 'de-DE',
      });
      window.dispatchEvent(new Event('languagechange'));
    });
    await page.waitForFunction(() => document.querySelector('#onTitle')?.textContent === 'RANGLISTE');
    const german = await page.evaluate(() => {
      const row = document.querySelector('#onLadderList .lrow');
      return {
        title: document.querySelector('#onTitle')?.textContent,
        record: row?.querySelector('.ws')?.textContent,
        points: row?.querySelector('.rt')?.textContent,
        horizon: document.querySelector('#onLadderList .ghor .gn')?.textContent,
        sameRow: row === window.__kbLocaleRow,
        focused: document.activeElement === row,
      };
    });
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'languages', {
        configurable: true, get: () => ['en-US'],
      });
      Object.defineProperty(navigator, 'language', {
        configurable: true, get: () => 'en-US',
      });
      window.dispatchEvent(new Event('languagechange'));
    });
    await page.waitForFunction(() => document.querySelector('#onTitle')?.textContent === 'LADDER');
    const restored = await page.evaluate(() => {
      const row = document.querySelector('#onLadderList .lrow');
      return { sameRow: row === window.__kbLocaleRow, focused: document.activeElement === row };
    });
    page.off('request', countRequest);
    return { german, restored, localeRequests };
  } });
  out.ladderLocaleRepaint = board.probeResult;
  check(board.probeResult?.german?.title === 'RANGLISTE'
        && board.probeResult.german.record === 'S 7 · N 2'
        && board.probeResult.german.points === '1.072'
        && board.probeResult.german.horizon === 'ELFENBEIN',
        'the visible ladder did not repaint all locale-owned copy and formatting', board.probeResult);
  check(board.probeResult?.german?.sameRow && board.probeResult.german.focused
        && board.probeResult?.restored?.sameRow && board.probeResult.restored.focused
        && board.probeResult.localeRequests === 0,
        'locale repaint replaced/refetched the interactive ladder or lost focus', board.probeResult);
  out.ladder = board.seen.rows;
  check(board.seen.rows.length === 2, 'ladder did not render its rows', board.seen.rows);
  check(board.seen.rows[0]?.text === 'W 7 · L 2', 'a ladder row does not state wins AND losses', board.seen.rows);
  check(board.seen.rows[1]?.text === 'W 42 · L 61', 'a lopsided record is not stated in full', board.seen.rows);
  check(board.seen.rows.every((r) => r.lossItalic === 'normal'),
        'the loss count is rendering italic — .n2 lost its shape outside the HUD', board.seen.rows);
  /* points, read from the RENDERED row: the 0018 migration renamed the RPC's
     column rating → points and the ladder printed "undefined" for a day while
     this mock still spoke the old shape. The mock now mirrors the live RPC,
     and this line fails if the client and it ever disagree about names again. */
  check(board.seen.rows[0]?.pts === '1,072', 'a ladder row does not state the points', board.seen.rows);
  // the groups, as structure: one horizon per material change, and the board opens with one
  check(board.seen.horizons.join() === 'IVORY,BONE', 'the group horizons are missing or wrong', board.seen.horizons);
  check(board.seen.firstIsHorizon === true, 'the board does not open with its group horizon', board.seen);

  /* A real near-bottom standing has a full page above it but only a short tail.
     The paged body is the one scroller; preserving/centering against the inner
     overflow-visible list lets a prepend push the player's row off screen. */
  const opening = {};
  for (const viewport of [
    { name: 'centred', width: 390, height: 568 },
    { name: 'bottom-clamped', width: 390, height: 844 },
  ]) {
    const run = await visit({
      named: true,
      ladderNearBottom: true,
      viewport,
      skipStandardProbes: true,
      probe: ladderOpeningProbe,
    });
    opening[viewport.name] = run.probeResult;
    const geometry = run.probeResult;
    check(geometry?.rank === 'Rank #145'
        && geometry.fullyVisible
        && geometry.centerHit
        && Math.abs(geometry.scrollTop - geometry.expected) <= 2,
    `the 145/151 ladder opening did not center or clamp its player row at ${viewport.height}px`,
    geometry);
    /* The list is WINDOWED: it mounts a few screens of rows, not the board. The
       old `rowCount === 27` was the arithmetic of the hand-rolled opening (20
       above + 30 below, less dedupe and horizons) and was never a fact about
       what the player sees. These two are. */
    check(geometry?.samples > 10 && geometry.holes === 0,
      `the windowed ladder left a hole in the visible column at ${viewport.height}px`,
      geometry);
    check(geometry?.mounted > 0 && geometry.mounted < 151,
      `the ladder mounted the whole board instead of a window at ${viewport.height}px`,
      geometry);
    check(run.errs.length === 0,
      `page errors while opening the 145/151 ladder at ${viewport.height}px`, run.errs);
  }
  out.ladderOpening = opening;
  check(Math.abs(opening.centred?.centerError ?? 999) <= 2
      && (opening.centred?.scrollTop ?? 0) < (opening.centred?.maximum ?? 0) - 2,
    'the player row was not centered when the ladder had room on both sides', opening.centred);
  check(Math.abs((opening['bottom-clamped']?.scrollTop ?? -1)
      - (opening['bottom-clamped']?.maximum ?? -2)) <= 2,
    'the near-bottom player row was not clamped fully visible at the list end',
    opening['bottom-clamped']);

  // the tap: a row deals the face-off, one-column for a signed-out reader
  check(board.faceoff?.visible === true, 'tapping a row does not deal the face-off', board.faceoff);
  check(board.faceoff?.solo === true && board.faceoff?.vsShown === false,
        'a signed-out reader was dealt a VS column with nobody in it', board.faceoff);
  check(board.faceoff?.name === 'NovaComet992', 'the face-off names the wrong player', board.faceoff);
  check(board.faceoff?.streak === '4', 'the face-off streak did not arrive from player_card', board.faceoff);
  check(board.faceoff?.record.includes('W 7') && board.faceoff?.record.includes('L 2'),
        'the face-off does not state both sides of the record', board.faceoff);
  /* THE WAY OUT (design 30c-foexit-grabber, user call 2026-08-22): the card is
     a sheet. It arrives from the bottom, it wears a grabber instead of a ✕,
     and it leaves by being dragged back down — with the backdrop tap and
     Escape untouched, because they were never the thing that was wrong. */
  const fo = board.faceoff;
  check(fo?.noX === true, 'a ✕ is still on the face-off — the card wears a grabber now', fo?.grab);
  check(fo?.bottomBtns.length === 0, 'the face-off still carries a bottom dismissal', fo?.bottomBtns);
  check(!fo?.gapLine, 'the points-between-you line is back on the face-off', fo);
  // the grabber, painted: a 40×4 bar, centred, standing ON the card's top edge
  check(fo?.grab?.bar?.w === 40 && fo?.grab?.bar?.h === 4,
        'the grabber bar is not the 40×4 the design measured', fo?.grab);
  check(fo?.grab?.centred === true, 'the grabber is not centred on the card', fo?.grab);
  check(fo?.grab?.fromTop != null && fo.grab.fromTop >= 0 && fo.grab.fromTop <= 14,
        'the grabber does not sit on the card\u2019s top edge', fo?.grab);
  /* CLEARANCE, AS A DISTANCE. This shipped passing by 0.00px \u2014 the wrapper's
     bottom edge and the avatars' top edge on the same pixel, held apart by a
     tolerance rather than by a gap. The number is asserted, and the number is
     reported, so the next change says how close it came instead of flipping. */
  check(fo?.grab?.clearBy != null && fo.grab.clearBy >= 3,
        'the grabber does not clear the card\u2019s content by a real distance', fo?.grab);
  /* THE TARGET A FINGER GETS. 76\u00d714 is under WCAG 2.5.8's 24\u00d724 floor and far
     under the 44px a thumb wants, and it replaced a 30\u00d730 control. The bar
     stays 40\u00d74 \u2014 an invisible expander does the work, the .rune idiom \u2014 so
     this can only be read by asking the screen who answers there. */
  check(fo?.grab?.tap?.h >= 44 && fo?.grab?.tap?.w >= 44,
        'the grabber\u2019s real tap target is smaller than 44px \u2014 the drawn bar is all there is',
        fo?.grab);
  check(fo?.grab?.avatar === 46, 'the grabber cost the face-off its 46px avatars', fo?.grab);
  /* IT CAME UP FROM THE BOTTOM, and the wash came up with it. One custom
     property drives both, so a card that arrived over a wash already at full
     weight means the two have been split apart again. */
  check(fo?.arrive?.first != null && fo.arrive.first - fo.arrive.last > 200,
        'the face-off did not slide in from the bottom — it simply appeared', fo?.arrive);
  check(fo?.arrive?.rose === true, 'the face-off\u2019s arrival did not travel upward', fo?.arrive);
  check(fo?.arrive?.washFirst < fo?.arrive?.washLast - 0.1,
        'the backdrop wash did not fade in with the card', fo?.arrive);
  // the tightest phone: 320px wide, so a 292px card — the grabber costs it nothing
  check(fo?.narrow?.card === 292, 'the face-off card is not 292px on a 320px screen', fo?.narrow);
  check(fo?.narrow?.avatar === 46 && fo?.narrow?.centred === true && fo?.narrow?.clearBy >= 3
        && fo?.narrow?.tap?.h >= 44,
        'the grabber crowds the card on the narrowest phone', fo?.narrow);
  /* THE DRAG. Held at 48px the card is 48px lower and the wash is thinner;
     released short of the 96px line it springs home and nothing happened. */
  check(fo?.held?.top != null && Math.abs(fo.held.top - (fo.rest + 48)) <= 6,
        'the card does not follow the finger', { held: fo?.held, rest: fo?.rest });
  check(fo?.held?.wash < 0.6, 'the wash does not lighten as the card travels', fo?.held);
  check(fo?.sprung?.alive === true && Math.abs(fo.sprung.top - fo.rest) <= 2,
        'a drag short of the commit line did not spring the card home', fo?.sprung);
  // every other door, still one implementation: backdrop, gesture, keyboard
  /* the finger's pair: it springs home, and the very next tap on the wash is
     answered. A swallow that outlives its gesture fails the second half. */
  check(fo?.touchSprung?.alive === true,
        'a 48px TOUCH drag dismissed the card instead of springing it home', fo?.touchSprung);
  check(fo?.touchBackdropClosed === true,
        'AFTER A TOUCH SPRING-BACK THE BACKDROP TAP WAS EATEN — the card ignored the way out', fo?.touchSprung);
  check(fo?.backdropClosed === true, 'a tap on the backdrop no longer closes the face-off', fo);
  check(fo?.dragClosed === true, 'a drag past the commit line did not dismiss the face-off', fo);
  check(fo?.flickClosed === true,
        'a fast flick short of the line did not dismiss — the velocity rule is gone', fo);
  check(fo?.escClosed === true, 'Escape no longer closes the face-off', fo);
  /* THE DEPARTING SHEET. While it rests it takes the tap that lands on it —
     that is the control here — and from the first frame of the exit flight it
     takes none, because for most of that flight there is nothing to see and
     the ladder underneath is what the finger was aiming at. */
  check(fo?.exit?.rested > 0 && fo?.exit?.restedHit === fo?.exit?.rested,
        'the resting face-off does not take the tap that lands on it', fo?.exit);
  /* One sampled moved frame is sufficient evidence here: pointer-events is
     disabled synchronously when the exit begins. Requiring two made the
     observable contract depend on how many rAF callbacks a busy CI renderer
     scheduled during the short 180ms flight. */
  check(fo?.exit?.leaving >= 1 && fo?.exit?.leavingHit === 0,
        'the departing face-off still eats taps while it flies out', fo?.exit);
  /* and the one the gesture cost: with no ✕ there must still be something a
     screen reader announces and a keyboard can press */
  check(fo?.grab?.tag === 'BUTTON' && fo?.grab?.label === 'Close' && fo?.grab?.focusable === true,
        'the face-off has no announceable way out now that the ✕ is gone', fo?.grab);
  check(fo?.focused === true && fo?.keyClosed === true,
        'the grabber cannot be focused and pressed to close', fo);
  check(fo?.keyRoute?.firstRunVisible === false && fo?.keyRoute?.phase === 'menu',
        'closing the comparison with Enter also activated the game underneath', fo?.keyRoute);
  /* THE PLAIN TAP, which is the door most players will use and the one the
     keyboard path above cannot vouch for: the click must land ON the grabber
     — not on the card that captured the pointer out from under it — and the
     sheet must go. Both halves of the target are pushed: the drawn bar, and
     the invisible expander 2px below it. */
  check(fo?.tapTarget === 'fograb' && fo?.tapClosed === true,
        'a plain tap on the grabber does not dismiss the face-off',
        { landedOn: fo?.tapTarget, closed: fo?.tapClosed });
  check(fo?.expandTarget === 'fograb' && fo?.expandClosed === true,
        'a tap just under the drawn bar misses the grabber — its touch expander is gone',
        { landedOn: fo?.expandTarget, closed: fo?.expandClosed });

  /* 1b-ii · THE SAME SHEET WITH MOTION REDUCED. It still arrives and it still
     leaves — it just does not travel to do either, so a player who asked the
     OS for stillness is not handed a 340px flight and a 180ms exit. */
  const still = await visit({ door: 'board', motion: 'reduce' });
  const sfo = still.faceoff;
  check(sfo?.visible === true, 'the face-off does not arrive at all with motion reduced', sfo);
  /* ±2px, because the streak cell swaps a loading die for a digit and a
     centred card settles by a pixel when it does — the FLIGHT is 932px */
  check(sfo?.arrive != null && Math.abs(sfo.arrive.first - sfo.arrive.last) <= 2
        && sfo.arrive.washFirst === sfo.arrive.washLast,
        'the face-off still flies in with motion reduced', sfo?.arrive);
  check(sfo?.dragTrack?.length === 6
        && sfo.dragTrack.every((sample) => Math.abs(sample.actual - sample.distance) <= 1
          && sample.transition === '0s'),
        'reduced motion made the directly dragged sheet chase or flicker behind the finger', sfo?.dragTrack);
  check(sfo?.dragSprung?.alive === true && Math.abs(sfo.dragSprung.top) <= 2,
        'the reduced-motion sheet did not settle after a short direct drag', sfo?.dragSprung);
  check(sfo?.escInstant === true,
        'the face-off still flies OUT with motion reduced', sfo);
  check(still.errs.length === 0, 'page errors with motion reduced', still.errs);
  check(board.errs.length === 0, 'page errors on the ladder', board.errs);
}
