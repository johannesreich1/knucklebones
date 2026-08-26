export async function installOnlineRoutes(
  page,
  {
    anonymous,
    attached,
    authDelay = 0,
    dataDelay = 0,
    door,
    named,
    ladderNearBottom = false,
    paginationRace = false,
    passwordAuth = 'error',
    runes = [],
    unseenRunes = [],
    markRunesSeenAfterFirstRead = false,
    SESSION,
    GUEST_ID,
  },
) {
  let signupCalls = 0;
  let passwordCalls = 0;
  let profileCalls = 0;
  let tierProfileCalls = 0;
  let leaderboardCalls = 0;
  let runeCalls = 0;
  let acknowledgeCalls = 0;
  let deferNextSignup = false;
  let markSignupRequestStarted;
  let releaseSignupRequest;
  let markSignupRequestFinished;
  const collectedRunes = [...runes];
  const seenRunes = new Set(runes.filter((runeId) => !unseenRunes.includes(runeId)));
  let deferNextRune = false;
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
  let markPaginationStarted;
  let releasePagination;
  const paginationStarted = new Promise((resolve) => { markPaginationStarted = resolve; });
  const paginationRelease = new Promise((resolve) => { releasePagination = resolve; });
  const hold = (share = 1) => dataDelay > 0
    ? new Promise((resolve) => setTimeout(resolve, dataDelay * share))
    : Promise.resolve();
  const nearBottomBoard = ladderNearBottom
    ? Array.from({ length: 151 }, (_, index) => {
      const rank = index + 1;
      const points = 610 - rank;
      const mine = rank === 145;
      return {
        nickname: mine ? 'TestGuest001' : `Player${String(rank).padStart(3, '0')}`,
        points,
        wins: mine ? 42 : rank % 17,
        losses: mine ? 61 : rank % 13,
        games: mine ? 103 : rank % 17 + rank % 13,
        rank,
        apex: rank === 1,
        avatar: mine ? 'die:5:cy' : null,
        peak: mine ? 700 : points + 20,
      };
    })
    : null;
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
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) })
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
     0026's trigger stamps it server-side), and every later GET tells the
     claimed truth — nickname included */
  let claimed = named;
  await page.route('**/rest/v1/profiles*', async (r) => {
    if (r.request().method() === 'PATCH') {
      claimed = true;
      return r.fulfill({ status: 204, body: '' });
    }
    const tierRead = r.request().url().includes('ranked_pool_tier');
    const deferred = !tierRead && deferNextAccountProfile;
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
    profileCalls++;
    const response = r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: GUEST_ID, nickname: claimed && door === 'claim' ? 'NeonKing77' : 'TestGuest001',
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
  await page.route('**/rest/v1/matches*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/functions/v1/pvp-join', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"status":"queued"}',
  }));
  await page.route('**/functions/v1/identity-status', (r) => r.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      gameCenterLinked: false,
      appleLinked: false,
      appleRevocationReady: false,
    }),
  }));
  await page.route('**/rest/v1/rpc/leave_ranked_queue', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: '{"status":"left"}',
  }));
  await page.route('**/auth/v1/.well-known/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"keys":[]}' }));
  await page.route('**/rest/v1/rpc/current_season*', async (r) => {
    await hold(.55);
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: '"11111111-1111-4111-8111-111111111111"' });
  });
  await page.route('**/rest/v1/season_ratings*', async (r) => {
    await hold(.65);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { points: 465, peak: 700, wins: 42, losses: 61, draws: 0 },
    ]) });
  });
  await page.route('**/rest/v1/rpc/player_standing*', async (r) => {
    await hold(.7);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      /* Rank 2 of 199 is just outside floor(1%): this must agree with the
         leaderboard row's apex:false so both surfaces resolve BONE. */
      ladderNearBottom
        ? { points: 465, rank: 145, population: 151, percentile: 96 }
        : { points: 465, rank: 2, population: 199, percentile: 1 },
    ]) });
  });
  await page.route('**/rest/v1/rpc/best_streak*', async (r) => {
    await hold(.8);
    return r.fulfill({ status: 200, contentType: 'application/json', body: '4' });
  });
  /* Deliberately last during loading probes: the profile must keep its die up
     after identity and ladder facts have arrived, rather than revealing rows
     one endpoint at a time. */
  await page.route('**/rest/v1/rpc/match_history*', async (r) => {
    await hold(1);
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: '00000000-0000-4000-8000-000000000003', finished_at: '2026-08-21T12:00:00Z',
        opponent: 'NovaComet992', mode: 'classic', mine: 47, theirs: 31, delta: 21, result: 'win' },
      { id: '00000000-0000-4000-8000-000000000002', finished_at: '2026-08-20T12:00:00Z',
        opponent: 'ZestyPixel950', mode: 'classic', mine: 22, theirs: 38, delta: -14, result: 'loss' },
      { id: '00000000-0000-4000-8000-000000000001', finished_at: '2026-08-19T12:00:00Z',
        opponent: 'BoldRaven393', mode: 'classic', mine: 29, theirs: 29, delta: 12, result: 'draw' },
    ]) });
  });
  /* the 0022 shape: points/rank/apex/avatar/peak. The two rows sit in
     DIFFERENT groups (1,072 is IVORY, 465 is BONE) so the board has to draw a
     horizon for each — the group structure is asserted below. */
  await page.route('**/rest/v1/rpc/leaderboard*', async (r) => {
    await hold(1);
    const before = r.request().url().includes('/rpc/leaderboard_before');
    const ordinary = [
      { nickname: 'NovaComet992', points: 1072, wins: 7, losses: 2, games: 9, rank: 1, apex: false, avatar: 'die:3:mg', peak: 1100 },
      { nickname: 'TestGuest001', points: 465, wins: 42, losses: 61, games: 103, rank: 2, apex: false, avatar: 'die:5:cy', peak: 700 },
    ];
    let board;
    if (nearBottomBoard) {
      const args = r.request().postDataJSON() ?? {};
      const limit = Number(args.limit_n ?? 50);
      if (before) {
        const boundary = Number(args.before_rank ?? 1);
        const nickname = String(args.before_nickname ?? '');
        board = nearBottomBoard.filter((row) => row.rank < boundary
          || (row.rank === boundary && row.nickname < nickname)).slice(-limit);
      } else {
        const boundary = Number(args.from_rank ?? 1);
        const nickname = typeof args.after_nickname === 'string' ? args.after_nickname : null;
        board = nearBottomBoard.filter((row) => nickname
          ? row.rank > boundary || (row.rank === boundary && row.nickname > nickname)
          : row.rank >= boundary).slice(0, limit);
      }
    } else {
      board = before ? [] : ordinary;
    }
    let headers;
    if (paginationRace && !before) {
      leaderboardCalls++;
      if (leaderboardCalls === 1) {
        board = [...ordinary, ...Array.from({ length: 48 }, (_, index) => ({
          nickname: `RunA${String(index + 3).padStart(2, '0')}`,
          points: 460 - index,
          wins: 1,
          losses: 1,
          games: 2,
          rank: index + 3,
          apex: false,
          avatar: null,
          peak: 460 - index,
        }))];
      } else if (leaderboardCalls === 2) {
        markPaginationStarted();
        await paginationRelease;
        board = [{
          nickname: 'StaleRunA', points: 100, wins: 1, losses: 2, games: 3,
          rank: 51, apex: false, avatar: null, peak: 100,
        }];
        headers = { 'x-kb-fixture': 'stale-run-a' };
      }
    }
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      ...(headers ? { headers } : {}),
      body: JSON.stringify(board),
    });
  });
  await page.route('**/rest/v1/rpc/player_card*', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{
      streak: 4,
      since: '2026-06-01T00:00:00Z',
      points: 1072,
      wins: 7,
      losses: 2,
      games: 9,
      rank: 1,
      apex: false,
      peak: 1100,
    }]) }));
  return {
    signupCalls: () => signupCalls,
    deferNextSignupResponse: () => { deferNextSignup = true; },
    signupRequestStarted,
    releaseSignupResponse: () => releaseSignupRequest(),
    signupRequestFinished,
    passwordCalls: () => passwordCalls,
    profileCalls: () => profileCalls,
    tierProfileCalls: () => tierProfileCalls,
    runeCalls: () => runeCalls,
    acknowledgeCalls: () => acknowledgeCalls,
    deferNextRuneResponse: () => { deferNextRune = true; },
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
    paginationStarted,
    releasePagination: () => releasePagination(),
  };
}
