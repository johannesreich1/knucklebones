async function probeIdentityOfferOrder(page) {
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = await page.evaluate(() => {
    const bounds = (selector) => {
      const element = document.querySelector(selector);
      if (!element || !element.getClientRects().length) return null;
      const box = element.getBoundingClientRect();
      return { top: +box.top.toFixed(2), bottom: +box.bottom.toFixed(2),
               height: +box.height.toFixed(2) };
    };
    return {
      facts: bounds('#onAccount .facts'),
      claim: bounds('#accClaim'),
      guest: bounds('#accGuest'),
      duels: bounds('#accRecentTitle'),
      history: bounds('#btnHistory'),
      recent: [...document.querySelectorAll('#accRecent .history-row')]
        .map((row) => {
          const box = row.getBoundingClientRect();
          return { top: +box.top.toFixed(2), bottom: +box.bottom.toFixed(2),
                   height: +box.height.toFixed(2),
                   opponent: row.querySelector('.nm')?.textContent ?? '' };
        }),
    };
  });
  await page.locator('#btnHistory').scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const hitArea = await page.evaluate(() => {
    const history = document.getElementById('btnHistory');
    if (!history) return null;
    const box = history.getBoundingClientRect();
    const ownsPoint = (y) => {
      const target = document.elementFromPoint(box.left + box.width / 2, y);
      return target === history || (!!target && history.contains(target));
    };
    let top = box.top;
    let bottom = box.bottom;
    for (let y = box.top - .5; y >= box.top - 10; y -= .5) {
      if (!ownsPoint(y)) break;
      top = y;
    }
    for (let y = box.bottom + .5; y <= box.bottom + 10; y += .5) {
      if (!ownsPoint(y)) break;
      bottom = y;
    }
    return {
      effectiveHitHeight: +(bottom - top).toFixed(2),
      hitAbove: ownsPoint(box.top - 2),
      hitBelow: ownsPoint(box.bottom + 2),
    };
  });
  return { ...geometry,
    history: geometry.history && hitArea ? { ...geometry.history, ...hitArea } : geometry.history };
}

const precedes = (first, second) => !!first && !!second && first.bottom <= second.top;
/* The stub's three newest matches, in the order the RPC answers them
   (finished_at desc): the strip claims the LATEST duel is the top row, so the
   probe reads the names rather than trusting the array it was handed. */
const NEWEST_FIRST = ['NovaComet992', 'ZestyPixel950', 'BoldRaven393'];
const dealsNewestFirst = (order) =>
  order?.recent.map((row) => row.opponent).join() === NEWEST_FIRST.join();
const hasUnifiedHistoryGeometry = (order) => {
  if (!order?.history || order.recent?.length !== 3) return false;
  const rowGap = order.recent[1].top - order.recent[0].bottom;
  const historyGap = order.history.top - order.recent[2].bottom;
  return order.recent.every((row) => Math.abs(row.height - order.history.height) <= .5)
    && Math.abs(historyGap - rowGap) <= .5
    && order.history.effectiveHitHeight >= 44
    && order.history.hitAbove
    && order.history.hitBelow;
};

async function probeAccountFooter(page) {
  /* Exercise the member cut from the shared guest fixture: the backend/session
     contract is covered elsewhere; this probe owns only responsive geometry. */
  await page.evaluate(() => {
    document.getElementById('accClaim').hidden = true;
    document.getElementById('accGuest').hidden = true;
    document.getElementById('btnSignOut').hidden = false;
  });
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const sample = () => page.evaluate(() => {
    const body = document.querySelector('#ovOnline .pbody');
    const account = document.getElementById('onAccount');
    const foot = account.querySelector('.accfoot');
    const bodyBox = body.getBoundingClientRect();
    const footBox = foot.getBoundingClientRect();
    const paddingBottom = parseFloat(getComputedStyle(body).paddingBottom);
    const usableBottom = bodyBox.bottom - paddingBottom;
    const hit = (element) => {
      const box = element.getBoundingClientRect();
      const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return box.width >= 44 && box.height > 0 && !!target && element.contains(target);
    };
    return {
      scrollable: body.scrollHeight > body.clientHeight + .5,
      nestedScroller: account.scrollHeight > account.clientHeight + .5,
      scrollTop: body.scrollTop,
      maxScroll: body.scrollHeight - body.clientHeight,
      usableBottom,
      footTop: footBox.top,
      footBottom: footBox.bottom,
      bottomError: +(footBox.bottom - usableBottom).toFixed(2),
      signOutHit: hit(document.getElementById('btnSignOut')),
      deleteHit: hit(document.getElementById('btnDeleteAcc')),
    };
  });
  const before = await sample();
  await page.evaluate(() => {
    const body = document.querySelector('#ovOnline .pbody');
    body.scrollTop = body.scrollHeight;
  });
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return { before, after: await sample() };
}

