async function probeIdentityOfferOrder(page) {
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => {
    const bounds = (selector) => {
      const element = document.querySelector(selector);
      if (!element || !element.getClientRects().length) return null;
      const box = element.getBoundingClientRect();
      return { top: +box.top.toFixed(2), bottom: +box.bottom.toFixed(2) };
    };
    return {
      facts: bounds('#onAccount .facts'),
      claim: bounds('#accClaim'),
      guest: bounds('#accGuest'),
      history: bounds('#btnHistory'),
      recent: [...document.querySelectorAll('#accRecent .history-row')]
        .map((row) => {
          const box = row.getBoundingClientRect();
          return { top: +box.top.toFixed(2), bottom: +box.bottom.toFixed(2) };
        }),
    };
  });
}

const precedes = (first, second) => !!first && !!second && first.bottom <= second.top;

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

export async function runAccountLifecycleScenarios(suite) {
  const { visit, out, check } = suite;
  /* Both identity offers occupy one visible slot: directly after the three
     facts, before the history door and its three inline rows. Use a tall view
     so all three rows remain laid out and assert the pixels the player meets. */
  const offerRun = await visit({ skipStandardProbes: true,
    viewport: { width: 430, height: 1550 }, probe: probeIdentityOfferOrder });
  const offerOrder = offerRun.probeResult;
  out.accountIdentityOrder = offerOrder;
  check(offerOrder?.recent.length === 3
    && precedes(offerOrder.facts, offerOrder.claim)
    && precedes(offerOrder.claim, offerOrder.guest)
    && precedes(offerOrder.guest, offerOrder.history)
    && precedes(offerOrder.history, offerOrder.recent[0]),
  'profile identity offers do not lead Full match history and its three recent matches', offerOrder);

  // 1c · the named player: the claim is spent, the card is GONE — not
  // disabled, not re-offered. The headline is all that remains of the name UI.
  const namedRun = await visit({ named: true, probe: probeIdentityOfferOrder });
  out.named = { accName: namedRun.seen.accName, claim: namedRun.seen.claim,
    order: namedRun.probeResult };
  check(namedRun.seen.accName === 'TestGuest001', 'a named player lost their headline', namedRun.seen);
  check(namedRun.seen.claim === false, 'the claim card survives after the name is set', namedRun.seen);
  check(namedRun.probeResult?.claim === null
    && precedes(namedRun.probeResult?.facts, namedRun.probeResult?.guest)
    && precedes(namedRun.probeResult?.guest, namedRun.probeResult?.history),
  'a named guest moved the Guest card out of the pre-history identity slot', namedRun.probeResult);
  check(namedRun.askAbove === true,
        'the ask-card opened UNDER a later overlay — ask() lost its re-append', namedRun.askAbove);
  check(namedRun.errs.length === 0, 'page errors on the named path', namedRun.errs);

  /* Spare height pins account actions; constrained height keeps the pbody as
     the one scroller and makes those same actions reachable at its end. */
  const tallLayout = await visit({ named: true, skipStandardProbes: true,
    viewport: { width: 390, height: 932 }, probe: probeAccountFooter });
  const shortLayout = await visit({ named: true, skipStandardProbes: true,
    viewport: { width: 390, height: 568 }, probe: probeAccountFooter });
  out.accountFooter = { tall: tallLayout.probeResult, short: shortLayout.probeResult };
  const tall = tallLayout.probeResult;
  check(tall && !tall.before.scrollable && !tall.before.nestedScroller
    && Math.abs(tall.before.bottomError) <= 1
    && tall.before.signOutHit && tall.before.deleteHit,
  'account actions are not pinned to the usable bottom when the profile fits', tall);
  const short = shortLayout.probeResult;
  check(short?.before.scrollable && !short.before.nestedScroller
    && short.after.scrollTop > 0 && Math.abs(short.after.scrollTop - short.after.maxScroll) <= 1
    && Math.abs(short.after.bottomError) <= 1
    && short.after.signOutHit && short.after.deleteHit,
  'short profile does not scroll its footer into a reachable usable bottom', short);

  // 1d · the claim itself: confirm through the shared ask-card, the card
  // retires, the headline takes the name, and a GUEST is offered the way up
  const claimRun = await visit({ door: 'claim' });
  out.claim = claimRun.claimFlow;
  check(claimRun.claimFlow?.confirmHead === 'Play as NeonKing77?',
        'claiming does not ask the deliberate question', claimRun.claimFlow);
  check(claimRun.claimFlow?.head === 'Keep NeonKing77 forever?',
        'a guest claim did not offer the way up', claimRun.claimFlow);
  check(claimRun.claimFlow?.claimGone === true, 'the claim card survived its own success', claimRun.claimFlow);
  check(claimRun.claimFlow?.headline === 'NeonKing77', 'the headline did not take the claimed name', claimRun.claimFlow);
  check(claimRun.claimFlow?.authShown === true, 'Create account did not open the attach panel', claimRun.claimFlow);
  check(claimRun.claimFlow?.yesLoud === true,
        'the way-up offer does not wear primary on its yes', claimRun.claimFlow);
  check(claimRun.errs.length === 0, 'page errors on the claim flow', claimRun.errs);

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
}
