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

  /* The picker belongs to the Profile account that opened it. If the stored
     session becomes B before A answers the picker, the auth-owned RPC would
     mutate B even though its body carries no account id. Refuse before any
     request reaches that boundary. */
  const stalePicker = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward',
    probe: async (page, routes) => {
      await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
      await enterPicker(page);
      const before = await page.evaluate(() => ({
        owner: JSON.parse(localStorage.getItem(
          'knucklebones.online.account-profile') ?? 'null')?.accountId ?? null,
        runeOwner: JSON.parse(localStorage.getItem(
          'knucklebones.runes.v1') ?? 'null')?.accountId ?? null,
        choosing: document.getElementById('accRunes')?.classList.contains('choosing') === true,
      }));
      const writes = [];
      const recordWrite = (request) => {
        if (!isEquipmentWrite(request)) return;
        try { writes.push(request.postDataJSON()); } catch { writes.push(null); }
      };
      page.on('request', recordWrite);
      const accountB = '11111111-2222-4333-8444-555555555555';
      routes.setProfileAccountId(accountB);
      routes.setProfileNickname('AccountB');
      const switched = await page.evaluate((nextAccountId) => {
        const authKey = Object.keys(localStorage)
          .find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (!authKey) return false;
        const stored = JSON.parse(localStorage.getItem(authKey));
        const session = stored?.currentSession ?? stored;
        if (!session?.user) return false;
        session.user.id = nextAccountId;
        localStorage.setItem(authKey, JSON.stringify(stored));
        return true;
      }, accountB);
      await page.click('#accRuneGrid .accrune[data-rune="pilfer"]');
      await page.waitForFunction(() => document.getElementById('onLoading')?.hidden === false
        && document.getElementById('onAccount')?.hidden === true,
      null, { timeout: 10000 });
      await page.waitForTimeout(150);
      page.off('request', recordWrite);
      return page.evaluate(({ before, switched, writes }) => ({
        before,
        switched,
        writes,
        loaderVisible: document.getElementById('onLoading')?.hidden === false,
        profileHidden: document.getElementById('onAccount')?.hidden === true,
        pending: document.getElementById('onAccount')?.hasAttribute('data-account-pending'),
      }), { before, switched, writes });
    },
  });
  out.equippedSeatStalePicker = stalePicker.probeResult;
  const stale = stalePicker.probeResult;
  check(stale?.before?.owner === '00000000-0000-4000-8000-00000000beef'
      && stale.before.runeOwner === stale.before.owner && stale.before.choosing
      && stale.switched && stale.writes?.length === 0
      && stale.loaderVisible && stale.profileHidden && stale.pending,
  'an equipment picker opened by account A issued an auth-owned write after B took the session',
  stale);
  check(stalePicker.errs.length === 0,
    'page errors while refusing a stale equipment picker', stalePicker.errs);

  /* A write belongs to the account that opened the equipment door. Replace
     the stored session with B while A's RANDOM answer is held: its completion
     must cover A immediately, then let a fresh B Profile open cleanly. */
  const accountSwitch = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward',
    probe: async (page, routes) => {
      await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
      routes.deferNextEquipmentWrite();
      await page.click('#accSeat');
      await page.click('#accSeatRandom');
      const writeStarted = await signalWithin(routes.equipmentWriteStarted);
      if (!writeStarted) {
        routes.releaseEquipmentWrite();
        return { writeStarted };
      }
      const accountB = '11111111-2222-4333-8444-555555555555';
      routes.setProfileAccountId(accountB);
      routes.setProfileNickname('AccountB');
      routes.setRuneState(['pilfer'], 'pilfer');
      const switched = await page.evaluate((nextAccountId) => {
        const authKey = Object.keys(localStorage)
          .find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
        if (!authKey) return false;
        const stored = JSON.parse(localStorage.getItem(authKey));
        const session = stored?.currentSession ?? stored;
        if (!session?.user) return false;
        session.user.id = nextAccountId;
        localStorage.setItem(authKey, JSON.stringify(stored));
        localStorage.setItem('knucklebones.online.profile', JSON.stringify({
          accountId: nextAccountId,
          nickname: 'AccountB',
          rating: 777,
          avatar: 'die:2:mg',
          rank: 31,
          apex: false,
        }));
        const cached = JSON.parse(localStorage.getItem(
          'knucklebones.online.account-profile') ?? 'null');
        localStorage.setItem('knucklebones.online.account-profile', JSON.stringify({
          ...cached,
          accountId: nextAccountId,
          profile: { ...cached.profile, id: nextAccountId,
            nickname: 'AccountB', rating: 777, avatar: 'die:2:mg' },
          user: { ...cached.user, id: nextAccountId },
          runes: ['pilfer'],
          runeRows: [{ rune_id: 'pilfer', collected_at: '2026-08-22T00:00:00Z',
            source_match_id: null, seen_at: '2026-08-23T00:00:00Z' }],
          equipment: { kind: 'fixed', runeId: 'pilfer' },
        }));
        localStorage.setItem('knucklebones.runes.v1', JSON.stringify({
          version: 1,
          accountId: nextAccountId,
          verifiedAt: Date.now(),
          collected: ['pilfer'],
          poolTier: 'ivory',
          equippedRune: 'pilfer',
          randomRuneMode: false,
          equipment: { kind: 'fixed', runeId: 'pilfer' },
        }));
        return true;
      }, accountB);
      routes.releaseEquipmentWrite();
      const writeFinished = await signalWithin(routes.equipmentWriteFinished);
      await page.waitForFunction(() => document.getElementById('onLoading')?.hidden === false
        && document.getElementById('onAccount')?.hidden === true
        && document.getElementById('accName')?.textContent === '',
      null, { timeout: 5000 });
      const invalidated = await page.evaluate(() => ({
        loaderVisible: document.getElementById('onLoading')?.hidden === false,
        profileHidden: document.getElementById('onAccount')?.hidden === true,
        name: document.getElementById('accName')?.textContent,
        pending: document.getElementById('onAccount')?.hasAttribute('data-account-pending'),
      }));
      await page.click('#btnOnlineBack');
      await page.waitForSelector('#ovStart.on', { timeout: 5000 });
      await page.click('#homeChip');
      await page.waitForFunction(() => {
        const seat = document.getElementById('accSeat');
        return document.getElementById('onAccount')?.hidden === false
          && document.getElementById('accName')?.textContent?.trim() === 'AccountB'
          && /PILFER/i.test(seat?.getAttribute('aria-label') ?? '')
          && !document.getElementById('onAccount')?.hasAttribute('data-account-pending');
      }, null, { timeout: 10000 });
      await page.waitForFunction(() => {
        const seat = document.getElementById('accSeat');
        return !seat?.disabled && !seat?.hasAttribute('aria-busy');
      }, null, { timeout: 5000 });
      const afterCache = await page.evaluate(() => {
        const full = JSON.parse(localStorage.getItem(
          'knucklebones.online.account-profile') ?? 'null');
        const runes = JSON.parse(localStorage.getItem('knucklebones.runes.v1') ?? 'null');
        return {
          name: document.getElementById('accName')?.textContent?.trim(),
          full: full ? { accountId: full.accountId, equipment: full.equipment } : null,
          runes: runes ? { accountId: runes.accountId, equipment: runes.equipment } : null,
        };
      });
      const afterRelease = {
        ...afterCache,
        seat: await page.evaluate(measureEquippedSeat),
      };
      return { writeStarted, writeFinished, switched, invalidated, afterRelease };
    },
  });
  out.equippedSeatAccountSwitch = accountSwitch.probeResult;
  const switchedEquipment = accountSwitch.probeResult;
  check(switchedEquipment?.writeStarted && switchedEquipment.writeFinished
      && switchedEquipment.switched
      && switchedEquipment.invalidated?.loaderVisible
      && switchedEquipment.invalidated.profileHidden
      && switchedEquipment.invalidated.name === ''
      && switchedEquipment.invalidated.pending,
  'account switch during A equipment persistence left A Profile mounted', switchedEquipment);
  check(switchedEquipment?.afterRelease?.name === 'AccountB'
      && /PILFER/i.test(switchedEquipment.afterRelease.seat?.label ?? '')
      && !switchedEquipment.afterRelease.seat?.random
      && switchedEquipment.afterRelease.full?.accountId
      === '11111111-2222-4333-8444-555555555555'
      && switchedEquipment.afterRelease.full.equipment?.kind === 'fixed'
      && switchedEquipment.afterRelease.full.equipment.runeId === 'pilfer'
      && switchedEquipment.afterRelease.runes?.accountId
      === '11111111-2222-4333-8444-555555555555'
      && switchedEquipment.afterRelease.runes.equipment?.kind === 'fixed'
      && switchedEquipment.afterRelease.runes.equipment.runeId === 'pilfer',
  'late A equipment selection repainted or cached into B', switchedEquipment);
  check(accountSwitch.errs.length === 0,
    'page errors during deferred equipment account switch', accountSwitch.errs);

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
