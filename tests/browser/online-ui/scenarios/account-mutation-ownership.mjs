const ACCOUNT_A = '00000000-0000-4000-8000-00000000beef';
const ACCOUNT_B = '11111111-2222-4333-8444-555555555555';

const switchStoredSession = (nextAccountId) => {
  const authKey = Object.keys(localStorage)
    .find((key) => key.startsWith('sb-') && key.endsWith('-auth-token'));
  if (!authKey) return false;
  const stored = JSON.parse(localStorage.getItem(authKey));
  const session = stored?.currentSession ?? stored;
  if (!session?.user) return false;
  session.user.id = nextAccountId;
  localStorage.setItem(authKey, JSON.stringify(stored));
  return true;
};

const profilePatch = (request) => {
  if (request.method() !== 'PATCH' || !request.url().includes('/rest/v1/profiles')) return null;
  let body = null;
  try { body = request.postDataJSON(); } catch { /* diagnostic only */ }
  return { owner: new URL(request.url()).searchParams.get('id'), body };
};

const visibleAccount = () => ({
  name: document.getElementById('accName')?.textContent?.trim(),
  owner: JSON.parse(localStorage.getItem(
    'knucklebones.online.account-profile') ?? 'null')?.accountId ?? null,
});

async function waitForClaimBoundary(page) {
  await page.waitForFunction(() => {
    const loading = document.getElementById('onLoading');
    const account = document.getElementById('onAccount');
    return loading?.hidden === false
      || account?.querySelector('#accName')?.textContent === 'NeonKing77'
      || document.querySelector('#askHead')?.textContent?.startsWith('Keep ');
  }, null, { timeout: 10000 });
  await page.waitForTimeout(150);
}

async function probeClaimSwitchBeforeConfirm(page, routes) {
  const patches = [];
  const recordPatch = (request) => {
    const patch = profilePatch(request);
    if (patch) patches.push(patch);
  };
  page.on('request', recordPatch);
  const before = await page.evaluate(visibleAccount);
  await page.fill('#onNick', 'NeonKing77');
  await page.click('#btnClaim');
  await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
  routes.setProfileAccountId(ACCOUNT_B);
  routes.setProfileNickname('AccountB');
  const switched = await page.evaluate(switchStoredSession, ACCOUNT_B);
  await page.click('#btnAskYes');
  await waitForClaimBoundary(page);
  page.off('request', recordPatch);
  return page.evaluate(({ before, switched, patches }) => ({
    before,
    switched,
    patches,
    loading: document.getElementById('onLoading')?.hidden === false,
    profileHidden: document.getElementById('onAccount')?.hidden === true,
    upgrade: document.querySelector('#askHead')?.textContent?.startsWith('Keep ') === true,
    authShown: document.getElementById('onAuth')?.hidden === false,
  }), { before, switched, patches });
}

async function probeClaimSwitchDuringPatch(page, routes) {
  const patches = [];
  let markStarted;
  let releasePatch;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const release = new Promise((resolve) => { releasePatch = resolve; });
  await page.route('**/rest/v1/profiles*', async (route) => {
    const patch = profilePatch(route.request());
    if (!patch) return route.fallback();
    patches.push(patch);
    markStarted();
    await release;
    return route.fallback();
  });
  const before = await page.evaluate(visibleAccount);
  await page.fill('#onNick', 'NeonKing77');
  await page.click('#btnClaim');
  await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
  await page.click('#btnAskYes');
  const requestStarted = await Promise.race([
    started.then(() => true),
    page.waitForTimeout(5000).then(() => false),
  ]);
  if (!requestStarted) {
    releasePatch();
    return { before, requestStarted, patches };
  }
  routes.setProfileAccountId(ACCOUNT_B);
  routes.setProfileNickname('AccountB');
  const switched = await page.evaluate(switchStoredSession, ACCOUNT_B);
  releasePatch();
  await waitForClaimBoundary(page);
  return page.evaluate(({ before, requestStarted, switched, patches }) => ({
    before,
    requestStarted,
    switched,
    patches,
    loading: document.getElementById('onLoading')?.hidden === false,
    profileHidden: document.getElementById('onAccount')?.hidden === true,
    upgrade: document.querySelector('#askHead')?.textContent?.startsWith('Keep ') === true,
    authShown: document.getElementById('onAuth')?.hidden === false,
  }), { before, requestStarted, switched, patches });
}

async function probeAvatarSwitchBeforeSave(page, routes) {
  await page.click('#btnAvatar');
  await page.waitForSelector('#onAvatar:not([hidden])', { timeout: 5000 });
  await page.waitForSelector('#avFaces button[data-face="2"]', { timeout: 5000 });
  const before = await page.evaluate(() => ({
    name: document.getElementById('accName')?.textContent?.trim(),
    owner: JSON.parse(localStorage.getItem(
      'knucklebones.online.account-profile') ?? 'null')?.accountId ?? null,
    avatarOpen: document.getElementById('onAvatar')?.hidden === false,
  }));
  await page.click('#avFaces button[data-face="2"]');
  await page.click('#avHues button[data-hue="mg"]');
  const patches = [];
  const recordPatch = (request) => {
    const patch = profilePatch(request);
    if (patch?.body && Object.hasOwn(patch.body, 'avatar')) patches.push(patch);
  };
  page.on('request', recordPatch);
  routes.setProfileAccountId(ACCOUNT_B);
  routes.setProfileNickname('AccountB');
  const switched = await page.evaluate(switchStoredSession, ACCOUNT_B);
  await page.click('#btnAvatarSave');
  await page.waitForFunction(() => document.getElementById('onAccount')?.hidden === false
    && document.getElementById('accName')?.textContent?.trim() === 'AccountB'
    && !document.getElementById('onAccount')?.hasAttribute('data-account-pending'),
  null, { timeout: 15000 });
  page.off('request', recordPatch);
  return page.evaluate(({ before, switched, patches }) => ({
    before,
    switched,
    patches,
    avatarOpen: document.getElementById('onAvatar')?.hidden === false,
    name: document.getElementById('accName')?.textContent?.trim(),
    face: document.querySelector('#accDie .die')?.getAttribute('data-v'),
    cached: JSON.parse(localStorage.getItem(
      'knucklebones.online.account-profile') ?? 'null')?.profile ?? null,
  }), { before, switched, patches });
}

