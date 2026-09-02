const DAY_MS = 24 * 60 * 60 * 1000;
const statusWithWeekly = ({
  rotationId,
  starts,
  modifier,
  completed,
}) => Object.freeze({
  curve_version: 2,
  scoring_version: 2,
  admission_paused: false,
  outcomes: [
    'classic', 'singlestrike', 'colshield', 'bounty',
    'rowmult', 'rune_trial', 'rowswitch', 'limited',
  ],
  weekly_unlocked: true,
  pending_bot_debuts: [],
  neon_medal_seasons: [1, 3],
  weekly: {
    rotation_id: rotationId,
    starts_at: new Date(starts).toISOString(),
    ends_at: new Date(starts + 7 * DAY_MS).toISOString(),
    modifier,
    completed,
  },
});

const fixtureNow = Date.now();
const V2_STATUS = statusWithWeekly({
  rotationId: '77777777-7777-4777-8777-777777777777',
  starts: fixtureNow - DAY_MS,
  modifier: 'rowswitch',
  completed: true,
});
const EXPIRED_STATUS = statusWithWeekly({
  rotationId: '66666666-6666-4666-8666-666666666666',
  starts: fixtureNow - 7 * DAY_MS - 60_000,
  modifier: 'rowswitch',
  completed: true,
});
const NEXT_STATUS = statusWithWeekly({
  rotationId: '88888888-8888-4888-8888-888888888888',
  starts: fixtureNow - 60_000,
  modifier: 'limited',
  completed: false,
});

const WEEKLY_REPORT = {
  won: true,
  draw: false,
  forfeit: false,
  my: 44,
  their: 31,
  delta: 23,
  baseDelta: 20,
  finishDelta: 3,
  scoringVersion: 2,
  entryKind: 'weekly',
  opp: 'WeeklyBot',
  oppAvatar: null,
  oppRating: 3200,
};

async function probeAchievementsAndWeeklyEntry(page, routes) {
  const achievements = await page.evaluate(() => {
    const read = (id) => {
      const element = document.getElementById(id);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        hidden: element.hidden,
        text: element.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        display: getComputedStyle(element).display,
        width: +box.width.toFixed(1),
        height: +box.height.toFixed(1),
      };
    };
    return {
      section: read('accAchievements'),
      weekly: read('accWeeklyMark'),
      medals: read('accNeonMedals'),
    };
  });

  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on');
  await page.waitForFunction(() => document.getElementById('btnWeekly')?.hidden === false);
  const home = await page.evaluate(() => {
    const button = document.getElementById('btnWeekly');
    const box = button?.getBoundingClientRect();
    return {
      hidden: button?.hidden,
      text: button?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      complete: button?.classList.contains('complete') ?? false,
      width: box ? +box.width.toFixed(1) : 0,
      height: box ? +box.height.toFixed(1) : 0,
    };
  });
  await page.click('#btnWeekly');
  const deadline = Date.now() + 15000;
  while (routes.joinCalls() < 1) {
    if (Date.now() >= deadline) throw new Error('weekly entry never reached pvp-join');
    await page.waitForTimeout(25);
  }
  const join = routes.joinBodies().at(-1);
  if (await page.locator('#btnQueueCancel').isVisible()) await page.click('#btnQueueCancel');
  await page.waitForSelector('#ovStart.on');

  /* A completed rotation remains durable history, but once its half-open
     window ends it is neither the Home entry nor the Profile's CURRENT weekly
     mark. Refresh that stale snapshot through the real Account path. */
  routes.setProgressionStatus(EXPIRED_STATUS);
  await page.click('#homeChip');
  await page.waitForSelector('#onAccount:not([hidden])');
  const expiredProfileHidden = await page.locator('#accWeeklyMark').evaluate((element) =>
    element.hidden);
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on');
  const expiredHomeHidden = await page.locator('#btnWeekly').evaluate((element) => element.hidden);

  /* Stage the just-finished old rotation, then cross the boundary while its
     result is foregrounded. Replay must state the refreshed LIMITED rotation
     on the searching screen before the first weekly join request. */
  routes.setProgressionStatus(V2_STATUS);
  await page.click('#homeChip');
  await page.waitForSelector('#onAccount:not([hidden])');
  await page.click('#btnOnlineBack');
  await page.waitForSelector('#ovStart.on');
  await page.evaluate((report) => {
    document.getElementById('ovStart').classList.remove('on');
    window.__kbResult(report);
  }, WEEKLY_REPORT);
  await page.waitForSelector('#ovEnd.on');
  routes.setProgressionStatus(NEXT_STATUS);
  const joinsBeforeBoundary = routes.joinCalls();
  await page.click('#btnAgain');
  const boundaryDeadline = Date.now() + 15000;
  while (routes.joinCalls() === joinsBeforeBoundary) {
    if (Date.now() >= boundaryDeadline) throw new Error('weekly boundary replay never joined');
    await page.waitForTimeout(25);
  }
  const boundary = {
    queueCopy: await page.locator('#qSub').textContent(),
    join: routes.joinBodies().at(-1),
  };
  if (await page.locator('#btnQueueCancel').isVisible()) await page.click('#btnQueueCancel');
  await page.waitForSelector('#ovStart.on');

  /* Even with NEXT_STATUS still cached and active, a failed fresh replay
     verification must stop on the retryable connection sheet without joining. */
  routes.setProgressionStatusUnavailable(true);
  await page.evaluate((report) => {
    document.getElementById('ovStart').classList.remove('on');
    window.__kbResult(report);
  }, WEEKLY_REPORT);
  await page.waitForSelector('#ovEnd.on');
  const joinsBeforeFailure = routes.joinCalls();
  await page.click('#btnAgain');
  await page.waitForSelector('#ovAsk.on');
  const refreshFailure = await page.evaluate((joinsBefore) => ({
    title: document.getElementById('askHead')?.textContent?.trim() ?? '',
    body: document.getElementById('askBody')?.textContent?.trim() ?? '',
    joinsBefore,
  }), joinsBeforeFailure);
  refreshFailure.joinsAfter = routes.joinCalls();
  routes.setProgressionStatusUnavailable(false);
  await page.click('#btnAskNo');

  return {
    achievements,
    home,
    join,
    expired: { profileHidden: expiredProfileHidden, homeHidden: expiredHomeHidden },
    boundary,
    refreshFailure,
  };
}

