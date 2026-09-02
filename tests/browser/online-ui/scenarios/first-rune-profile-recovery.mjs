const bounded = (promise, message, timeout = 7000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeout)),
]);

async function directProfileFirstRuneProbe(page, routes) {
  /* The visit first opens a verified-empty Profile. Return Home, introduce the
     account's first rune, then make only Profile's immediate confirmation read
     fail: the entry discovery remains the verified source for the tutorial. */
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  routes.makeRuneUnseen('fate');
  const readsBeforeEntry = routes.runeCalls();
  const failedConfirmationRead = readsBeforeEntry + 2;
  routes.failRuneResponseOnCall(failedConfirmationRead);
  await page.click('#homeChip');
  await page.waitForSelector('.rune-reward-sheet .focard', { timeout: 15000 });

  const deadline = Date.now() + 7000;
  while (routes.runeCalls() < failedConfirmationRead && Date.now() < deadline) {
    await page.waitForTimeout(25);
  }
  const arrival = await page.evaluate(() => ({
    title: document.querySelector('.rune-reward-sheet__title')?.textContent?.trim() ?? '',
    action: document.querySelector('.rune-reward-sheet__continue')?.textContent?.trim() ?? '',
    profileVisible: document.getElementById('onAccount')?.hidden === false,
    guidePresent: !!document.getElementById('accRuneGuide'),
  }));
  const acknowledgementsBeforeEquip = routes.acknowledgeCalls();

  await page.click('.rune-reward-sheet__continue');
  await page.waitForSelector('#onAccount:not([hidden]) #accRuneGuide', { timeout: 15000 });
  await page.waitForFunction(() => document.activeElement?.id === 'accSeat');
  const guided = await page.evaluate(() => {
    const seat = document.getElementById('accSeat');
    const box = seat?.getBoundingClientRect();
    return {
      title: document.querySelector('.acc-rune-guide-title')?.textContent?.trim() ?? '',
      body: document.querySelector('.acc-rune-guide-body')?.textContent?.trim() ?? '',
      seatFocused: document.activeElement === seat,
      seatHighlighted: seat?.classList.contains('acc-rune-guide-target') ?? false,
      seatSize: box ? { width: box.width, height: box.height } : null,
      rewardSheetOpen: !!document.querySelector('.rune-reward-sheet'),
    };
  });
  const acknowledgementsBeforeSeat = routes.acknowledgeCalls();

  await page.click('#accSeat');
  await page.waitForSelector('.faceoff #accSeatEquip', { timeout: 15000 });
  await bounded(routes.acknowledgeStarted,
    'the direct-Profile first rune was not acknowledged after its real seat opened');
  return {
    readsBeforeEntry,
    failedConfirmationRead,
    readsAfterArrival: routes.runeCalls(),
    arrival,
    guided,
    acknowledgementsBeforeEquip,
    acknowledgementsBeforeSeat,
    acknowledgementsAfterSeat: routes.acknowledgeCalls(),
    guidePresentAfterSeat: await page.locator('#accRuneGuide').count(),
    equipmentSheet: await page.locator('.faceoff #accSeatEquip').count(),
  };
}

async function directAccountFailureProbe(page, routes) {
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  routes.setProfileAccountId('11111111-2222-4333-8444-555555555555');
  await page.click('#homeChip');
  await page.waitForFunction(() =>
    document.getElementById('ovStart')?.classList.contains('on')
      && !document.getElementById('ovOnline')?.classList.contains('on'));
  return page.evaluate(() => ({
    homeOpen: document.getElementById('ovStart')?.classList.contains('on') ?? false,
    onlineOpen: document.getElementById('ovOnline')?.classList.contains('on') ?? false,
    loadingVisible: document.getElementById('ovOnline')?.classList.contains('on')
      && document.getElementById('onLoading')?.hidden === false,
  }));
}

export async function runFirstRuneProfileRecoveryScenario({ visit, out, check }) {
  const result = await visit({
    named: true,
    runes: [],
    skipStandardProbes: true,
    probe: directProfileFirstRuneProbe,
  });
  const seen = result.probeResult;
  out.firstRuneProfileRecovery = seen;
  check(seen?.readsAfterArrival >= seen.failedConfirmationRead
      && seen.failedConfirmationRead === seen.readsBeforeEntry + 2
      && seen.arrival?.title === 'FATE'
      && seen.arrival.action === 'Equip rune'
      && seen.arrival.profileVisible
      && !seen.arrival.guidePresent
      && seen.acknowledgementsBeforeEquip === 0,
    'a failed Profile confirmation read discarded or consumed the verified first rune', seen);
  check(seen?.guided?.title === 'CHOOSE YOUR RUNE'
      && seen.guided.body
      && seen.guided.seatFocused
      && seen.guided.seatHighlighted
      && seen.guided.seatSize?.width >= 44
      && seen.guided.seatSize.height >= 44
      && !seen.guided.rewardSheetOpen
      && seen.acknowledgementsBeforeSeat === 0,
    'Equip rune did not hand the failed-refresh recovery to the real Profile seat', seen);
  check(seen?.acknowledgementsAfterSeat === 1
      && seen.guidePresentAfterSeat === 0
      && seen.equipmentSheet === 1,
    'the recovered first rune acknowledged before or outside the real equipment seat', seen);
  check(result.errs.length === 0,
    'page errors during direct-Profile first-rune recovery', result.errs);

  const failure = await visit({
    named: true,
    runes: [],
    skipStandardProbes: true,
    probe: directAccountFailureProbe,
  });
  out.directAccountFailure = failure.probeResult;
  check(failure.probeResult?.homeOpen
      && !failure.probeResult.onlineOpen
      && !failure.probeResult.loadingVisible,
    'a rejected direct Profile confirmation stranded the player on its loading hold',
    failure.probeResult);
  check(failure.errs.length === 0,
    'page errors during direct Profile confirmation failure', failure.errs);
}
