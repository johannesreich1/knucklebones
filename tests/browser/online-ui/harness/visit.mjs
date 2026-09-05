import { installOnlineRoutes } from './routes.mjs';
import { installTrialMatchRoutes } from './trial-match.mjs';
import { installEntryRecorder } from './entry-recorder.mjs';
import { readOnlineView } from './read-view.mjs';
import { guardRoutes } from './guard-routes.mjs';
import { probeFaceoff } from '../scenarios/faceoff-probe.mjs';
import { probeAccountActions } from './account-probes.mjs';
import { probeQueuePanel } from './queue-probes.mjs';
import { installNativeBridges } from './native-bridges.mjs';
import { seedDevice } from './device-seed.mjs';
import { waitForOverlayTransitions } from '../../support/overlay-transitions.mjs';
/* One harness: open the app with Supabase answering however this case wants,
   tap Account, and report what the player is looking at. */
export function createVisit({ browser, URL, SESSION, GUEST_ID, onHarnessError }) {
  return async function visit({
    anonymous = 200,
    /* A restored session; a genuinely new anonymous signup deliberately
       clears the preceding account's presentation. */
    preauthenticated = false,
    /* A direct/cross-tab account replacement can leave the eager Home cache
       on A while Supabase storage already owns B. */
    sessionAccountId = null,
    /* Stand up the iOS-only Apple bridge. Its default credential is invalid,
       so a tap exercises the provider error path without reaching Apple. */
    appleBridge = false,
    /* Hold the native credential itself, before Supabase has been touched. */
    deferAppleNative = false,
    /* The bridge normally returns an invalid credential so provider-error
       probes cannot accidentally become successful sign-ins. A focused auth
       probe opts into a valid Apple result and the matching Supabase route.
       'rejected' hands the app a token that Supabase then refuses — the only
       mode besides 'success' that issues the exchange `deferAppleAuth` holds. */
    appleAuth = 'invalid',
    deferAppleAuth = false,
    /* Hold the authorization-code registration after linkIdentity has already
       committed/stored its session; account-publication races switch here. */
    deferAppleRegistration = false,
    attached = false,
    authDelay = 0,
    dataDelay = 0,
    door = 'chip',
    /* Stand up an authenticated iOS Game Center bridge; `linked`/`conflict`
       also choose the identity-gateway attach answer. */
    gameCenterBridge = null,
    /* What the DEVICE says about vouching for a stable identifier, on the auth
       state itself — `scopedIDsArePersistent()` as GameCenterPlugin.swift now
       publishes it, rather than something only a failed proof could reveal.
       `false` is the owner's own phone: GameKit authenticates the local player
       (iOS shows its banner) and then declines to identify them, which Screen
       Time's multiplayer limit routinely causes. `null` stands an installed
       binary older than that reading, which sends the field not at all. */
    gameCenterPersistent = true,
    /* How the DEVICE refuses to sign, as `{ code, message, afterProofs }` —
       `{ code, message }` being the exact shape GameCenterPlugin.swift rejects
       with. A refusal never reaches the gateway at all, which is the failure
       the owner actually hit: no request, no server log, and (before this) one
       generic sentence for four different causes.
       `afterProofs` exists because the launch sign-in exchange is what
       establishes this harness's session at all: a device that could never
       sign a proof never reaches the profile, which is the sign-in sheet's
       story rather than the profile's. Sign that many proofs, then refuse —
       so the refusal under test is the one the player's TAP asks for. */
    proofRefusal = null,
    identity = { gameCenterLinked: false, appleLinked: false, appleRevocationReady: false },
    identityDelay = 0, inspectLoading = false, inspectEntry = false,
    deferStanding = false, failStanding = false,
    emptyStanding = false, failLadder = false, failCurveVersion = false,
    refuseStandingOnce = false,
    sessionRefresh = false,
    /* Seed the stored session already past its expiry, so the very first read
       must go to the token endpoint. Paired with `refuseSessionRefresh` this
       is a phone that slept longer than an access token lives. */
    expiredSession = false,
    refuseSessionRefresh = false,
    offlineTokenEndpoint = false,
    failStreak = false, failHistory = false, failRuneOnCall = null,
    member = false,
    named = false,
    motion = null,
    locale = 'en-US',
    viewport = { width: 430, height: 932 },
    ladderNearBottom = false,
    ladderBoard = null,
    historyDepth = 0,
    paginationRace = false,
    passwordAuth = 'error',
    runes = [],
    /* The rune the account CARRIES, which is not the same as the ones it owns:
       an empty seat is a valid state, and the two players' seats are
       independent — one may carry a rune while the other does not. */
    equippedRune = null,
    randomRuneMode = false,
    /* Ladder points decide the current GROUP. Null keeps every existing probe
       on its BONE default. */
    standingPoints = null,
    /* Let a settlement land after the ladder/profile mirror so a regression
       can prove the standing tuple wins across every cached surface. */
    reportedStandingPoints = null,
    /* Historical season high-water mark. Null retains the route fixture's
       ordinary max(700, points) default; an explicit value lets a profile
       regression distinguish a demoted player from one never past SILVER. */
    standingPeak = null,
    /* Permanent equipment access may have been earned in an earlier season
       even when this season's peak is still below SILVER. Null derives the
       fact from standingPeak so existing scenarios retain their meaning. */
    historicalSilverReached = null,
    /* Server-owned progression contract. Null keeps legacy/v1 authority; a
       focused v2 probe can provide exact outcomes, weekly state and medals. */
    progressionStatus = null,
    unseenRunes = [],
    markRunesSeenAfterFirstRead = false,
    expectReward = false,
    probe = null,
    /* A focused transition probe may deliberately finish somewhere the
       standard door reader cannot consume (for example a connection sheet).
       Close after its own assertions instead of imposing the door's ordinary
       queue/account cleanup. */
    returnAfterProbe = false,
    skipStandardProbes = false,
    /* `door: 'match'` needs a match to enter. Pass `true` for the standard
       Rune Trial fixture, or an options object for trial-match.mjs. */
    trialMatch = null,
    /* A malformed authoritative row must be rejected at the queue boundary,
       before the shared table is seated. These probes still enter through the
       real match door, but wait for that door to return Home instead. */
    expectMatchRejection = false,
    /* A board door that is EXPECTED not to paint: the ladder's own failure
       surface is what the probe reads, so waiting for a row here would time
       out on the very state under test. Mirrors expectMatchRejection. */
    expectBoardFailure = false,
    /* The account door may legitimately end at a refusal rather than a panel,
       or at nothing at all. Hand the settling to the probe: a scenario about
       the WRONG surface must report the surface it found, and a scenario about
       a door that never answers must report THAT, rather than both dying as an
       indistinguishable 15s timeout here. */
    expectEntryRefusal = false,
    /* Most in-match probes require both dealt rune cards. A standard match
       with two honest empty seats has no live rail, so its entry probe may
       disable this wait while retaining the authoritative-state wait below. */
    matchReadySelector = '#spellBar.paired.live',
    /* Run in the page BEFORE it loads, so a probe can watch something that
       happens while a door is still opening. `door: 'match'` waits for
       `phase === 'choose' && !busy` — the whole entry, animations included — so
       anything measured from `probe` has already finished. A recorder installed
       here is the only way to time entry itself. */
    initScript = null,
  }) {
    const activeSession = sessionAccountId ? {
      ...SESSION,
      user: { ...SESSION.user, id: sessionAccountId },
    } : SESSION;
    // NO isMobile here: under WebKit it quietly disables page.route(), and a
    // stub that never fires would let this suite talk to the live backend.
    const ctx = await browser.newContext({ viewport, hasTouch: true,
                                           locale,
                                           ...(motion ? { reducedMotion: motion } : {}) });
    /* Every explicit wait in this tree that needs more asks for 15s; the
       driver's 30s default only ever priced an unknown failure at half a
       minute apiece. Keep unknown failures cheap without undercutting the
       explicit budgets. */
    ctx.setDefaultTimeout(20000);
    const page = await ctx.newPage();
    /* Before ANY module installs a stub: a handler that throws must fail the
       suite rather than leave a dead endpoint that reads as a missing
       feature. */
    if (onHarnessError) guardRoutes(page, onHarnessError);
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const routes = await installOnlineRoutes(page, {
      anonymous, attached, authDelay,
      dataDelay: inspectLoading ? 900 : dataDelay, markRunesSeenAfterFirstRead,
      door, gameCenterBridge, identity, identityDelay, member, named,
      ladderNearBottom, ladderBoard, historyDepth,
      paginationRace,
      passwordAuth, appleAuth, deferAppleAuth, deferAppleRegistration,
      runes, unseenRunes, equippedRune, randomRuneMode,
      standingPoints, reportedStandingPoints, standingPeak, historicalSilverReached,
      deferStanding, failStanding, emptyStanding,
      failLadder, failStreak, failHistory, failRuneOnCall, failCurveVersion,
      refuseStandingOnce, sessionRefresh, refuseSessionRefresh, offlineTokenEndpoint,
      SESSION: activeSession, GUEST_ID,
      progressionStatus,
    });
    /* Registered AFTER the base stub on purpose: Playwright gives the most
       recent handler precedence, so the in-match fixture takes over pvp-join
       and `matches` while every other endpoint keeps answering as before. */
    if (trialMatch) {
      Object.assign(routes, await installTrialMatchRoutes(page, {
        GUEST_ID, ...(trialMatch === true ? {} : trialMatch),
      }));
    }
    await installNativeBridges(page, {
      appleBridge, appleAuth, deferAppleNative, gameCenterBridge,
      proofRefusal, gameCenterPersistent,
    });
    await seedDevice(page, {
      door, preauthenticated, expiredSession, session: activeSession, initScript,
    });
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    // the home chip carrying the player's identity IS the door to the account view
    const entry = door === 'board' ? '#btnBoardHome'
      : door === 'play' || door === 'match' || door === 'auth-play'
        ? '#btnOnline' : '#homeChip';
    await page.waitForSelector(entry);
    const homeSnapshot = () => page.evaluate(() => {
      const row = document.querySelector('#ovStart .hrow');
      const button = row?.querySelector('.btn');
      if (!row || !button) return null;
      const rs = getComputedStyle(row), bs = getComputedStyle(button);
      return {
        chip: document.getElementById('homeChip')?.textContent?.trim() ?? '',
        row: { display: rs.display, gap: rs.gap, alignItems: rs.alignItems,
               fontSize: rs.fontSize, width: rs.width },
        button: { paddingTop: bs.paddingTop, paddingRight: bs.paddingRight,
                  fontSize: bs.fontSize, letterSpacing: bs.letterSpacing,
                  flexGrow: bs.flexGrow },
      };
    });
    const homeBeforeOnline = await homeSnapshot();
    const standingCallsBeforeOnline = routes.standingCalls();
    if (inspectLoading || inspectEntry) {
      await installEntryRecorder(page);
    }
    await page.click(entry);
    await page.waitForSelector('#ovOnline', { state: 'attached', timeout: 15000 });
    let loading = null;
    if (inspectLoading) {
      await page.waitForSelector('#onLoading:not([hidden])', { timeout: 15000 });
      /* Past both the .2s no-flash grace and the .25s reveal. Sampling only
         past the delay catches a correctly animating loader mid-fade and
         mistakes its deliberately-low opacity for absence. */
      await page.waitForTimeout(520);
      loading = await page.evaluate((target) => {
        const wait = document.querySelector('#onLoading .ldwait');
        const head = document.querySelector('#ovOnline .shead');
        const targetPanel = document.getElementById(target);
        const wr = wait?.getBoundingClientRect();
        const hr = head?.getBoundingClientRect();
        const style = wait ? getComputedStyle(wait) : null;
        const visibleCentre = hr ? (hr.bottom + innerHeight) / 2 : innerHeight / 2;
        return {
          target,
          title: document.querySelector('#onTitle')?.textContent,
          visible: !!wr && wr.width > 0 && wr.height > 0 && Number(style?.opacity ?? 0) > .9,
          xError: wr ? +(wr.x + wr.width / 2 - innerWidth / 2).toFixed(1) : null,
          yError: wr ? +(wr.y + wr.height / 2 - visibleCentre).toFixed(1) : null,
          targetHidden: targetPanel?.hidden === true,
          visiblePanels: [...document.querySelectorAll('#ovOnline .panel:not(#onLoading)')]
            .filter((panel) => !panel.hidden && panel.getBoundingClientRect().height > 0)
            .map((panel) => panel.id),
          entry: window.__onlineEntry ?? null,
        };
      }, door === 'board' ? 'onLadder' : 'onAccount');
    }
    if (door === 'play') {
      await page.waitForSelector(expectReward
        ? '.rune-reward-sheet .focard'
        : '#onQueue:not([hidden])', { timeout: 15000 });
    } else if (door === 'match') {
      if (expectMatchRejection) {
        /* Home stays mounted under every online overlay and __kbOnline starts
           empty, so neither is evidence that the queue actually handled the
           row. First observe the Trial fixture serving pvp-join, then wait for
           the online door to close with no shared-table state behind it. */
        const deadline = Date.now() + 15000;
        while ((routes.trialJoinCalls?.() ?? routes.joinCalls()) < 1) {
          if (Date.now() >= deadline) throw new Error('the rejected match never reached pvp-join');
          await page.waitForTimeout(25);
        }
        await page.waitForFunction(() =>
          !document.getElementById('ovOnline')?.classList.contains('on')
            && !window.__kbOnline?.(), null, { timeout: 15000 });
      } else {
        /* Past the queue and onto the ranked TABLE: the match exists, the rail
           holds both dealt hands, and input has been opened by the first
           authoritative projection. Anything earlier probes a half-dealt board. */
        await page.waitForFunction(() => !!window.__kbOnline?.(), null, { timeout: 15000 });
        if (matchReadySelector) {
          await page.waitForSelector(matchReadySelector, { timeout: 15000 });
        }
        await page.waitForFunction(
          () => window.__kb.S.phase === 'choose' && !window.__kb.S.busy,
          null, { timeout: 15000 });
      }
    } else if (door === 'board') {
      if (!expectBoardFailure) {
        await page.waitForSelector('#ovOnline .lb .lrow', { timeout: 15000 });
      }
    } else if (!expectEntryRefusal) {
      await page.waitForFunction(() => {
        const a = document.querySelector('#onAccount'), s = document.querySelector('#onAuth');
        return (a && !a.hidden) || (s && !s.hidden);
      }, null, { timeout: 15000 });
    }
    /* A board expected to fail never settles: its loading die spins until the
       screen answers, so waiting for quiet here would time out on the state
       under test. The probe reads the failure surface itself. */
    if (!expectReward && !expectBoardFailure && !expectEntryRefusal) {
      /* Page motion made `hidden` an early, non-visual event: a hydrated panel
         is laid out under the pinned die and released only when the entry
         wipe lands (page-motion.ts holdHydration), and every .btn inside then
         runs its own .15s transition out of that inherited visibility:hidden,
         which WebKit reads as hidden until the next frame. Settle the wipe
         before the grace, or a stub that answers inside 80ms lands a probe in
         that window and reads painted rows beside invisible controls. */
      await waitForOverlayTransitions(page, '#ovOnline');
      await page.waitForTimeout(250);
    }
    // online.css has now landed. Its selectors may style its own screens and
    // body-level sheets, but must not repaint the eager Home hiding underneath.
    const homeAfterOnline = await homeSnapshot();
    const probeResult = probe ? await probe(page, routes) : null;
    const entryState = inspectEntry
      ? await page.evaluate(() => window.__onlineEntry ?? null)
      : null;

    if (returnAfterProbe) {
      await ctx.close();
      return { probeResult, errs, rootLang: null, standingCallsBeforeOnline,
               entry: entryState,
               homeStyles: { before: homeBeforeOnline, after: homeAfterOnline } };
    }

    if (door === 'match') {
      await ctx.close();
      return { probeResult, errs, rootLang: null };
    }
    if (door === 'auth-play') {
      await ctx.close();
      return { probeResult, errs, rootLang: null };
    }

    if (door === 'play') {
      const { samples, queueFloor, queueCentring, queueCancel } = await probeQueuePanel(page);
      await page.click('#btnQueueCancel');
      await page.waitForTimeout(50);
      const rootLang = await page.locator('html').getAttribute('lang');
      await ctx.close();
      return { queueLabel: samples, queueCancel, queueFloor, queueCentring, errs, loading, signupCalls: routes.signupCalls(),
               rootLang, probeResult, standingCallsBeforeOnline,
               homeStyles: { before: homeBeforeOnline, after: homeAfterOnline } };
    }

    const seen = await readOnlineView(page);
    const faceoff = skipStandardProbes ? null : await probeFaceoff(page, { door, motion });
    const { claimFlow, askAbove, rankDoor, ptsDoor } = skipStandardProbes
      ? { claimFlow: null, askAbove: null, rankDoor: null, ptsDoor: null }
      : await probeAccountActions(page, { door, named }, routes);

    await ctx.close();
    return { seen, errs, loading, signupCalls: routes.signupCalls(), standingCallsBeforeOnline,
             faceoff, rankDoor, ptsDoor, claimFlow, askAbove, probeResult,
             homeStyles: { before: homeBeforeOnline, after: homeAfterOnline } };
  };
}
