async function beginTouchDrag(page, locator, distance, pointerId) {
  const box = await locator.boundingBox();
  if (!box) return null;
  const drag = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
    endY: Math.round(box.y + box.height / 2 + distance),
    pointerId,
  };
  await page.evaluate(async ({ x, y, endY, pointerId }) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const fire = (type, clientY) => document.elementFromPoint(x, Math.min(clientY, innerHeight - 1))
      ?.dispatchEvent(new PointerEvent(type, {
        pointerId, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY, button: 0, buttons: type === 'pointerup' ? 0 : 1,
        bubbles: true, cancelable: true,
      }));
    fire('pointerdown', y);
    for (let step = 1; step <= 8; step++) {
      await wait(30);
      fire('pointermove', y + ((endY - y) * step) / 8);
    }
  }, drag);
  return drag;
}

async function endTouchDrag(page, drag) {
  if (!drag) return;
  await page.evaluate(({ x, endY, pointerId }) => {
    document.elementFromPoint(x, Math.min(endY, innerHeight - 1))
      ?.dispatchEvent(new PointerEvent('pointerup', {
        pointerId, pointerType: 'touch', isPrimary: true,
        clientX: x, clientY: endY, button: 0, buttons: 0,
        bubbles: true, cancelable: true,
      }));
  }, drag);
}

async function probeSessionlessModal(page) {
  await page.waitForSelector('.authsheet .focard');
  await page.fill('#onEmail', 'player@example.test');
  await page.fill('#onPass', 'unchanged-secret');
  const before = await page.evaluate(() => ({
    title: document.getElementById('onAuthTitle')?.textContent,
    placeholderPrivacyDoors: document.querySelectorAll('#onAuth [data-legal-open="privacy"]').length,
    homeOn: document.getElementById('ovStart')?.classList.contains('on'),
    homeInert: document.getElementById('ovStart')?.inert,
    onlineOn: document.getElementById('ovOnline')?.classList.contains('on'),
    modal: document.querySelector('.authsheet .focard')?.getAttribute('aria-modal'),
  }));

  await page.click('#btnAuthSwap');
  const swapped = await page.evaluate(() => ({
    title: document.getElementById('onAuthTitle')?.textContent,
    action: document.querySelector('#onAuthActs .btn')?.textContent,
    email: document.getElementById('onEmail')?.value,
    password: document.getElementById('onPass')?.value,
  }));

  await page.click('#btnAuthPrivacy');
  await page.waitForSelector('#ovPrivacy.on');
  const nested = await page.evaluate(() => {
    const overlay = document.getElementById('ovPrivacy');
    const rect = overlay.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(150, rect.height / 2));
    return {
      legalTopmost: !!hit && overlay.contains(hit),
      authInert: document.querySelector('.authsheet')?.inert,
      email: document.getElementById('onEmail')?.value,
      password: document.getElementById('onPass')?.value,
      title: document.getElementById('onAuthTitle')?.textContent,
    };
  });

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('ovPrivacy').classList.contains('on'));
  await page.waitForTimeout(30);
  const afterPrivacy = await page.evaluate(() => ({
    authOpen: !!document.querySelector('.authsheet:not(.foout)'),
    focused: document.activeElement?.id,
    homeInert: document.getElementById('ovStart')?.inert,
    email: document.getElementById('onEmail')?.value,
    password: document.getElementById('onPass')?.value,
    title: document.getElementById('onAuthTitle')?.textContent,
  }));

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  await page.waitForTimeout(30);
  const dismissed = await page.evaluate(() => ({
    homeOn: document.getElementById('ovStart')?.classList.contains('on'),
    homeInert: document.getElementById('ovStart')?.inert,
    authRestored: document.getElementById('onAuth')?.parentElement?.classList.contains('pbody'),
    authHidden: document.getElementById('onAuth')?.hidden,
    focused: document.activeElement?.id,
  }));
  return { before, swapped, nested, afterPrivacy, dismissed };
}

async function probeAccountOrigin(page) {
  await page.click('#btnHaveAcc');
  await page.waitForSelector('.authsheet .focard');
  const opened = await page.evaluate(() => ({
    accountVisible: document.getElementById('onAccount')?.hidden === false,
    onlineOn: document.getElementById('ovOnline')?.classList.contains('on'),
    onlineInert: document.getElementById('ovOnline')?.inert,
    panelInSheet: !!document.querySelector('.authsheet #onAuth'),
  }));

  /* The exit deliberately passes input through immediately. Reopen in that
     190ms window and prove the dying sheet cannot remove the new request. */
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.getElementById('btnHaveAcc').click());
  await page.waitForTimeout(240);
  const reopened = await page.evaluate(() => ({
    sheets: document.querySelectorAll('.authsheet').length,
    live: !!document.querySelector('.authsheet:not(.foout) #onAuth'),
    accountVisible: document.getElementById('onAccount')?.hidden === false,
    onlineInert: document.getElementById('ovOnline')?.inert,
  }));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  await page.waitForTimeout(30);
  const closed = await page.evaluate(() => ({
    accountVisible: document.getElementById('onAccount')?.hidden === false,
    onlineOn: document.getElementById('ovOnline')?.classList.contains('on'),
    onlineInert: document.getElementById('ovOnline')?.inert,
    focused: document.activeElement?.id,
  }));
  return { opened, reopened, closed };
}

