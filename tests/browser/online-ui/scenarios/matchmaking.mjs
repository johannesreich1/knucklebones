/* Ranked entry must paint the searching queue IMMEDIATELY — identity,
   preference, and rune-collection checks all run behind it. Hold each of those
   stubs and assert what the player is watching in the meantime; releasing them
   must continue the SAME visible clock into the join loop. */
async function searchBeforeIdentityProbe(page, routes) {
  /* A returning device: the tutorial offer must not intercept this entry. */
  await page.evaluate(() => { window.__kb.S.played = true; });
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  let releaseSettings;
  const settingsGate = new Promise((resolve) => { releaseSettings = resolve; });
  await page.route('**/rest/v1/player_settings*', async (r) => {
    await settingsGate;
    return r.fulfill({ status: r.request().method() === 'GET' ? 200 : 201,
                       contentType: 'application/json', body: '[]' });
  });
  routes.deferNextSignupResponse();
  routes.deferNextRuneResponse();
  let joinRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/functions/v1/pvp-join')) joinRequests++;
  });
  await page.evaluate(() => {
    window.__searchEntry = { frames: 0, loadingFrames: 0, times: [] };
    const sample = () => {
      const report = window.__searchEntry;
      if (report.done) return;
      if (document.getElementById('ovOnline')?.classList.contains('on')) {
        report.frames++;
        const die = document.getElementById('onLoading');
        if (die && !die.hidden && die.getClientRects().length) report.loadingFrames++;
        const time = document.getElementById('qTime')?.textContent ?? '';
        if (time !== report.times[report.times.length - 1]) report.times.push(time);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.click('#btnOnline');
  await Promise.race([
    routes.signupRequestStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'play entry never started its deferred identity request',
    )), 5000)),
  ]);
  const beforeIdentity = await page.evaluate(() => {
    const queuePanel = document.getElementById('onQueue');
    return {
      queueVisible: !!queuePanel && !queuePanel.hidden && queuePanel.getClientRects().length > 0,
      looking: document.querySelector('#onQueue .qmsg')?.textContent?.trim() ?? null,
      title: document.getElementById('onTitle')?.textContent ?? null,
      loadingHidden: document.getElementById('onLoading')?.hidden === true,
    };
  });
  /* Let the visible clock tick past a second before anything resolves. */
  await page.waitForFunction(() => document.getElementById('qTime')?.textContent !== '0:00',
    null, { timeout: 5000 });
  routes.releaseSignupResponse();
  await routes.signupRequestFinished;
  await page.waitForTimeout(300);
  const behindChecks = await page.evaluate(() => ({
    queueVisible: document.getElementById('onQueue')?.hidden === false,
    time: document.getElementById('qTime')?.textContent ?? null,
  }));
  const joinsBeforeChecks = joinRequests;
  const joined = page.waitForRequest(
    (request) => request.url().includes('/functions/v1/pvp-join'), { timeout: 15000 });
  routes.releaseRuneResponse();
  releaseSettings();
  await joined;
  const afterJoin = await page.evaluate(() => {
    const report = window.__searchEntry;
    report.done = true;
    return {
      queueVisible: document.getElementById('onQueue')?.hidden === false,
      looking: document.querySelector('#onQueue .qmsg')?.textContent?.trim() ?? null,
      loadingHidden: document.getElementById('onLoading')?.hidden === true,
      time: document.getElementById('qTime')?.textContent ?? null,
      entry: report,
    };
  });
  await page.click('#btnQueueCancel');
  return { beforeIdentity, behindChecks, joinsBeforeChecks, afterJoin };
}

/* Cancel while the entry checks are STILL held: the queue panel's cancel must
   exit cleanly before start() ever ran — Home wins, the released identity
   continuation is dropped by the revision guard, and no queue cleanup fires
   because nothing was enqueued. A fresh search afterwards starts at 0:00. */
async function precheckCancelProbe(page, routes) {
  await page.evaluate(() => { window.__kb.S.played = true; });
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  routes.deferNextSignupResponse();
  let joins = 0;
  let leaves = 0;
  page.on('request', (request) => {
    if (request.url().includes('/functions/v1/pvp-join')) joins++;
    if (request.url().includes('/rpc/leave_ranked_queue')) leaves++;
  });
  await page.click('#btnOnline');
  await Promise.race([
    routes.signupRequestStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      'the pre-check cancel entry never started its deferred identity request',
    )), 5000)),
  ]);
  const held = await page.evaluate(() => ({
    queueVisible: document.getElementById('onQueue')?.hidden === false,
    time: document.getElementById('qTime')?.textContent ?? null,
  }));
  await page.click('#btnQueueCancel');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  routes.releaseSignupResponse();
  await routes.signupRequestFinished;
  await page.waitForTimeout(1100);
  const after = {
    ...await page.evaluate(() => ({
      homeOn: document.getElementById('ovStart')?.classList.contains('on'),
      onlineOn: document.getElementById('ovOnline')?.classList.contains('on'),
    })),
    joins,
    leaves,
  };
  await page.click('#btnOnline');
  await page.waitForSelector('#onQueue:not([hidden])', { timeout: 15000 });
  const reentry = await page.evaluate(() =>
    ({ time: document.getElementById('qTime')?.textContent ?? null }));
  await page.click('#btnQueueCancel');
  return { held, after, reentry };
}