async function probeAvatarMutation(page, routes) {
  await page.click('#btnAvatar');
  await page.waitForSelector('#onAvatar:not([hidden])', { timeout: 5000 });
  /* faces only: the hue is "your colour" from Settings (cyan in this fixture) */
  await page.click('#avFaces button[data-face="2"]');
  routes.failNextAccountProfileResponse();
  await page.click('#btnAvatarSave');
  await page.waitForFunction(() => {
    const account = document.getElementById('onAccount');
    return account && !account.hidden && !account.hasAttribute('data-account-pending')
      && account.querySelector('#accDie .die')?.getAttribute('data-v') === '2';
  }, null, { timeout: 15000 });
  return page.evaluate(() => {
    const die = document.querySelector('#accDie .die');
    return {
      face: die?.getAttribute('data-v'),
      hue: die ? getComputedStyle(die).getPropertyValue('--dc').trim() : null,
      cached: JSON.parse(localStorage.getItem(
        'knucklebones.online.account-profile') ?? 'null'),
    };
  });
}

export async function runAccountLifecycleScenarios(suite) {
  const { visit, out, check } = suite;
  /* Both identity offers occupy one visible slot: directly after the three
     facts, and PAST DUELS follows them with the door it summarises beneath it.
     Use a tall view so nothing about the reading depends on the fold. */
  const offerRun = await visit({ skipStandardProbes: true,
    viewport: { width: 430, height: 1550 }, probe: probeIdentityOfferOrder });
  const offerOrder = offerRun.probeResult;
  out.accountIdentityOrder = offerOrder;
  check(offerOrder?.recent.length === 3
    && dealsNewestFirst(offerOrder)
    && precedes(offerOrder.facts, offerOrder.claim)
    && precedes(offerOrder.claim, offerOrder.guest)
    && precedes(offerOrder.guest, offerOrder.duels)
    && precedes(offerOrder.duels, offerOrder.recent[0])
    && precedes(offerOrder.recent[2], offerOrder.history),
  'profile identity offers, PAST DUELS and the history door are out of order', offerOrder);
  check(hasUnifiedHistoryGeometry(offerOrder),
    'the full-history door did not match the duel row height and gap with a larger invisible hit area',
    offerOrder);

  /* THREE ON EVERY DEVICE (user call 2026-08-28). The strip used to be trimmed
     row by row against the page, so the shortest phone in the suite is exactly
     where it lost rows — and the only place that proves the trim is gone. */
  const shortDuels = await visit({ named: true, skipStandardProbes: true,
    viewport: { width: 390, height: 568 }, probe: probeIdentityOfferOrder });
  out.accountShortDuels = shortDuels.probeResult;
  check(shortDuels.probeResult?.recent.length === 3
    && dealsNewestFirst(shortDuels.probeResult)
    && precedes(shortDuels.probeResult.duels, shortDuels.probeResult.recent[0]),
  'a short device is served fewer than the three newest duels', shortDuels.probeResult);
  check(hasUnifiedHistoryGeometry(shortDuels.probeResult),
    'the compact profile history door lost the shared row geometry or invisible hit area',
    shortDuels.probeResult);

  // 1c · the named player: the claim is spent, the card is GONE — not
  // disabled, not re-offered. The headline is all that remains of the name UI.
  const namedRun = await visit({ named: true, probe: probeIdentityOfferOrder });
  out.named = { accName: namedRun.seen.accName, claim: namedRun.seen.claim,
    order: namedRun.probeResult };
  check(namedRun.seen.accName === 'TestGuest001', 'a named player lost their headline', namedRun.seen);
  check(namedRun.seen.claim === false, 'the claim card survives after the name is set', namedRun.seen);
  check(namedRun.probeResult?.claim === null
    && precedes(namedRun.probeResult?.facts, namedRun.probeResult?.guest)
    && precedes(namedRun.probeResult?.guest, namedRun.probeResult?.duels),
  'a named guest moved the Guest card out of the pre-history identity slot', namedRun.probeResult);
  check(namedRun.askAbove === true,
        'the shared ask sheet opened UNDER a later overlay', namedRun.askAbove);
  check(namedRun.errs.length === 0, 'page errors on the named path', namedRun.errs);

  /* Spare height pins account actions; a device the profile outgrows keeps the
     pbody as the ONE scroller and carries those same actions into reach at its
     end. Since PAST DUELS deals its third row on every device, the profile is
     31px taller than a 390x932 phone can hold (measured), so the pin is
     asserted where there is genuinely room to pin against — a tablet in
     portrait — and both phone shapes assert the scroll. */
  const roomyLayout = await visit({ named: true, skipStandardProbes: true,
    viewport: { width: 820, height: 1180 }, probe: probeAccountFooter });
  const phoneLayouts = [];
  for (const viewport of [{ width: 390, height: 932 }, { width: 390, height: 568 }]) {
    const run = await visit({ named: true, skipStandardProbes: true,
      viewport, probe: probeAccountFooter });
    phoneLayouts.push({ viewport, ...run.probeResult });
  }
  out.accountFooter = { roomy: roomyLayout.probeResult, phones: phoneLayouts };
  const roomy = roomyLayout.probeResult;
  check(roomy && !roomy.before.scrollable && !roomy.before.nestedScroller
    && Math.abs(roomy.before.bottomError) <= 1
    && roomy.before.signOutHit && roomy.before.deleteHit,
  'account actions are not pinned to the usable bottom when the profile fits', roomy);
  for (const phone of phoneLayouts) {
    check(phone.before?.scrollable && !phone.before.nestedScroller
      && phone.after.scrollTop > 0
      && Math.abs(phone.after.scrollTop - phone.after.maxScroll) <= 1
      && Math.abs(phone.after.bottomError) <= 1
      && phone.after.signOutHit && phone.after.deleteHit,
    'a profile taller than the phone does not scroll its footer into reach', phone);
  }

  // 1d · the claim itself: confirm through the shared ask-card, the card
  // retires, the headline takes the name, and a GUEST is offered the way up
  const claimRun = await visit({ door: 'claim' });
  out.claim = claimRun.claimFlow;
  check(claimRun.claimFlow?.confirmHead === 'Play as NeonKing77?',
        'claiming does not ask the deliberate question', claimRun.claimFlow);
  check(claimRun.claimFlow?.cancelFocus === 'btnClaim',
        'a touch-opened claim question did not restore its semantic opener', claimRun.claimFlow);
  check(claimRun.claimFlow?.head === 'Keep NeonKing77 forever?',
        'a guest claim did not offer the way up', claimRun.claimFlow);
  check(claimRun.claimFlow?.claimGone === true, 'the claim card survived its own success', claimRun.claimFlow);
  check(claimRun.claimFlow?.headline === 'NeonKing77', 'the headline did not take the claimed name', claimRun.claimFlow);
  check(claimRun.claimFlow?.authShown === true, 'Create account did not open the attach panel', claimRun.claimFlow);
  check(claimRun.claimFlow?.yesLoud === true,
        'the way-up offer does not wear primary on its yes', claimRun.claimFlow);
  check(claimRun.errs.length === 0, 'page errors on the claim flow', claimRun.errs);

  const avatarRun = await visit({ skipStandardProbes: true,
    returnAfterProbe: true, probe: probeAvatarMutation });
  out.avatarRefreshFailure = avatarRun.probeResult;
  check(avatarRun.probeResult?.face === '2' && avatarRun.probeResult.hue === '#28e8ff'
      && avatarRun.probeResult.cached?.profile?.avatar === 'die:2:cy',
  'a successful avatar change was lost when its immediate Profile refresh failed',
  avatarRun.probeResult);
  check(avatarRun.errs.length === 0,
    'page errors while retaining an avatar across a failed refresh', avatarRun.errs);

  // 2 · the project with anonymous sign-ins off: degrade to the old panel
  const off = await visit({ anonymous: 422 });
  out.providerOff = off.seen;
  check(off.seen.panel === 'auth', 'no fallback when guests are unavailable', off.seen);
  check(off.seen.actions.join() === 'Sign in', 'the fallback lost its sign-in', off.seen);
  check(off.seen.swapDoor === 'Create account', 'the fallback offers no way to make an account', off.seen);
  check(off.errs.length === 0, 'page errors when guests are refused', off.errs);

  // 3 · the returning player: signing out must not mint a guest over them
  const back = await visit({ attached: true });
  out.afterSignOut = back.seen;
  check(back.seen.panel === 'auth', 'a signed-out player was re-minted as a guest', back.seen);
  check(back.signupCalls === 0, 'a guest was minted for a device that had a real account', back.signupCalls);

  /* 4 · ...AND THERE IS STILL A WAY BACK IN. Refusing to mint a guest over a
     returning player is right; leaving them with no other door is the trap it
     became. `attached` is written once and never cleared inside the app
     (account deletion clears it only after deleteAccount, which needs the session the
     player no longer has), so a player who signs out of a provider that cannot
     currently sign them back in met the same sheet on every ranked tap, for
     good. Reported 2026-08-30: "I logged out of my apple account and it's
     impossible for me to play an anonymous game with a fresh account."
     The door is offered ONLY here — a device that never held an account still
     gets its silent guest, and must not be asked a question about losing one. */
  const stranded = await visit({
    attached: true,
    probe: (page) => page.evaluate(() => {
      const door = document.getElementById('btnAuthGuest');
      const box = door?.getBoundingClientRect();
      return {
        offered: !!door && !door.hidden && !!box && box.height > 0,
        label: (door?.textContent ?? '').trim(),
      };
    }),
  });
  out.strandedDoor = stranded.probeResult;
  check(!!stranded.probeResult?.offered,
    'A DEVICE THAT SIGNED OUT HAS NO WAY BACK INTO RANKED — the guest path is '
    + 'off for it and the sheet offers only a sign-in it cannot complete',
    stranded.probeResult);
  check(!!stranded.probeResult?.label,
    'the way back in is unlabelled', stranded.probeResult);

  const newcomer = await visit({
    probe: (page) => page.evaluate(() => {
      const door = document.getElementById('btnAuthGuest');
      return { offered: !!door && !door.hidden };
    }),
  });
  out.newcomerDoor = newcomer.probeResult;
  check(newcomer.probeResult?.offered === false,
    'a device that never held an account was offered a way to abandon one',
    newcomer.probeResult);
}
