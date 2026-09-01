// A mandatory result-origin guide belongs to the account that earned it.
// Switching sessions while Profile loads must cancel back to the result,
// never teach account B with account A's progression or reward.
import { installProgressionRoutes, showTransitionResult } from './group-transition-harness.mjs';
import { PROGRESSION, REPORT } from './group-transition-fixtures.mjs';

const ACCOUNT_B = '11111111-2222-4333-8444-555555555555';
const MATCH_ID = '90000000-0000-4000-8000-000000000099';

async function switchStoredAccount(page, routes) {
  routes.setProfileAccountId(ACCOUNT_B);
  return page.evaluate(async (accountId) => {
    const key = Object.keys(localStorage)
      .find((candidate) => candidate.startsWith('sb-') && candidate.endsWith('-auth-token'));
    if (!key) return false;
    const stored = JSON.parse(localStorage.getItem(key));
    const session = stored?.currentSession ?? stored;
    if (!session?.user) return false;
    const encode = (value) => btoa(JSON.stringify(value))
      .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
    const payload = { sub: accountId, aud: 'authenticated', role: 'authenticated',
      is_anonymous: true, exp: Math.floor(Date.now() / 1000) + 3600 };
    session.access_token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.stub`;
    session.refresh_token = 'account-b-refresh-stub';
    session.user.id = accountId;
    localStorage.setItem(key, JSON.stringify(stored));
    /* Stand in for a real cross-tab replacement, including the auth client's
       state-change signal rather than relying on a same-document storage edit. */
    if ('BroadcastChannel' in globalThis) {
      const channel = new BroadcastChannel(key);
      channel.postMessage({ event: 'SIGNED_IN', session });
      channel.close();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return true;
  }, ACCOUNT_B);
}

async function accountSwitchProbe(page, routes) {
  const progression = await installProgressionRoutes(page, {
    id: '91000000-0000-4000-8000-000000000099',
    source_match_id: MATCH_ID,
    points_before: 1240,
    points_after: 1300,
    apex_before: false,
    apex_after: false,
    pool_tier_before: 'ivory',
    pool_tier_after: 'ivory',
    equipped_rune_before: null,
    equipped_rune_after: null,
    random_rune_mode_before: false,
    random_rune_mode_after: false,
    rune_seat_active_before: false,
    rune_seat_active_after: true,
    curve_version: 1,
    outcome_grants: [],
    weekly_unlocked_before: false,
    weekly_unlocked_after: false,
    neon_medal_granted: false,
    seen_at: null,
  });
  await showTransitionResult(page, {
    matchId: MATCH_ID,
    won: true,
    draw: false,
    forfeit: false,
    my: 48,
    their: 31,
    delta: 60,
    opp: 'NovaComet992',
    oppAvatar: 'die:3:mg',
    oppRating: 1072,
  });
  await page.click('#gtNext');
  const switched = await switchStoredAccount(page, routes);
  await page.click('#gtNext');
  await page.waitForFunction(() => !document.getElementById('ovOnline')?.classList.contains('on'));
  return {
    switched,
    progressionAcks: progression.acknowledgements.length,
    guideOpen: !!await page.$('#accRuneGuide'),
    resultOpen: await page.$eval('#ovEnd', (element) => element.classList.contains('on')),
    resultInert: await page.$eval('#ovEnd', (element) => element.inert),
    onlineOpen: await page.$eval('#ovOnline', (element) => element.classList.contains('on')),
  };
}

async function rewardAccountSwitchProbe(page, routes) {
  const progression = await installProgressionRoutes(page, {
    ...PROGRESSION,
    id: '91000000-0000-4000-8000-000000000098',
    source_match_id: '90000000-0000-4000-8000-000000000098',
  });
  routes.makeRuneUnseen('ward');
  await showTransitionResult(page, {
    ...REPORT,
    matchId: '90000000-0000-4000-8000-000000000098',
  });
  const switched = await switchStoredAccount(page, routes);
  for (let slide = 0; slide < 4; slide++) await page.click('#gtNext');
  await page.waitForFunction(() =>
    !document.getElementById('ovGroupTransition')?.classList.contains('on'));
  await page.waitForTimeout(300);
  return {
    switched,
    progressionAcks: progression.acknowledgements.length,
    rewardSheetOpen: !!await page.$('.rune-reward-sheet'),
    inlineRewardVisible: await page.$eval('#endFeature', (element) => !element.hidden),
    resultOpen: await page.$eval('#ovEnd', (element) => element.classList.contains('on')),
    resultInert: await page.$eval('#ovEnd', (element) => element.inert),
  };
}

export async function runGroupTransitionAccountRaceScenarios({ visit, out, check }) {
  const result = await visit({
    named: true,
    runes: ['ward'],
    standingPoints: 1300,
    skipStandardProbes: true,
    probe: accountSwitchProbe,
  });
  out.groupTransitionAccountSwitch = result.probeResult;
  const seen = result.probeResult;
  check(seen?.switched && seen.progressionAcks === 0 && !seen.guideOpen
      && seen.resultOpen && !seen.resultInert && !seen.onlineOpen,
    'account B inherited account A\'s mandatory SILVER guide', seen);
  check(result.errs.length === 0,
    'page errors during result-origin guide account switch', result.errs);

  const reward = await visit({
    named: true,
    runes: [],
    skipStandardProbes: true,
    probe: rewardAccountSwitchProbe,
  });
  out.groupTransitionRewardAccountSwitch = reward.probeResult;
  const rewardSeen = reward.probeResult;
  check(rewardSeen?.switched && rewardSeen.progressionAcks === 1
      && !rewardSeen.rewardSheetOpen && !rewardSeen.inlineRewardVisible
      && rewardSeen.resultOpen && !rewardSeen.resultInert,
    'account B inherited account A\'s captured rune reward after the mandatory deck',
    rewardSeen);
  check(reward.errs.length === 0,
    'page errors during transition reward account switch', reward.errs);
}