export async function runMatchmakingScenarios(suite) {
  const { visit, out, check } = suite;
  const queued = await visit({ door: 'play' });
  const samples = queued.queueLabel ?? [];
  out.matchmakingLabel = samples;

  check(samples.length === 4 && samples.every((sample) =>
    sample.label === 'Looking for an opponent'),
  'the matchmaking wait no longer says the intended label', samples);
  check(samples.every((sample) => sample.labelAnimation === 'none'),
    'the matchmaking label is animating again', samples);
  check(samples.every((sample) => !sample.pseudoContent.includes('.')),
    'the matchmaking label is generating trailing dots again', samples);
  check(samples.every((sample) => sample.dieAnimation === 'qspin'),
    'removing the label animation also stopped the waiting dice', samples);
  check(queued.queueCancel?.label === 'Cancel'
    && queued.queueCancel.textTransform === 'uppercase'
    && queued.queueCancel.clipped === false,
  'the English matchmaking cancel action is not concise and fully visible', queued.queueCancel);
  check(queued.errs.length === 0, 'page errors on the matchmaking queue', queued.errs);

  const german = await visit({ door: 'play', locale: 'de-DE' });
  out.matchmakingGerman = { samples: german.queueLabel, lang: german.rootLang };
  check(german.rootLang === 'de' && german.queueLabel?.every((sample) =>
    sample.label === 'Gegner wird gesucht'),
  'the online queue did not follow the German browser language', out.matchmakingGerman);
  check(german.queueCancel?.label === 'Abbrechen'
    && german.queueCancel.textTransform === 'uppercase'
    && german.queueCancel.clipped === false,
  'the German matchmaking action should display only ABBRECHEN', german.queueCancel);
  check(german.errs.length === 0, 'page errors on the German matchmaking queue', german.errs);

  const held = await visit({ door: 'board', skipStandardProbes: true,
    probe: searchBeforeIdentityProbe });
  out.matchmakingBeforeIdentity = held.probeResult;
  const h = held.probeResult;
  const seconds = (time) => {
    const [minutes, rest] = String(time ?? '').split(':');
    return Number(minutes) * 60 + Number(rest);
  };
  check(h?.beforeIdentity.queueVisible && h.beforeIdentity.looking === 'Looking for an opponent'
    && h.beforeIdentity.title === 'MATCHMAKING' && h.beforeIdentity.loadingHidden,
  'play entry did not show the searching queue before identity resolved', h?.beforeIdentity);
  check(h?.joinsBeforeChecks === 0 && h.behindChecks.queueVisible
    && seconds(h.behindChecks.time) >= 1,
  'the preference/collection wait did not stay behind the searching queue', h);
  check(h?.afterJoin.queueVisible && h.afterJoin.looking === 'Looking for an opponent'
    && h.afterJoin.loadingHidden && seconds(h.afterJoin.time) >= seconds(h.behindChecks.time),
  'reaching the join loop reset or replaced the searching queue', h?.afterJoin);
  check(h?.afterJoin.entry.frames > 0 && h.afterJoin.entry.loadingFrames === 0,
    'the loading die appeared during play entry', h?.afterJoin.entry);
  check((h?.afterJoin.entry.times ?? ['missing']).every((time, index, all) =>
    index === 0 ? time === '0:00' : seconds(time) >= seconds(all[index - 1])),
  'the visible queue timer restarted or jumped backwards during entry', h?.afterJoin.entry);
  check(held.errs.length === 0,
    'page errors while the searching queue covered entry checks', held.errs);

  const precheck = await visit({ door: 'board', skipStandardProbes: true,
    probe: precheckCancelProbe });
  out.matchmakingPrecheckCancel = precheck.probeResult;
  const p = precheck.probeResult;
  check(p?.held.queueVisible && p.held.time === '0:00'
    && p.after.homeOn && !p.after.onlineOn && p.after.joins === 0 && p.after.leaves === 0,
  'cancelling during the held entry checks left queue side effects or a live continuation', p);
  check(p?.reentry.time === '0:00',
    'a fresh search after a pre-check cancel adopted the cancelled display clock', p?.reentry);
  check(precheck.errs.length === 0, 'page errors during the pre-check cancel', precheck.errs);
}
