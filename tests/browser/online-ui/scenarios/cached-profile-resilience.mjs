import { runStandingAccountSwitchScenario } from './standing-account-switch.mjs';
import { runProfileCacheBoundaryScenarios } from './profile-cache-boundaries.mjs';

export const seedCompleteProfile = () => {
  const accountId = '00000000-0000-4000-8000-00000000beef';
  localStorage.setItem('knucklebones.online.profile', JSON.stringify({
    accountId,
    nickname: 'CachedPlayer',
    rating: 321,
    avatar: 'die:5:cy',
    rank: 17,
    apex: false,
    curveVersion: 2,
  }));
  localStorage.setItem('knucklebones.online.account-profile', JSON.stringify({
    version: 2,
    accountId,
    verifiedAt: 1,
    profile: {
      id: accountId,
      nickname: 'CachedPlayer',
      rating: 321,
      created_at: null,
      avatar: 'die:5:cy',
      named_at: null,
    },
    user: { id: accountId, guest: true, email: null },
    ladder: {
      points: 321,
      peak: 500,
      wins: 2,
      losses: 1,
      draws: 0,
      runeSeatUnlocked: false,
    },
    standing: { points: 321, rank: 17, population: 199, percentile: 9 },
    standingKnown: true,
    curveVersion: 2,
    streak: 9,
    recent: [{
      id: 'cached-match',
      when: '2026-08-20T00:00:00Z',
      opponent: 'CachedOpponent',
      mode: 'classic',
      mine: 21,
      theirs: 18,
      delta: 12,
      baseDelta: 12,
      finishDelta: 0,
      scoringVersion: 2,
      result: 'win',
    }],
    identity: {
      gameCenterLinked: false,
      appleLinked: false,
      appleRevocationReady: false,
    },
    runes: [],
    runeRows: [],
    equipment: { kind: 'none' },
  }));
};

/* Playwright serializes init scripts without their module closure. Keep this
   rich seed complete in its own function rather than calling the basic seed. */
const seedRichProfile = () => {
  const accountId = '00000000-0000-4000-8000-00000000beef';
  localStorage.setItem('knucklebones.online.profile', JSON.stringify({
    accountId,
    nickname: 'CachedPlayer',
    rating: 321,
    avatar: 'die:5:cy',
    rank: 17,
    apex: false,
    curveVersion: 2,
  }));
  localStorage.setItem('knucklebones.online.account-profile', JSON.stringify({
    version: 2,
    accountId,
    verifiedAt: 1,
    profile: {
      id: accountId,
      nickname: 'CachedPlayer',
      rating: 321,
      created_at: '2026-08-01T00:00:00Z',
      avatar: 'die:5:cy',
      named_at: '2026-08-02T00:00:00Z',
    },
    user: { id: accountId, guest: false, email: 'cached@example.test' },
    ladder: {
      points: 321,
      peak: 500,
      wins: 2,
      losses: 1,
      draws: 0,
      runeSeatUnlocked: true,
    },
    standing: { points: 321, rank: 17, population: 199, percentile: 9 },
    standingKnown: true,
    curveVersion: 2,
    streak: 9,
    recent: [{
      id: 'cached-match',
      when: '2026-08-20T00:00:00Z',
      opponent: 'CachedOpponent',
      mode: 'classic',
      mine: 21,
      theirs: 18,
      delta: 12,
      baseDelta: 12,
      finishDelta: 0,
      scoringVersion: 2,
      result: 'win',
    }],
    identity: {
      gameCenterLinked: false,
      appleLinked: false,
      appleRevocationReady: false,
    },
    runes: ['fate'],
    runeRows: [{
      rune_id: 'fate',
      collected_at: '2026-08-20T00:00:00Z',
      source_match_id: null,
      seen_at: '2026-08-21T00:00:00Z',
    }],
    equipment: { kind: 'fixed', runeId: 'fate' },
  }));
  /* A different account's independent rune cache must not supply any part
     of this otherwise-complete Profile presentation. */
  localStorage.setItem('knucklebones.runes.v1', JSON.stringify({
    version: 1,
    accountId: '11111111-2222-4333-8444-555555555555',
    verifiedAt: 1,
    collected: ['ward'],
    poolTier: null,
    equippedRune: 'ward',
    randomRuneMode: false,
  }));
};

