import { installOnlineRoutes } from './routes.mjs';
import { installTrialMatchRoutes } from './trial-match.mjs';
import { readOnlineView } from './read-view.mjs';
import { guardRoutes } from './guard-routes.mjs';
import { probeFaceoff } from '../scenarios/faceoff-probe.mjs';
import { probeAccountActions } from './account-probes.mjs';

/* One harness: open the app with Supabase answering however this case wants,
   tap Account, and report what the player is looking at. */
export function createVisit({ browser, URL, SESSION, GUEST_ID, onHarnessError }) {
  return async function visit({
    anonymous = 200,
    /* The Apple provider is reachable only where the Capacitor plugin is —
       iOS. WebKit has no bridge, which is the honest default here and the
       state the web/Android player is really in; set this to stand a device
       that DOES have one up, so the profile's Apple offers can be met. The
       stub answers with a credential the app must reject, so a tap runs the
       whole provider path and lands on the profile's own error line rather
       than reaching Apple. */
    appleBridge = false,
    attached = false,
    authDelay = 0,
    dataDelay = 0,
    door = 'chip',
    /* Game Center is reachable only where GameKit is AND the build carries an
       identity gateway origin. This stands the device half up: an iOS bridge
       whose local player is already authenticated, exactly as the phone that
       greeted the player by name at launch. 'linked' | 'conflict' also chooses
       how the gateway answers the attach (see identity-routes). */
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
    inspectLoading = false,
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
    /* Ladder points, which decide the GROUP — the equipped seat only goes live
       from SILVER up. Null keeps every existing probe on its BONE default. */
    standingPoints = null,
    unseenRunes = [],
    markRunesSeenAfterFirstRead = false,
    expectReward = false,
    probe = null,
    skipStandardProbes = false,
    /* `door: 'match'` needs a match to enter. Pass `true` for the standard
       Rune Trial fixture, or an options object for trial-match.mjs. */
    trialMatch = null,
    /* Run in the page BEFORE it loads, so a probe can watch something that
       happens while a door is still opening. `door: 'match'` waits for
       `phase === 'choose' && !busy` — the whole entry, animations included — so
       anything measured from `probe` has already finished. A recorder installed
       here is the only way to time entry itself. */
    initScript = null,
  }) {
    // NO isMobile here: under WebKit it quietly disables page.route(), and a
    // stub that never fires would let this suite talk to the live backend.
    const ctx = await browser.newContext({ viewport, hasTouch: true,
                                           locale,
                                           ...(motion ? { reducedMotion: motion } : {}) });
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
      door, gameCenterBridge, identity, member, named, ladderNearBottom, ladderBoard, historyDepth,
      paginationRace,
      passwordAuth, runes, unseenRunes, equippedRune, standingPoints, SESSION, GUEST_ID,
    });
    /* Registered AFTER the base stub on purpose: Playwright gives the most
       recent handler precedence, so the in-match fixture takes over pvp-join
       and `matches` while every other endpoint keeps answering as before. */
    if (trialMatch) {
      Object.assign(routes, await installTrialMatchRoutes(page, {
        GUEST_ID, ...(trialMatch === true ? {} : trialMatch),
      }));
    }
    /* ONE Capacitor object: the native bridges are plugins on the same global,
       and two init scripts each installing their own would leave whichever ran
       last as the only device the app can see. */
    if (appleBridge || gameCenterBridge) {
      await page.addInitScript(({ apple, gameCenter, refusal, persistent }) => {
        const Plugins = {};
        if (apple) {
          Plugins.AppleSignIn = {
            initialize: async () => {},
            signIn: async (options) => {
              globalThis.__appleSignIn = { calls: (globalThis.__appleSignIn?.calls ?? 0) + 1,
                                           options: options ?? null };
              return { idToken: '' };
            },
          };
        }
        if (gameCenter) {
          globalThis.__gameCenter = { proofs: 0 };
          // an older binary omits the field entirely, which is not the same
          // claim as sending `false` — so it is genuinely absent here too
          const state = { status: 'authenticated', revision: 1 };
          if (persistent !== null) state.persistentIdentity = persistent;
          Plugins.GameCenter = {
            initialize: async () => state,
            getAuthState: async () => state,
            addListener: () => ({ remove() {} }),
            fetchIdentityProof: async () => {
              globalThis.__gameCenter.proofs++;
              if (refusal && globalThis.__gameCenter.proofs > (refusal.afterProofs ?? 0)) {
                // Capacitor surfaces a plugin reject() as an Error carrying the
                // plugin's code; the web layer classifies on that code.
                const error = new Error(refusal.message);
                if (refusal.code) error.code = refusal.code;
                throw error;
              }
              return { publicKeyUrl: 'https://static.gc.apple.com/public-key/gc-prod-12.cer',
                       signature: 'signed', salt: 'salt', timestamp: '123',
                       teamPlayerID: 'team-player' };
            },
          };
        }
        globalThis.Capacitor = { getPlatform: () => 'ios', Plugins };
      }, { apple: appleBridge, gameCenter: !!gameCenterBridge, refusal: proofRefusal,
           persistent: gameCenterPersistent });
    }
    if (door === 'play' || door === 'match') {
      /* Ranked newcomers stop at the once-only tutorial offer. This probe is
         about the queue the returning player sees, so enter as a played device. */
      await page.addInitScript(() => localStorage.setItem(
        'knucklebones.v1', JSON.stringify({ played: true }),
      ));
    }

    if (initScript) await page.addInitScript(initScript);
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    // the home chip carrying the player's identity IS the door to the account view
    const entry = door === 'board' ? '#btnBoardHome'
      : door === 'play' || door === 'match' ? '#btnOnline' : '#homeChip';
    await page.waitForSelector(entry);
    const homeSnapshot = () => page.evaluate(() => {
      const row = document.querySelector('#ovStart .hrow');
      const button = row?.querySelector('.btn');
      if (!row || !button) return null;
      const rs = getComputedStyle(row), bs = getComputedStyle(button);
      return {
        row: { display: rs.display, gap: rs.gap, alignItems: rs.alignItems,
               fontSize: rs.fontSize, width: rs.width },
        button: { paddingTop: bs.paddingTop, paddingRight: bs.paddingRight,
                  fontSize: bs.fontSize, letterSpacing: bs.letterSpacing,
                  flexGrow: bs.flexGrow },
      };
    });
    const homeBeforeOnline = await homeSnapshot();
    if (inspectLoading) {
      await page.evaluate(() => {
        window.__onlineEntry = { frames: 0, emptyFrames: 0, first: null };
        const sample = () => {
          const overlay = document.getElementById('ovOnline');
          let visiblePanels = [];
          if (overlay?.classList.contains('on')) {
            visiblePanels = [...overlay.querySelectorAll('.panel')]
              .filter((panel) => !panel.hidden && panel.getBoundingClientRect().height > 0)
              .map((panel) => panel.id);
            const frame = {
              title: document.getElementById('onTitle')?.textContent ?? '',
              visiblePanels,
            };
            window.__onlineEntry.frames++;
            if (!visiblePanels.length) window.__onlineEntry.emptyFrames++;
            window.__onlineEntry.first ??= frame;
          }
          if (!visiblePanels.some((id) => id !== 'onLoading')) {
            requestAnimationFrame(sample);
          }
        };
        requestAnimationFrame(sample);
      });
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
      /* Past the queue and onto the ranked TABLE: the match exists, the rail
         holds both dealt hands, and input has been opened by the first
         authoritative projection. Anything earlier probes a half-dealt board. */
      await page.waitForFunction(() => !!window.__kbOnline?.(), null, { timeout: 15000 });
      await page.waitForSelector('#spellBar.paired.live', { timeout: 15000 });
      await page.waitForFunction(
        () => window.__kb.S.phase === 'choose' && !window.__kb.S.busy,
        null, { timeout: 15000 });
    } else if (door === 'board') {
      await page.waitForSelector('#ovOnline .lb .lrow', { timeout: 15000 });
    } else {
      await page.waitForFunction(() => {
        const a = document.querySelector('#onAccount'), s = document.querySelector('#onAuth');
        return (a && !a.hidden) || (s && !s.hidden);
      }, null, { timeout: 15000 });
    }
    if (!expectReward) await page.waitForTimeout(250);
    // online.css has now landed. Its selectors may style its own screens and
    // body-level sheets, but must not repaint the eager Home hiding underneath.
    const homeAfterOnline = await homeSnapshot();
    const probeResult = probe ? await probe(page, routes) : null;

    if (door === 'match') {
      await ctx.close();
      return { probeResult, errs, rootLang: null };
    }

    if (door === 'play') {
      const samples = [];
      for (let i = 0; i < 4; i++) {
        samples.push(await page.evaluate(() => {
          const message = document.querySelector('#onQueue .qmsg');
          const die = document.querySelector('#onQueue .qdice .die');
          const pseudo = getComputedStyle(message, '::after');
          return {
            label: message?.textContent?.trim() ?? null,
            pseudoContent: pseudo.content,
            labelAnimation: pseudo.animationName,
            dieAnimation: die ? getComputedStyle(die).animationName : null,
          };
        }));
        if (i < 3) await page.waitForTimeout(350);
      }
      const queueCancel = await page.evaluate(() => {
        const button = document.getElementById('btnQueueCancel');
        const style = button ? getComputedStyle(button) : null;
        return {
          label: button?.textContent?.trim() ?? null,
          textTransform: style?.textTransform ?? null,
          clipped: button ? button.scrollWidth > button.clientWidth : null,
        };
      });
      await page.click('#btnQueueCancel');
      await page.waitForTimeout(50);
      const rootLang = await page.locator('html').getAttribute('lang');
      await ctx.close();
      return { queueLabel: samples, queueCancel, errs, loading, signupCalls: routes.signupCalls(),
               rootLang, probeResult,
               homeStyles: { before: homeBeforeOnline, after: homeAfterOnline } };
    }

    const seen = await readOnlineView(page);
    const faceoff = skipStandardProbes ? null : await probeFaceoff(page, { door, motion });
    const { claimFlow, askAbove, rankDoor, ptsDoor } = skipStandardProbes
      ? { claimFlow: null, askAbove: null, rankDoor: null, ptsDoor: null }
      : await probeAccountActions(page, { door, named });

    await ctx.close();
    return { seen, errs, loading, signupCalls: routes.signupCalls(), faceoff, rankDoor, ptsDoor, claimFlow, askAbove, probeResult,
             homeStyles: { before: homeBeforeOnline, after: homeAfterOnline } };
  };
}