async function probeShortModal(page) {
  await page.waitForSelector('.authsheet .focard');
  const grabber = page.locator('.authsheet .fograb');
  const box = await grabber.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 20, { steps: 3 });
    await page.waitForTimeout(100);
    await page.mouse.up();
  }
  await page.waitForTimeout(260);
  const afterShortDrag = !!(await page.$('.authsheet:not(.foout)'));
  const geometry = await page.evaluate(() => {
    const card = document.querySelector('.authsheet .focard');
    const panel = document.getElementById('onAuth');
    const grab = document.querySelector('.authsheet .fograb');
    if (!card || !panel || !grab) return { missing: true };
    const cardBox = card.getBoundingClientRect();
    panel.scrollTop = panel.scrollHeight;
    const privacy = document.getElementById('btnAuthPrivacy');
    const privacyBox = privacy.getBoundingClientRect();
    const grabBox = grab.getBoundingClientRect();
    const hit = document.elementFromPoint(
      privacyBox.left + privacyBox.width / 2,
      privacyBox.top + privacyBox.height / 2,
    );
    return {
      cardInViewport: cardBox.top >= -1 && cardBox.bottom <= innerHeight + 1,
      internalScroll: panel.scrollHeight > panel.clientHeight + 1,
      overflowMode: card.parentElement?.classList.contains('fooverflow'),
      finalReachable: privacyBox.top >= cardBox.top && privacyBox.bottom <= cardBox.bottom
        && !!hit && privacy.contains(hit),
      fullWidthHandle: grabBox.width >= cardBox.width - 36,
      cardTouch: getComputedStyle(card).touchAction,
      panelTouch: getComputedStyle(panel).touchAction,
      grabTouch: getComputedStyle(grab).touchAction,
    };
  });
  const handleDrag = await beginTouchDrag(page, grabber, 120, 31);
  await endTouchDrag(page, handleDrag);
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  const handleDismissed = await page.evaluate(() => !document.getElementById('ovStart')?.inert);
  return { afterShortDrag, geometry, handleDismissed };
}

async function probeCardDrag(page) {
  await page.waitForSelector('.authsheet .focard');
  await page.waitForTimeout(380);
  const title = page.locator('#onAuthTitle');
  const first = await title.boundingBox();
  if (!first) return { missing: true };
  const shortDrag = await beginTouchDrag(page, title, 48, 32);
  const held = await page.evaluate(() => ({
    dy: Number.parseFloat(document.querySelector('.authsheet')?.style.getPropertyValue('--fo-dy') || '0'),
    cardDragMode: document.querySelector('.authsheet')?.classList.contains('focarddrag'),
    overflowMode: document.querySelector('.authsheet')?.classList.contains('fooverflow'),
  }));
  /* A held partial pull springs home; without this pause it is intentionally a
     fast flick and the shared sheet correctly commits the dismissal. */
  await page.waitForTimeout(100);
  await endTouchDrag(page, shortDrag);
  await page.waitForTimeout(260);
  const sprung = await page.evaluate(() => ({
    open: !!document.querySelector('.authsheet:not(.foout)'),
    dy: Number.parseFloat(document.querySelector('.authsheet')?.style.getPropertyValue('--fo-dy') || '0'),
  }));

  const second = await title.boundingBox();
  if (second) {
    const longDrag = await beginTouchDrag(page, title, 124, 33);
    await endTouchDrag(page, longDrag);
  }
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  const dismissed = await page.evaluate(() => ({
    homeInert: document.getElementById('ovStart')?.inert,
    authRestored: document.getElementById('onAuth')?.parentElement?.classList.contains('pbody'),
  }));
  return { held, sprung, dismissed };
}

async function submitCredentials(page) {
  await page.fill('#onEmail', 'player@example.test');
  await page.fill('#onPass', 'unchanged-secret');
  await page.click('#onAuthActs .primary');
}