export async function runCachedProfileResilienceScenarios(suite) {
  const { visit, out, check } = suite;

  await runStandingAccountSwitchScenario(suite, seedCompleteProfile);
  await runProfileCacheBoundaryScenarios(suite, seedCompleteProfile);

  const richCache = await visit({
    preauthenticated: true,
    identityDelay: 1000,
    initScript: seedRichProfile,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: (page) => page.evaluate(() => ({
      memberSince: document.getElementById('accSince')?.textContent?.trim(),
      avatarFace: document.querySelector('#accDie .die')?.getAttribute('data-v'),
      group: document.getElementById('accGroup')?.textContent?.trim(),
      games: document.getElementById('accGames')?.textContent?.trim(),
      claimHidden: document.getElementById('accClaim')?.hidden,
      guestHidden: document.getElementById('accGuest')?.hidden,
      signOutVisible: document.getElementById('btnSignOut')?.hidden === false,
      collectedRunes: document.querySelectorAll('#accRunes .accrune.collected').length,
      seatHidden: document.getElementById('accSeat')?.hidden,
      seatLabel: document.getElementById('accSeat')?.getAttribute('aria-label'),
    })),
  });
  out.onlineLoading.richCache = richCache.probeResult;
  check(richCache.probeResult?.memberSince && richCache.probeResult.avatarFace === '5'
      && richCache.probeResult.group === 'BONE'
      && richCache.probeResult.games?.includes('3')
      && richCache.probeResult.claimHidden && richCache.probeResult.guestHidden
      && richCache.probeResult.signOutVisible
      && richCache.probeResult.collectedRunes === 1
      && !richCache.probeResult.seatHidden
      && /fate/i.test(richCache.probeResult.seatLabel ?? ''),
  'the complete local snapshot did not own every conditional Profile surface',
  richCache.probeResult);
  check(richCache.errs.length === 0,
    'page errors while painting the rich cached Profile', richCache.errs);

  const unavailableRuneAuthority = await visit({
    preauthenticated: true,
    member: true,
    named: true,
    deferStanding: true,
    /* The scenario is an UNAVAILABLE authority. A single failing call still
       leaves an earlier verified-empty read standing, which is authority
       saying "no runes" — a different situation with a different right answer. */
    failRuneOnCall: 'all',
    initScript: seedRichProfile,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      await page.waitForFunction(() => !document.getElementById('onAccount')
        ?.hasAttribute('data-account-pending'));
      const read = () => page.evaluate(() => {
        const seat = document.getElementById('accSeat');
        seat?.click();
        return {
          hidden: seat?.hidden,
          disabled: seat?.disabled,
          label: seat?.getAttribute('aria-label'),
          sheetOpen: !!document.querySelector('.faceoff'),
          cachedEquipment: JSON.parse(localStorage.getItem(
            'knucklebones.online.account-profile') ?? 'null')?.equipment,
          runeAuthority: JSON.parse(localStorage.getItem('knucklebones.runes.v1') ?? 'null'),
        };
      });
      const beforeStanding = await read();
      routes.releaseStanding();
      await routes.standingFinished;
      const afterStanding = await read();
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'languages', {
          configurable: true, get: () => ['de-DE'],
        });
        window.dispatchEvent(new Event('languagechange'));
      });
      await page.waitForFunction(() => document.documentElement.dataset.locale === 'de');
      return { beforeStanding, afterStanding, afterLocale: await read() };
    },
  });
  out.onlineLoading.unavailableRuneAuthority = unavailableRuneAuthority.probeResult;
  const unavailableStates = unavailableRuneAuthority.probeResult
    ? Object.values(unavailableRuneAuthority.probeResult) : [];
  /* The seat must keep NAMING its rune, in the language on screen: the third
     state is read after a switch to German, where FATE is SCHICKSAL. A label
     that fell back to the generic "equipped rune" is the regression. */
  check(unavailableStates.length === 3 && unavailableStates.every((state) => (state.hidden
      || (state.disabled && /fate|schicksal/i.test(state.label ?? ''))) && !state.sheetOpen
      && state.cachedEquipment?.runeId === 'fate'
      && !state.runeAuthority?.collected?.includes('fate')),
  'cached rune facts unlocked an equipment action without matching authority',
  unavailableRuneAuthority.probeResult);

  const failedRank = await visit({
    preauthenticated: true,
    failStanding: true,
    initScript: seedCompleteProfile,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      const profile = await page.evaluate(() => ({
        profileVisible: !document.getElementById('onAccount')?.hidden,
        fullLoaderHidden: document.getElementById('onLoading')?.hidden,
        profileRank: document.getElementById('accRank')?.textContent,
        rankBusy: document.getElementById('btnRank')?.hasAttribute('aria-busy'),
        inlineLoaderGone: !document.querySelector('#accRank .ldclock'),
      }));
      const standingCalls = routes.standingCalls();
      await page.evaluate(() => window.__kbResult({
        won: true, draw: false, forfeit: false, my: 48, their: 31, delta: 21,
        opp: 'NovaComet992', oppAvatar: 'die:3:mg', oppRating: 1072,
      }));
      await page.waitForSelector('#ovEnd.on', { timeout: 5000 });
      const deadline = Date.now() + 5000;
      while (routes.standingCalls() === standingCalls && Date.now() < deadline) {
        await page.waitForTimeout(25);
      }
      await page.waitForTimeout(100);
      const result = await page.evaluate(() => {
        const mine = document.querySelector('#endPlates > :first-child');
        return {
          rankAfterFailedResult: JSON.parse(localStorage.getItem(
            'knucklebones.online.profile') ?? 'null')?.rank,
          name: mine?.querySelector('.nm2')?.textContent,
          resultRank: mine?.querySelector('.gpill')?.textContent,
          points: mine?.querySelector('.meta2 b')?.textContent,
        };
      });
      return { ...profile, ...result };
    },
  });
  out.onlineLoading.failedRank = failedRank.probeResult;
  check(failedRank.probeResult?.profileVisible && failedRank.probeResult.fullLoaderHidden
      && failedRank.probeResult.profileRank === '#17' && !failedRank.probeResult.rankBusy
      && failedRank.probeResult.inlineLoaderGone
      && failedRank.probeResult.rankAfterFailedResult === 17
      && failedRank.probeResult.name === 'TestGuest001'
      /* The result must NOT pair this cached rank with points the match just
         moved: #17 belonged to the old number. Profile, whose points and rank
         come from one cached tuple, still shows it (asserted above). */
      && !failedRank.probeResult.resultRank?.includes('#')
      && failedRank.probeResult.points === '1,000',
  'a failed rank refresh covered Profile or discarded the cached rank', failedRank.probeResult);
  check(failedRank.errs.length === 0,
    'page errors during failed Profile rank fallback', failedRank.errs);

  const failedLadderStanding = await visit({
    door: 'board',
    preauthenticated: true,
    failStanding: true,
    initScript: seedCompleteProfile,
    skipStandardProbes: true,
    probe: async (page) => {
      const mine = page.locator('#onLadderList .lrow.me');
      const highlighted = await mine.count();
      if (highlighted) await mine.click();
      await page.waitForSelector('#onAccount:not([hidden])', { timeout: 5000 });
      return { highlighted,
        profileName: await page.evaluate(
          () => document.getElementById('onAccount')?.dataset.accountName ?? '') };
    },
  });
  out.onlineLoading.failedLadderStanding = failedLadderStanding.probeResult;
  check(failedLadderStanding.probeResult?.highlighted === 1
      && failedLadderStanding.probeResult.profileName === 'TestGuest001',
  'a standing outage removed the coherent player highlight/Profile door from Ladder',
  failedLadderStanding.probeResult);

  const sharedStandingCache = await visit({
    preauthenticated: true,
    initScript: seedCompleteProfile,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page, routes) => {
      await page.waitForFunction(() => document.getElementById('accRank')?.textContent === '#2');
      routes.setStandingUnavailable(true);
      await page.click('#btnOnlineBack');
      await page.waitForSelector('#ovStart.on', { timeout: 5000 });
      await page.click('#homeChip');
      await page.waitForFunction(() => document.getElementById('accRank')?.textContent === '#2'
        && !document.getElementById('btnRank')?.hasAttribute('aria-busy'));
      return page.evaluate(() => ({
        rank: document.getElementById('accRank')?.textContent,
        small: JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null')?.rank,
        complete: JSON.parse(localStorage.getItem(
          'knucklebones.online.account-profile') ?? 'null')?.standing?.rank,
      }));
    },
  });
  out.onlineLoading.sharedStandingCache = sharedStandingCache.probeResult;
  check(sharedStandingCache.probeResult?.rank === '#2'
      && sharedStandingCache.probeResult.small === 2
      && sharedStandingCache.probeResult.complete === 2,
  'a successful standing elsewhere left Profile failure fallback on an older rank',
  sharedStandingCache.probeResult);

  const failedLocalRefresh = await visit({
    preauthenticated: true,
    failLadder: true,
    failStreak: true,
    failHistory: true,
    initScript: seedCompleteProfile,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page) => {
      await page.waitForTimeout(500);
      return page.evaluate(() => ({
        points: document.getElementById('accPoints')?.textContent,
        peak: document.getElementById('accPeak')?.textContent,
        streak: document.getElementById('accStreak')?.textContent,
        opponent: document.querySelector('#accRecent .nm')?.textContent,
        cached: JSON.parse(localStorage.getItem(
          'knucklebones.online.account-profile') ?? 'null'),
      }));
    },
  });
  out.onlineLoading.failedLocalRefresh = failedLocalRefresh.probeResult;
  check(failedLocalRefresh.probeResult?.points === '465'
      && failedLocalRefresh.probeResult.peak === '500'
      && failedLocalRefresh.probeResult.streak === '9'
      && failedLocalRefresh.probeResult.opponent === 'CachedOpponent'
      && failedLocalRefresh.probeResult.cached?.profile?.rating === 465
      && failedLocalRefresh.probeResult.cached?.ladder?.points === 465
      && failedLocalRefresh.probeResult.cached?.standing?.points === 465
      && failedLocalRefresh.probeResult.cached?.streak === 9
      && failedLocalRefresh.probeResult.cached?.recent?.[0]?.opponent === 'CachedOpponent',
  'transient non-rank failures destroyed complete local Profile facts while standing refreshed',
  failedLocalRefresh.probeResult);

  const clearedRank = await visit({
    door: 'board',
    preauthenticated: true,
    emptyStanding: true,
    initScript: seedCompleteProfile,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: async (page) => {
      const stored = await page.evaluate(() => JSON.parse(
        localStorage.getItem('knucklebones.online.profile') ?? 'null'));
      const complete = await page.evaluate(() => JSON.parse(
        localStorage.getItem('knucklebones.online.account-profile') ?? 'null'));
      await page.click('#btnOnlineBack');
      await page.waitForSelector('#ovStart.on', { timeout: 5000 });
      return { rank: stored && Object.hasOwn(stored, 'rank') ? stored.rank : 'missing',
        completeRank: complete?.standing?.rank ?? null,
        home: await page.locator('#homeChip').innerText() };
    },
  });
  out.onlineLoading.clearedRank = clearedRank.probeResult;
  check(clearedRank.probeResult?.rank === null && clearedRank.probeResult.completeRank === null
      && !clearedRank.probeResult.home.includes('#17'),
  'a confirmed no-standing answer left the old rank on Home', clearedRank.probeResult);
}
