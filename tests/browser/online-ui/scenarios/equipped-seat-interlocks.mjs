import {
  dispatchEdgeSwipe,
  measureEquippedSeat,
  measureRunePickerState,
} from '../harness/equipped-seat-probes.mjs';

const isEquipmentWrite = (request) => request.method() === 'POST'
  && request.url().includes('/rest/v1/rpc/set_rune_equipment');

const enterPicker = async (page) => {
  await page.click('#accSeat');
  await page.waitForSelector('.faceoff .focard', { timeout: 5000 });
  await page.click('#accSeatEquip');
  await page.waitForFunction(() => document.getElementById('accRunes')
    ?.classList.contains('choosing') === true, null, { timeout: 5000 });
};

const waitForPickerCleanup = (page) => page.waitForFunction(() =>
  !document.getElementById('accRunes')?.classList.contains('choosing')
    && document.activeElement?.id === 'accSeat', null, { timeout: 1500 });

const signalWithin = (signal, ms = 5000) => new Promise((resolve) => {
  const timeout = setTimeout(() => resolve(false), ms);
  void signal.then(() => {
    clearTimeout(timeout);
    resolve(true);
  });
});

export async function runEquippedSeatInterlockScenarios({ visit, out, check }) {
  const collected = ['fate', 'ward', 'pilfer'];

  /* Persistence is deliberately stopped after the server receives RANDOM.
     The seat must remain one unavailable door until that answer is confirmed;
     even a synthetic pointer pair must not launch another choice or request. */
  const serialized = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward',
    probe: async (page, routes) => {
      await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
      const writes = [];
      const recordWrite = (request) => {
        if (!isEquipmentWrite(request)) return;
        try { writes.push(request.postDataJSON()); } catch { writes.push(null); }
      };
      page.on('request', recordWrite);
      routes.deferNextEquipmentWrite();
      await page.click('#accSeat');
      await page.click('#accSeatRandom');
      const writeStarted = await signalWithin(routes.equipmentWriteStarted);
      if (!writeStarted) {
        /* Resolve the route latch even on a diagnostic failure. A request that
           arrives during page teardown must not enter the deferral and hang. */
        routes.releaseEquipmentWrite();
        const writeFinished = await signalWithin(routes.equipmentWriteFinished, 500);
        page.off('request', recordWrite);
        return {
          writeStarted,
          writeFinished,
          writes,
          pending: await page.evaluate(measureRunePickerState),
        };
      }
      const pending = await page.evaluate(measureRunePickerState);
      await page.evaluate(() => {
        const seat = document.getElementById('accSeat');
        const box = seat.getBoundingClientRect();
        const init = {
          bubbles: true,
          clientX: box.x + box.width / 2,
          clientY: box.y + box.height / 2,
          pointerId: 71,
          pointerType: 'touch',
          isPrimary: true,
        };
        seat.dispatchEvent(new PointerEvent('pointerdown', init));
        seat.dispatchEvent(new PointerEvent('pointerup', init));
      });
      await page.waitForTimeout(80);
      const attemptedWhilePending = {
        state: await page.evaluate(measureRunePickerState),
        writeCount: writes.length,
      };
      routes.releaseEquipmentWrite();
      const writeFinished = await signalWithin(routes.equipmentWriteFinished);
      if (!writeFinished) {
        page.off('request', recordWrite);
        return { writeStarted, writeFinished, pending, attemptedWhilePending, writes };
      }
      await page.waitForFunction(() => {
        const seat = document.getElementById('accSeat');
        return seat?.classList.contains('random') && !seat.disabled;
      }, null, { timeout: 5000 });
      const afterFirst = {
        state: await page.evaluate(measureRunePickerState),
        seat: await page.evaluate(measureEquippedSeat),
      };
      await enterPicker(page);
      await page.click('#accRuneGrid .accrune[data-rune="pilfer"]');
      await page.waitForFunction(() => {
        const seat = document.getElementById('accSeat');
        return !seat?.disabled && /PILFER/i.test(seat?.getAttribute('aria-label') ?? '');
      }, null, { timeout: 5000 });
      page.off('request', recordWrite);
      return {
        writeStarted,
        writeFinished,
        pending,
        attemptedWhilePending,
        afterFirst,
        afterSecond: await page.evaluate(measureEquippedSeat),
        writes,
      };
    },
  });
  out.equippedSeatSerializedWrites = serialized.probeResult;
  const serial = serialized.probeResult;
  check(!!serial && serial.writeStarted && serial.writeFinished && serial.pending.seatDisabled
      && serial.pending.seatBusy === 'true'
      && !serial.pending.sheet && !serial.pending.active,
    'the equipped seat remained interactive while its persistence answer was pending', serial);
  check(serial?.attemptedWhilePending?.writeCount === 1
      && serial.attemptedWhilePending.state.seatDisabled
      && !serial.attemptedWhilePending.state.sheet,
    'a second equipped-seat choice escaped while the first write was pending', serial);
  check(!!serial?.afterFirst?.seat.random
      && !serial.afterFirst.state.seatDisabled && serial.afterFirst.state.seatBusy === null
      && serial.afterSecond?.hasRune && !serial.afterSecond.random
      && /PILFER/i.test(serial.afterSecond.label),
    'the serialized RANDOM then FIXED choices did not repaint in confirmed order', serial);
  check(!!serial && JSON.stringify(serial.writes) === JSON.stringify([
    { p_equipped_rune: 'ward', p_random_rune_mode: true },
    { p_equipped_rune: 'pilfer', p_random_rune_mode: false },
  ]), 'equipment persistence did not emit exactly one ordered RPC per confirmed choice', serial);

  /* Picker mode owns the profile until it is explicitly answered. Cancel and
     Escape release every inert ancestor and restore the seat; an iOS edge
     swipe must not invoke the otherwise-valid Back control through inert. */
  const cleanup = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward',
    probe: async (page) => {
      await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
      const writes = [];
      const recordWrite = (request) => {
        if (!isEquipmentWrite(request)) return;
        try { writes.push(request.postDataJSON()); } catch { writes.push(null); }
      };
      page.on('request', recordWrite);

      await enterPicker(page);
      await page.click('#accRunePickCancel');
      await waitForPickerCleanup(page);
      const cancel = await page.evaluate(measureRunePickerState);

      await enterPicker(page);
      await page.keyboard.press('Escape');
      await waitForPickerCleanup(page);
      const escape = await page.evaluate(measureRunePickerState);

      await enterPicker(page);
      await page.evaluate(dispatchEdgeSwipe);
      await page.waitForTimeout(150);
      const edge = await page.evaluate(measureRunePickerState);
      if (edge.active && edge.profileVisible) {
        await page.click('#accRunePickCancel');
        await waitForPickerCleanup(page);
      }
      const afterEdgeCancel = await page.evaluate(measureRunePickerState);
      page.off('request', recordWrite);
      return { cancel, escape, edge, afterEdgeCancel, writes };
    },
  });
  out.equippedSeatPickerCleanup = cleanup.probeResult;
  const transient = cleanup.probeResult;
  const cleaned = (state) => !state.active && !state.anyOutsideInert
    && !state.sheet && state.profileVisible && state.focused === 'accSeat';
  check(!!transient && cleaned(transient.cancel),
    'picker Cancel did not release inert state and restore focus to the equipped seat', transient);
  check(!!transient && cleaned(transient.escape),
    'picker Escape did not release inert state and restore focus to the equipped seat', transient);
  check(!!transient && transient.edge.active && transient.edge.outsideInert
      && transient.edge.profileVisible && !transient.edge.sheet,
    'an iOS edge swipe escaped the rune picker through its inert Back control', transient);
  check(!!transient && cleaned(transient.afterEdgeCancel) && transient.writes.length === 0,
    'edge-swipe cleanup leaked modal state or persisted a choice', transient);
}
