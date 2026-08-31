import { ladderBoardFixture } from './board-fixtures.mjs';
import { installLadderRoutes } from './ladder-routes.mjs';
import { installProfileRoutes } from './profile-routes.mjs';
import { installIdentityRoutes } from './identity-routes.mjs';

export async function installOnlineRoutes(
  page,
  {
    anonymous,
    attached,
    authDelay = 0,
    dataDelay = 0,
    door,
    gameCenterBridge = null,
    named,
    /* An account that is past the guest rung: the profile only paints its
       ACCOUNT ACCESS box for a player who is not a guest. */
    member = false,
    identity = { gameCenterLinked: false, appleLinked: false, appleRevocationReady: false },
    ladderNearBottom = false,
    /* Extra season matches beyond the fixed three, so a test can reach page two.
       Zero by default: every existing probe sees exactly what it always saw. */
    ladderBoard = null,
    historyDepth = 0,
    paginationRace = false,
    passwordAuth = 'error',
    runes = [],
    /* Which rune the account carries, as the profiles row reports it. */
    equippedRune = null,
    /* Semantic RANDOM equipment is a separate column; equippedRune remains
       its concrete compatibility fallback. */
    randomRuneMode = false,
    standingPoints = null,
    standingPeak = null,
    historicalSilverReached = null,
    unseenRunes = [],
    markRunesSeenAfterFirstRead = false,
    SESSION,
    GUEST_ID,
  },
) {
  const session = member
    ? { ...SESSION, user: { ...SESSION.user, email: 'player@example.test', is_anonymous: false } }
    : SESSION;
  let signupCalls = 0;
  let passwordCalls = 0;
  let profileCalls = 0;
  let profileAccountId = GUEST_ID;
  let tierProfileCalls = 0;
  let equippedProfileCalls = 0;
  let randomModeProfileCalls = 0;
  let failNextEquipmentWrite = false;
  let deferNextEquipmentWrite = false;
  let markEquipmentWriteStarted;
  let releaseEquipmentWrite;
  let markEquipmentWriteFinished;
  const equipmentWriteStarted = new Promise((resolve) => { markEquipmentWriteStarted = resolve; });
  const equipmentWriteRelease = new Promise((resolve) => { releaseEquipmentWrite = resolve; });
  const equipmentWriteFinished = new Promise((resolve) => { markEquipmentWriteFinished = resolve; });
  let runeCalls = 0;
  let acknowledgeCalls = 0;
  let deferNextSignup = false;
  let markSignupRequestStarted;
  let releaseSignupRequest;
  let markSignupRequestFinished;
  const collectedRunes = [...runes];
  const seenRunes = new Set(runes.filter((runeId) => !unseenRunes.includes(runeId)));
  let deferNextRune = false;
  let failRuneResponseOnCall = null;
  let markRuneRequestStarted;
  let releaseRuneRequest;
  let markRuneRequestFinished;
  let deferNextAccountProfile = false;
  let markAccountProfileStarted;
  let releaseAccountProfile;
  let markAccountProfileFinished;
  let markAcknowledgeStarted;
  let markAcknowledgeFinished;
  let failNextAcknowledge = false;
  const acknowledgeDeferrals = [];
  let firstAcknowledgeDeferral = null;
  const signupRequestStarted = new Promise((resolve) => { markSignupRequestStarted = resolve; });
  const signupRequestRelease = new Promise((resolve) => { releaseSignupRequest = resolve; });
  const signupRequestFinished = new Promise((resolve) => { markSignupRequestFinished = resolve; });
  const runeRequestStarted = new Promise((resolve) => { markRuneRequestStarted = resolve; });
  const runeRequestRelease = new Promise((resolve) => { releaseRuneRequest = resolve; });
  const runeRequestFinished = new Promise((resolve) => { markRuneRequestFinished = resolve; });
  const accountProfileStarted = new Promise((resolve) => { markAccountProfileStarted = resolve; });
  const accountProfileRelease = new Promise((resolve) => { releaseAccountProfile = resolve; });
  const accountProfileFinished = new Promise((resolve) => { markAccountProfileFinished = resolve; });
  const acknowledgeStarted = new Promise((resolve) => { markAcknowledgeStarted = resolve; });
  const acknowledgeFinished = new Promise((resolve) => { markAcknowledgeFinished = resolve; });
  const deferAcknowledge = () => {
    let markStarted;
    let release;
    let markFinished;
    const control = {
      started: new Promise((resolve) => { markStarted = resolve; }),
      wait: new Promise((resolve) => { release = resolve; }),
      finished: new Promise((resolve) => { markFinished = resolve; }),
      markStarted: () => markStarted(),
      release: () => release(),
      markFinished: () => markFinished(),
    };
    acknowledgeDeferrals.push(control);
    if (!firstAcknowledgeDeferral) {
      firstAcknowledgeDeferral = control;
      void control.finished.then(markAcknowledgeFinished);
    }
    return { started: control.started, release: control.release, finished: control.finished };
  };
  const hold = (share = 1) => dataDelay > 0
    ? new Promise((resolve) => setTimeout(resolve, dataDelay * share))
    : Promise.resolve();
  const nearBottomBoard = ladderBoardFixture(ladderBoard ?? ladderNearBottom);
  /* Kill the service worker before app code runs. Once it controls the page it
     re-issues requests from the worker, where page.route() cannot see them —
     and whether it has claimed the page by the time of the tap is a race, so a
     stub would work or not work depending on the machine's mood. */
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: () => Promise.resolve({ addEventListener() {} }), ready: new Promise(() => {}),
               controller: null, addEventListener() {}, getRegistrations: () => Promise.resolve([]) },
    });
  });
  if (attached) await page.addInitScript(() => localStorage.setItem('knucklebones.online.attached', '1'));
  await page.route('**/auth/v1/signup*', async (r) => {
    signupCalls++;
    const deferred = deferNextSignup;
    if (deferred) {
      deferNextSignup = false;
      markSignupRequestStarted();
      await signupRequestRelease;
    }
    await (anonymous === 200
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) })
      : r.fulfill({ status: 422, contentType: 'application/json',
                    body: JSON.stringify({ code: 'anonymous_provider_disabled', message: 'Anonymous sign-ins are disabled' }) }));
    if (deferred) markSignupRequestFinished();
  });
  await page.route('**/auth/v1/token?grant_type=password', async (r) => {
    passwordCalls++;
    if (authDelay > 0) await new Promise((resolve) => setTimeout(resolve, authDelay));
    return passwordAuth === 'success'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) })
      : r.fulfill({ status: 400, contentType: 'application/json',
                   body: JSON.stringify({ error_code: 'invalid_credentials', message: 'Invalid login credentials' }) });
  });
  /* stateful, like the live table: the claim PATCH flips named_at (migration
     `20260820190459_0026_one_name_forever.sql` stamps it server-side), and
     every later GET tells the claimed truth — nickname included */
  let claimed = named;
  let currentEquippedRune = equippedRune;
  let currentRandomRuneMode = randomRuneMode;
  await page.route('**/rest/v1/rpc/set_rune_equipment*', async (r) => {
    const body = r.request().postDataJSON() ?? {};
    const deferred = deferNextEquipmentWrite;
    if (deferred) {
      deferNextEquipmentWrite = false;
      markEquipmentWriteStarted();
      await equipmentWriteRelease;
    }
    if (failNextEquipmentWrite) {
      failNextEquipmentWrite = false;
      await r.fulfill({ status: 409, contentType: 'application/json',
        body: JSON.stringify({ message: 'equipment write refused' }) });
      if (deferred) markEquipmentWriteFinished();
      return;
    }
    currentEquippedRune = body.p_equipped_rune ?? null;
    currentRandomRuneMode = body.p_random_rune_mode === true;
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      equipped_rune: currentEquippedRune,
      random_rune_mode: currentRandomRuneMode,
    }) });
    if (deferred) markEquipmentWriteFinished();
  });
  await page.route('**/rest/v1/profiles*', async (r) => {
    if (r.request().method() === 'PATCH') {
      const body = r.request().postDataJSON() ?? {};
      if (Object.hasOwn(body, 'nickname')) claimed = true;
      return r.fulfill({ status: 204, body: '' });
    }
    /* FOUR different reads hit this one table, and they are told apart by the
       columns they ask for. "Not the tier read" stopped meaning "the account
       profile read" when `20260828192801_equipped_rune.sql` arrived: a third
       query appeared, and answering it as the account profile both miscounted
       the account reads and handed the client a row with no equipped_rune in
       it — so nothing could see whether the seat worked. Name all three. */
    const url = r.request().url();
    const tierRead = url.includes('ranked_pool_tier');
    const equipRead = url.includes('equipped_rune');
    const randomModeRead = url.includes('random_rune_mode');
    const accountRead = !tierRead && !equipRead && !randomModeRead;
    const deferred = accountRead && deferNextAccountProfile;
    if (deferred) {
      deferNextAccountProfile = false;
      markAccountProfileStarted();
      await accountProfileRelease;
    }
    await hold(.35);
    if (tierRead) {
      tierProfileCalls++;
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ranked_pool_tier: 'ivory' }) });
    }
    if (equipRead) {
      equippedProfileCalls++;
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ equipped_rune: currentEquippedRune }) });
    }
    if (randomModeRead) {
      randomModeProfileCalls++;
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ random_rune_mode: currentRandomRuneMode }) });
    }
    profileCalls++;
    const response = r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: profileAccountId, nickname: claimed && door === 'claim' ? 'NeonKing77' : 'TestGuest001',
                              rating: 1000, created_at: new Date().toISOString(),
                              named_at: claimed ? '2026-08-01T00:00:00Z' : null }]) });
    if (deferred) void response.then(markAccountProfileFinished);
    return response;
  });
  await page.route('**/rest/v1/player_runes*', async (r) => {
    runeCalls++;
    if (markRunesSeenAfterFirstRead && runeCalls > 1) {
      for (const runeId of collectedRunes) seenRunes.add(runeId);
    }
    const deferred = deferNextRune;
    if (deferred) {
      deferNextRune = false;
      markRuneRequestStarted();
      await runeRequestRelease;
    }
    if (runeCalls === failRuneResponseOnCall) {
      failRuneResponseOnCall = null;
      await r.fulfill({ status: 503, contentType: 'application/json', body: '[]' });
      if (deferred) markRuneRequestFinished();
      return;
    }
    const body = collectedRunes.map((runeId, index) => ({
      rune_id: runeId,
      collected_at: `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
      source_match_id: '11111111-1111-4111-8111-111111111111',
      seen_at: seenRunes.has(runeId) ? '2026-08-24T00:00:00Z' : null,
    }));
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (deferred) markRuneRequestFinished();
  });
  await page.route('**/rest/v1/rpc/acknowledge_rune_reward*', async (r) => {
    acknowledgeCalls++;
    const runeId = r.request().postDataJSON()?.reward_rune_id;
    markAcknowledgeStarted();
    const deferred = acknowledgeDeferrals.shift() ?? null;
    deferred?.markStarted();
    if (deferred) await deferred.wait;
    const fails = failNextAcknowledge;
    failNextAcknowledge = false;
    if (!fails && typeof runeId === 'string') seenRunes.add(runeId);
    try {
      await r.fulfill({
        status: fails ? 503 : 200,
        contentType: 'application/json',
        body: fails ? 'false' : 'true',
      });
    } catch {
      /* A hung-ACK liveness probe deliberately lets the client abort first. */
    }
    deferred?.markFinished();
  });
  /* The settings row stays absent: seeding succeeds, hydration applies
     nothing, and no request escapes to a live backend. */
  await page.route('**/rest/v1/player_settings*', (r) => r.fulfill({
    status: r.request().method() === 'GET' ? 200 : 201,
    contentType: 'application/json',
    body: '[]',
  }));
  await page.route('**/rest/v1/matches*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  let joinCalls = 0;
  await page.route('**/functions/v1/pvp-join', (r) => {
    joinCalls++;
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"queued"}' });
  });
  const identityRoutes = await installIdentityRoutes(page, {
    identity, gameCenter: gameCenterBridge, session,
  });
  await page.route('**/rest/v1/rpc/leave_ranked_queue', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"status":"left"}',
  }));
  /* Both read the same board: the standing is derived from the rows the
     leaderboard serves, never restated beside them. */
  await installProfileRoutes(page, {
    hold, nearBottomBoard, historyDepth, standingPoints, standingPeak,
    historicalSilverReached,
  });
  const ladder = await installLadderRoutes(page, { hold, nearBottomBoard, paginationRace });
  await page.route('**/auth/v1/.well-known/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"keys":[]}' }));
  await page.route('**/rest/v1/rpc/current_season*', async (r) => {
    await hold(.55);
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: '"11111111-1111-4111-8111-111111111111"' });
  });
  return {
    ...identityRoutes,
    ...ladder,
    signupCalls: () => signupCalls,
    deferNextSignupResponse: () => { deferNextSignup = true; },
    signupRequestStarted,
    releaseSignupResponse: () => releaseSignupRequest(),
    signupRequestFinished,
    passwordCalls: () => passwordCalls,
    profileCalls: () => profileCalls,
    setProfileAccountId: (accountId) => { profileAccountId = accountId; },
    tierProfileCalls: () => tierProfileCalls,
    equippedProfileCalls: () => equippedProfileCalls,
    randomModeProfileCalls: () => randomModeProfileCalls,
    failNextEquipmentWrite: () => { failNextEquipmentWrite = true; },
    deferNextEquipmentWrite: () => { deferNextEquipmentWrite = true; },
    equipmentWriteStarted,
    releaseEquipmentWrite: () => releaseEquipmentWrite(),
    equipmentWriteFinished,
    joinCalls: () => joinCalls,
    runeCalls: () => runeCalls,
    acknowledgeCalls: () => acknowledgeCalls,
    deferNextRuneResponse: () => { deferNextRune = true; },
    failRuneResponseOnCall: (call) => { failRuneResponseOnCall = call; },
    runeRequestStarted,
    releaseRuneResponse: () => releaseRuneRequest(),
    runeRequestFinished,
    deferNextAccountProfileResponse: () => { deferNextAccountProfile = true; },
    accountProfileStarted,
    releaseAccountProfileResponse: () => releaseAccountProfile(),
    accountProfileFinished,
    acknowledgeStarted,
    deferNextAcknowledge: deferAcknowledge,
    failNextAcknowledge: () => { failNextAcknowledge = true; },
    releaseAcknowledge: () => firstAcknowledgeDeferral?.release(),
    acknowledgeFinished,
    makeRuneUnseen: (runeId) => {
      if (!collectedRunes.includes(runeId)) collectedRunes.push(runeId);
      seenRunes.delete(runeId);
    },
  };
}