export async function runAccountAchievementsWeeklyScenarios({ visit, out, check }) {
  const shown = await visit({
    named: true,
    skipStandardProbes: true,
    returnAfterProbe: true,
    progressionStatus: V2_STATUS,
    initScript: () => localStorage.setItem(
      'knucklebones.v1',
      JSON.stringify({ played: true }),
    ),
    probe: probeAchievementsAndWeeklyEntry,
  });
  const result = shown.probeResult;
  out.accountAchievementsWeekly = result;
  check(result?.achievements.section?.hidden === false
    && result.achievements.section.display !== 'none'
    && result.achievements.weekly?.hidden === false
    && result.achievements.weekly.width > 0
    && result.achievements.weekly.height > 0
    && result.achievements.weekly.text.includes('WEEKLY COMPLETE')
    && result.achievements.medals?.hidden === false
    && result.achievements.medals.width > 0
    && result.achievements.medals.text === '2 NEON SEASON MEDALS',
  'profile did not visibly paint the current weekly mark and durable NEON medals',
  result?.achievements);
  check(result?.home.hidden === false
    && result.home.width >= 44 && result.home.height >= 44
    && result.home.complete === true
    && result.home.text.includes('Weekly complete')
    && result.home.text.includes('ROW SWITCH'),
  'the completed weekly challenge was not a visible, labelled Home entry', result?.home);
  check(result?.join?.entry_kind === 'weekly'
    && result.join.curve_version === 2
    && result.join.capabilities?.includes('curve_v2')
    && result.join.capabilities?.includes('rune_trial_claim_v2'),
  'the weekly door did not preserve its v2 entry/capability contract', result?.join);
  check(result?.expired?.profileHidden === true && result.expired.homeHidden === true,
    'an expired weekly rotation remained visible as the current Home/Profile challenge',
    result?.expired);
  check(result?.boundary?.join?.entry_kind === 'weekly'
    && result.boundary.join.curve_version === 2
    && result.boundary.queueCopy?.includes('LIMITED')
    && !result.boundary.queueCopy.includes('ROW SWITCH'),
  'weekly replay crossed the boundary without stating the freshly verified mode before joining',
  result?.boundary);
  check(result?.refreshFailure?.title === 'CAN’T CONNECT'
    && result.refreshFailure.joinsAfter === result.refreshFailure.joinsBefore,
  'a failed fresh weekly refresh joined from stale cache or silently bounced Home',
  result?.refreshFailure);
  check(shown.errs.length === 0, 'page errors on the achievements/weekly path', shown.errs);
}