async function probeCredentialError(page, routes) {
  await submitCredentials(page);
  await page.waitForFunction(() => document.getElementById('onAuthErr')?.textContent?.trim());
  const state = await page.evaluate(() => ({
    sheetOpen: !!document.querySelector('.authsheet:not(.foout)'),
    email: document.getElementById('onEmail')?.value,
    password: document.getElementById('onPass')?.value,
    error: document.getElementById('onAuthErr')?.textContent?.trim(),
    buttonsEnabled: [...document.querySelectorAll('#onAuth button')]
      .filter((button) => !button.hidden)
      .every((button) => !button.disabled),
  }));
  return { ...state, passwordCalls: routes.passwordCalls() };
}

async function probeCredentialTransition(page, routes) {
  await submitCredentials(page);
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  await page.waitForSelector('#onLoading:not([hidden])');
  const transition = await page.evaluate(() => ({
    onlineOn: document.getElementById('ovOnline')?.classList.contains('on'),
    loadingVisible: document.getElementById('onLoading')?.hidden === false,
    authRestored: document.getElementById('onAuth')?.parentElement?.classList.contains('pbody'),
    authHidden: document.getElementById('onAuth')?.hidden,
    focused: document.activeElement?.id,
  }));

  /* Reopen auth while the successful run is still loading Profile. The old
     continuation must never target this newer sheet when it eventually
     finishes. A real tap cannot reach the still-hidden account button yet;
     invoking its bound action directly creates the exact ownership race. */
  await page.evaluate(() => document.getElementById('btnHaveAcc').click());
  await page.waitForSelector('.authsheet:not(.foout)');
  await page.waitForFunction(() => document.getElementById('onAccount')?.hidden === false,
    null, { timeout: 4000 }).catch(() => { /* the assertion below reports the state */ });
  const settled = await page.evaluate(() => ({
    secondSheetOpen: !!document.querySelector('.authsheet:not(.foout)'),
    accountVisible: document.getElementById('onAccount')?.hidden === false,
    onlineInert: document.getElementById('ovOnline')?.inert,
  }));
  return {
    transition,
    settled,
    passwordCalls: routes.passwordCalls(),
    profileCalls: routes.profileCalls(),
  };
}

async function probeCancelledTransition(page, routes) {
  await submitCredentials(page);
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  await page.waitForSelector('#onLoading:not([hidden])');
  await page.click('#btnOnlineBack');
  await page.waitForFunction(() => !document.getElementById('ovOnline')?.classList.contains('on'));
  await page.waitForTimeout(500);
  const state = await page.evaluate(() => ({
    homeOn: document.getElementById('ovStart')?.classList.contains('on'),
    onlineOn: document.getElementById('ovOnline')?.classList.contains('on'),
    visiblePanels: [...document.querySelectorAll('#ovOnline .panel')]
      .filter((panel) => !panel.hidden && panel.id !== 'onLoading')
      .map((panel) => panel.id),
  }));
  return { ...state, profileCalls: routes.profileCalls() };
}

async function probeAccountCredentialSuccess(page, routes) {
  await page.click('#btnHaveAcc');
  await submitCredentials(page);
  await page.waitForFunction(() => !document.querySelector('.authsheet'));
  await page.waitForSelector('#onAccount:not([hidden])');
  return page.evaluate((passwordCalls) => ({
    passwordCalls,
    onlineOn: document.getElementById('ovOnline')?.classList.contains('on'),
    accountVisible: document.getElementById('onAccount')?.hidden === false,
    queueVisible: document.getElementById('onQueue')?.hidden === false,
    title: document.getElementById('onTitle')?.textContent,
    focused: document.activeElement?.id,
  }), routes.passwordCalls());
}