async function probeDeleteSwitchBeforeConfirm(page, routes) {
  const calls = [];
  await page.route('**/functions/v1/account-delete', async (route) => {
    calls.push(route.request().postDataJSON() ?? null);
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  });
  const before = await page.evaluate(visibleAccount);
  await page.click('#btnDeleteAcc');
  await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
  routes.setProfileAccountId(ACCOUNT_B);
  routes.setProfileNickname('AccountB');
  const switched = await page.evaluate(switchStoredSession, ACCOUNT_B);
  await page.check('#askCheck');
  await page.click('#btnAskYes');
  await page.waitForFunction(() => document.getElementById('onLoading')?.hidden === false
    || !!document.querySelector('.faceoff.warnsheet .focard'),
  null, { timeout: 10000 });
  await page.waitForTimeout(150);
  return page.evaluate(({ before, switched, calls }) => ({
    before,
    switched,
    calls,
    loaderVisible: document.getElementById('onLoading')?.hidden === false,
    profileHidden: document.getElementById('onAccount')?.hidden === true,
    problem: !!document.querySelector('.faceoff.warnsheet .focard'),
  }), { before, switched, calls });
}

export async function runAccountMutationOwnershipScenarios({ visit, out, check }) {
  const claimBeforeConfirm = await visit({ skipStandardProbes: true,
    returnAfterProbe: true, probe: probeClaimSwitchBeforeConfirm });
  out.claimAccountSwitchBeforeConfirm = claimBeforeConfirm.probeResult;
  const preClaim = claimBeforeConfirm.probeResult;
  check(preClaim?.before?.owner === ACCOUNT_A && preClaim.before.name === 'TestGuest001'
      && preClaim.switched && preClaim.patches?.length === 0
      && preClaim.loading && preClaim.profileHidden && !preClaim.upgrade && !preClaim.authShown,
  'a nickname question opened by account A wrote or published against account B', preClaim);
  check(claimBeforeConfirm.errs.length === 0,
    'page errors while refusing a stale nickname confirmation', claimBeforeConfirm.errs);

  const claimDuringPatch = await visit({ skipStandardProbes: true,
    returnAfterProbe: true, probe: probeClaimSwitchDuringPatch });
  out.claimAccountSwitchDuringPatch = claimDuringPatch.probeResult;
  const lateClaim = claimDuringPatch.probeResult;
  check(lateClaim?.before?.owner === ACCOUNT_A && lateClaim.before.name === 'TestGuest001'
      && lateClaim.requestStarted && lateClaim.switched
      && lateClaim.patches?.length === 1 && lateClaim.patches[0].owner === `eq.${ACCOUNT_A}`
      && lateClaim.patches[0].body?.nickname === 'NeonKing77'
      && lateClaim.loading && lateClaim.profileHidden && !lateClaim.upgrade && !lateClaim.authShown,
  'a completed account A nickname write published or offered an upgrade after B took the session',
  lateClaim);
  check(claimDuringPatch.errs.length === 0,
    'page errors during a deferred nickname account switch', claimDuringPatch.errs);

  const avatarBeforeSave = await visit({ skipStandardProbes: true,
    returnAfterProbe: true, probe: probeAvatarSwitchBeforeSave });
  out.avatarAccountSwitchBeforeSave = avatarBeforeSave.probeResult;
  const staleAvatar = avatarBeforeSave.probeResult;
  check(staleAvatar?.before?.owner === ACCOUNT_A && staleAvatar.before.avatarOpen
      && staleAvatar.switched && staleAvatar.patches?.length === 0
      && !staleAvatar.avatarOpen && staleAvatar.name === 'AccountB'
      && staleAvatar.face === '5' && staleAvatar.cached?.id === ACCOUNT_B
      && staleAvatar.cached.avatar === 'die:5:cy',
  'an avatar picker opened by account A wrote its selection into account B', staleAvatar);
  check(avatarBeforeSave.errs.length === 0,
    'page errors while refusing a stale avatar picker', avatarBeforeSave.errs);

  const deleteBeforeConfirm = await visit({ named: true, member: true,
    skipStandardProbes: true, returnAfterProbe: true,
    probe: probeDeleteSwitchBeforeConfirm });
  out.deleteAccountSwitchBeforeConfirm = deleteBeforeConfirm.probeResult;
  const staleDelete = deleteBeforeConfirm.probeResult;
  check(staleDelete?.before?.owner === ACCOUNT_A && staleDelete.before.name === 'TestGuest001'
      && staleDelete.switched && staleDelete.calls?.length === 0
      && staleDelete.loaderVisible && staleDelete.profileHidden && !staleDelete.problem,
  'a delete question opened by account A called the destructive endpoint after B took the session',
  staleDelete);
  check(deleteBeforeConfirm.errs.length === 0,
    'page errors while refusing a stale account deletion', deleteBeforeConfirm.errs);
}
