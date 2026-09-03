import { ladderBoardFixture } from './board-fixtures.mjs';
import { installLadderRoutes } from './ladder-routes.mjs';
import { installProfileRoutes } from './profile-routes.mjs';
import { installIdentityRoutes } from './identity-routes.mjs';
import { installAppleAuthRoutes } from './apple-auth-routes.mjs';

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
    identityDelay = 0,
    ladderNearBottom = false,
    /* Extra season matches beyond the fixed three, so a test can reach page two.
       Zero by default: every existing probe sees exactly what it always saw. */
    ladderBoard = null,
    historyDepth = 0,
    paginationRace = false,
    passwordAuth = 'error',
    appleAuth = 'invalid',
    deferAppleAuth = false,
    deferAppleRegistration = false,
    runes = [],
    /* Which rune the account carries, as the profiles row reports it. */
    equippedRune = null,
    /* Semantic RANDOM equipment is a separate column; equippedRune remains
       its concrete compatibility fallback. */
    randomRuneMode = false,
    standingPoints = null,
    reportedStandingPoints = null,
    standingPeak = null,
    historicalSilverReached = null,
    progressionStatus = null,
    deferStanding = false,
    failStanding = false,
    emptyStanding = false,
    failLadder = false,
    /* The scalar the Ladder cannot map a league without. Any transient error
       makes activeRankedCurveVersion() answer null, which is the state that
       used to strand the panel on its loading die. */
    failCurveVersion = false,
    refuseStandingOnce = false,
    sessionRefresh = false,
    refuseSessionRefresh = false,
    offlineTokenEndpoint = false,
    failStreak = false,
    failHistory = false, failRuneOnCall = null,
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
  let profileAccountId = SESSION.user.id;
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
  let failRuneResponseOnCall = failRuneOnCall;
  let markRuneRequestStarted;
  let releaseRuneRequest;
  let markRuneRequestFinished;
  let deferNextAccountProfile = false;
  let failNextAccountProfile = false;
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
  const identityRoutes = await installIdentityRoutes(page, {
    identity, gameCenter: gameCenterBridge, session, statusDelay: identityDelay,
    sessionRefresh,
    refuseSessionRefresh,
    offlineTokenEndpoint,
  });
  const appleRoutes = await installAppleAuthRoutes(page, {
    mode: appleAuth,
    defer: deferAppleAuth,
    deferRegistration: deferAppleRegistration,
    session,
    onRegistered: () => identityRoutes.setAppleIdentity(true, true),
  });
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
     every later GET tells the claimed truth — nickname and avatar included */
  let claimed = named;
  let profileNickname = null;
  let currentAvatar = 'die:5:cy';
  let failNextAvatarWrite = false;
  let currentEquippedRune = equippedRune;
  let currentRandomRuneMode = randomRuneMode;
  await page.route('**/rest/v1/rpc/set_rune_equipment*', async (r) => {
    const body = r.request().postDataJSON() ?? {};
    /* The RPC writes the row of auth.uid(), so a write belongs to the account
       this stub served when the request ARRIVED. A probe may hand the stub to
       another account (setProfileAccountId / setRuneState) while the answer is
       held; the late write still lands on the earlier account's row, never on
       the row the stub now speaks for. */
    const writeAccountId = profileAccountId;
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
    const equippedRune = body.p_equipped_rune ?? null;
    const randomRuneMode = body.p_random_rune_mode === true;
    if (writeAccountId === profileAccountId) {
      currentEquippedRune = equippedRune;
      currentRandomRuneMode = randomRuneMode;
    }
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      equipped_rune: equippedRune,
      random_rune_mode: randomRuneMode,
    }) });
    if (deferred) markEquipmentWriteFinished();
  });
  await page.route('**/rest/v1/profiles*', async (r) => {
    if (r.request().method() === 'PATCH') {
      const body = r.request().postDataJSON() ?? {};
      if (Object.hasOwn(body, 'nickname')) claimed = true;
      if (typeof body.avatar === 'string') {
        /* A device with no connection: the row is untouched and the client is
           told so, which is what arms the deferred retry. */
        if (failNextAvatarWrite) {
          failNextAvatarWrite = false;
          return r.fulfill({ status: 503, contentType: 'application/json',
            body: JSON.stringify({ message: 'avatar write unavailable' }) });
        }
        currentAvatar = body.avatar;
      }
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
    if (accountRead && failNextAccountProfile) {
      failNextAccountProfile = false;
      /* A TERMINAL failure, deliberately not a 503. postgrest-js retries a GET
         that answers 503/520 (RETRYABLE_STATUS_CODES, RETRYABLE_METHODS) with a
         1s/2s/4s backoff, so a 503 here parks the client's row read for a full
         second, and by the time the retry arrives this one-shot flag is spent
         and the retry is answered 200 — a probe sampling the failure sees a
         still-pending read, never the outage it asked for. Same choice as the
         'all' rune failure below. */
      await r.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      if (deferred) markAccountProfileFinished();
      return;
    }
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
    const appleProfile = appleRoutes.appleProfile();
    const response = r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: appleProfile?.id ?? profileAccountId,
                              nickname: appleProfile?.nickname ?? profileNickname
        ?? (claimed && door === 'claim' ? 'NeonKing77' : 'TestGuest001'),
                              rating: 1000, created_at: new Date().toISOString(),
                              avatar: currentAvatar,
                              named_at: appleProfile?.named_at
        ?? (claimed ? '2026-08-01T00:00:00Z' : null) }]) });
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
    if (runeCalls === failRuneResponseOnCall || failRuneResponseOnCall === 'all') {
      if (failRuneResponseOnCall !== 'all') failRuneResponseOnCall = null;
      await r.fulfill({ status: failRuneResponseOnCall === 'all' ? 500 : 503,
        contentType: 'application/json', body: '[]' });
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
  const joinBodies = [];
  let joinUnavailable = false, joinIncompatible = false;
  await page.route('**/functions/v1/pvp-join', (r) => {
    joinCalls++;
    joinBodies.push(r.request().postDataJSON() ?? null);
    if (joinIncompatible) {
      return r.fulfill({ status: 409, contentType: 'application/json',
        body: '{"error":"incompatible-client"}' });
    }
    if (joinUnavailable) {
      return r.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"queued"}' });
  });
  await page.route('**/rest/v1/rpc/leave_ranked_queue', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"status":"left"}',
  }));
  /* Both read the same board: the standing is derived from the rows the
     leaderboard serves, never restated beside them. */
  const profileRoutes = await installProfileRoutes(page, {
    hold, nearBottomBoard, historyDepth, standingPoints, reportedStandingPoints, standingPeak,
    historicalSilverReached, deferStanding, failStanding, emptyStanding, refuseStandingOnce,
    failLadder, failStreak, failHistory,
  });
  const ladder = await installLadderRoutes(page, { hold, nearBottomBoard, paginationRace });
  await page.route('**/auth/v1/.well-known/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"keys":[]}' }));
  await page.route('**/rest/v1/rpc/current_season*', async (r) => {
    await hold(.55);
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: '"11111111-1111-4111-8111-111111111111"' });
  });
  let rankedStatus = progressionStatus ?? {
    curve_version: 1,
    scoring_version: 1,
    admission_paused: false,
    outcomes: [
      'classic', 'singlestrike', 'colshield', 'limited',
      'rowswitch', 'rowmult', 'bounty', 'rune_trial',
    ],
    weekly_unlocked: false,
    pending_bot_debuts: [],
    neon_medal_seasons: [],
    weekly: null,
  };
  let progressionStatusUnavailable = false;
  let curveVersionUnavailable = failCurveVersion;
  await page.route('**/rest/v1/rpc/active_ranked_curve_version*', (r) => r.fulfill(
    curveVersionUnavailable
      ? { status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' }
      : {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(rankedStatus.curve_version),
      },
  ));
  await page.route('**/rest/v1/rpc/ranked_progression_status*', (r) => r.fulfill(
    progressionStatusUnavailable
      ? { status: 503, contentType: 'application/json', body: '{"message":"unavailable"}' }
      : { status: 200, contentType: 'application/json', body: JSON.stringify(rankedStatus) },
  ));
  return {
    ...profileRoutes,
    ...identityRoutes,
    ...appleRoutes,
    ...ladder,
    signupCalls: () => signupCalls,
    deferNextSignupResponse: () => { deferNextSignup = true; },
    signupRequestStarted,
    releaseSignupResponse: () => releaseSignupRequest(),
    signupRequestFinished,
    passwordCalls: () => passwordCalls,
    profileCalls: () => profileCalls,
    setProfileAccountId: (accountId) => { profileAccountId = accountId; },
    setProfileNickname: (nickname) => { profileNickname = nickname; },
    tierProfileCalls: () => tierProfileCalls,
    equippedProfileCalls: () => equippedProfileCalls,
    randomModeProfileCalls: () => randomModeProfileCalls,
    failNextEquipmentWrite: () => { failNextEquipmentWrite = true; },
    failNextAvatarWrite: () => { failNextAvatarWrite = true; },
    deferNextEquipmentWrite: () => { deferNextEquipmentWrite = true; },
    equipmentWriteStarted,
    releaseEquipmentWrite: () => releaseEquipmentWrite(),
    equipmentWriteFinished,
    joinCalls: () => joinCalls,
    joinBodies: () => [...joinBodies],
    setJoinUnavailable: (value) => { joinUnavailable = value; },
    setJoinIncompatible: (value) => { joinIncompatible = value; },
    setProgressionStatus: (value) => { rankedStatus = value; },
    setProgressionStatusUnavailable: (value) => { progressionStatusUnavailable = value; },
    setCurveVersionUnavailable: (value) => { curveVersionUnavailable = value; },
    runeCalls: () => runeCalls,
    acknowledgeCalls: () => acknowledgeCalls,
    deferNextRuneResponse: () => { deferNextRune = true; },
    failRuneResponseOnCall: (call) => { failRuneResponseOnCall = call; },
    runeRequestStarted,
    releaseRuneResponse: () => releaseRuneRequest(),
    runeRequestFinished,
    deferNextAccountProfileResponse: () => { deferNextAccountProfile = true; },
    failNextAccountProfileResponse: () => { failNextAccountProfile = true; },
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
    setRuneState: (nextRunes, nextEquippedRune, nextRandomMode = false) => {
      collectedRunes.splice(0, collectedRunes.length, ...nextRunes);
      seenRunes.clear();
      nextRunes.forEach((runeId) => seenRunes.add(runeId));
      currentEquippedRune = nextEquippedRune;
      currentRandomRuneMode = nextRandomMode;
    },
  };
}