export async function runAuthModalScenarios(suite) {
  const { visit, out, check } = suite;
  const sessionless = await visit({ anonymous: 422, skipStandardProbes: true,
    probe: probeSessionlessModal });
  out.authModalSessionless = sessionless.probeResult;
  const s = sessionless.probeResult;
  check(s?.before.placeholderPrivacyDoors === 1 && s.before.homeOn && s.before.homeInert
    && !s.before.onlineOn && s.before.modal === 'true',
  'sessionless auth is not a modal over inert Home or lacks its placeholder Privacy door', s?.before);
  check(s?.swapped.title === 'CREATE ACCOUNT' && s.swapped.action === 'Create account'
    && s.swapped.email === 'player@example.test' && s.swapped.password === 'unchanged-secret',
  'switching auth step rebuilt the form or lost sessionless copy', s?.swapped);
  check(s?.nested.legalTopmost && s.nested.authInert
    && s.nested.email === s.swapped.email && s.nested.password === s.swapped.password
    && s.nested.title === s.swapped.title,
  'Privacy did not stack above and preserve the auth form', s?.nested);
  check(s?.afterPrivacy.authOpen && s.afterPrivacy.focused === 'btnAuthPrivacy'
    && s.afterPrivacy.homeInert && s.afterPrivacy.email === s.swapped.email
    && s.afterPrivacy.password === s.swapped.password && s.afterPrivacy.title === s.swapped.title,
  'first Escape dismissed auth or lost its step/input instead of only closing Privacy', s?.afterPrivacy);
  check(s?.dismissed.homeOn && !s.dismissed.homeInert && s.dismissed.authRestored
    && s.dismissed.authHidden && s.dismissed.focused === 'homeChip',
  'second Escape did not restore Home and the stable auth DOM slot', s?.dismissed);

  const account = await visit({ skipStandardProbes: true, probe: probeAccountOrigin });
  out.authModalAccount = account.probeResult;
  const a = account.probeResult;
  check(a?.opened.accountVisible && a.opened.onlineOn && a.opened.onlineInert && a.opened.panelInSheet,
    'account auth did not retain an inert Account origin', a?.opened);
  check(a?.reopened.sheets === 1 && a.reopened.live && a.reopened.accountVisible && a.reopened.onlineInert,
    'rapid dismiss/reopen left a dying or duplicate auth sheet', a?.reopened);
  check(a?.closed.accountVisible && a.closed.onlineOn && !a.closed.onlineInert
    && a.closed.focused === 'btnHaveAcc',
  'account-origin dismissal did not return to its opener', a?.closed);

  const short = await visit({ anonymous: 422, skipStandardProbes: true,
    viewport: { width: 568, height: 320 }, probe: probeShortModal });
  out.authModalShort = short.probeResult;
  const g = short.probeResult?.geometry;
  check(short.probeResult?.afterShortDrag && short.probeResult.handleDismissed
    && g?.cardInViewport && g.internalScroll && g.overflowMode && g.finalReachable
    && g.fullWidthHandle && g.cardTouch === 'auto' && g.panelTouch === 'pan-y'
    && g.grabTouch === 'none',
  'short auth form is clipped, unscrollable, or a short handle drag dismissed it', short.probeResult);

  const drag = await visit({ anonymous: 422, skipStandardProbes: true, probe: probeCardDrag });
  out.authModalCardDrag = drag.probeResult;
  const d = drag.probeResult;
  check(d?.held.cardDragMode && !d.held.overflowMode && d.held.dy >= 35
    && d.sprung.open && d.sprung.dy <= 1 && !d.dismissed.homeInert && d.dismissed.authRestored,
  'a fitting auth sheet did not follow, spring back, and dismiss from its shared card surface', d);

  const error = await visit({ anonymous: 422, passwordAuth: 'error', skipStandardProbes: true,
    probe: probeCredentialError });
  out.authCredentialError = error.probeResult;
  const e = error.probeResult;
  check(e?.passwordCalls === 1 && e.sheetOpen && e.error && e.buttonsEnabled
    && e.email === 'player@example.test' && e.password === 'unchanged-secret',
  'credential error dismissed, locked, or rebuilt the auth form', e);

  const transition = await visit({ anonymous: 422, passwordAuth: 'success', dataDelay: 700,
    skipStandardProbes: true, probe: probeCredentialTransition });
  out.authCredentialTransition = transition.probeResult;
  const c = transition.probeResult;
  check(c?.passwordCalls === 1 && c.transition.onlineOn && c.transition.loadingVisible
    && c.transition.authRestored && c.transition.authHidden && c.transition.focused === 'onTitle',
  'successful credentials did not atomically leave auth for the owned loading view', c);
  check(c?.profileCalls >= 2 && c.settled.secondSheetOpen && c.settled.accountVisible
    && c.settled.onlineInert,
  'an older successful transition closed or displaced a newer auth sheet', c);

  const cancelled = await visit({ anonymous: 422, passwordAuth: 'success', dataDelay: 700,
    skipStandardProbes: true, probe: probeCancelledTransition });
  out.authCredentialCancelled = cancelled.probeResult;
  const x = cancelled.probeResult;
  check(x?.homeOn && !x.onlineOn && x.profileCalls === 1 && x.visiblePanels.length === 0,
    'Back during credential loading allowed the stale destination route to continue', x);

  const accountSuccess = await visit({ passwordAuth: 'success', skipStandardProbes: true,
    probe: probeAccountCredentialSuccess });
  out.authCredentialAccount = accountSuccess.probeResult;
  const p = accountSuccess.probeResult;
  check(p?.passwordCalls === 1 && p.onlineOn && p.accountVisible && !p.queueVisible
    && p.title === 'PROFILE' && p.focused === 'onTitle',
  'account-origin sign-in did not return to Profile', p);
}
