// WHERE ‹ LEADS OUT OF THE PROFILE: the door you came through, not the menu.
//
// The result screen's own plate is a DOOR — tapping it opens your profile
// (design 36f). The profile is also a Home destination, and its ‹ was wired to
// Home outright, so a player who checked their rating after a match came back
// to the main menu with the result gone (user report, 2026-08-22).
//
// The rule the app already had is the one being kept: a page's ‹ "returns
// exactly where you came from" (design 00-navigation). That answer cannot be a
// constant — it belongs to whoever opened the overlay — so this suite pins
// BOTH callers, because a fix that only serves the new one would break the old:
//
//   · from the result screen, ‹ hands back the RESULT — the same screen, with
//     the numbers that landed late still on it (nothing was re-dealt), and no
//     second celebration: a screen that was only COVERED replays its plates
//     (deal, slam, jolt) and nothing else, because the title landed once and
//     the fireworks fired once,
//   · one level at a time: the avatar picker still climbs to the profile,
//     never past it,
//   · from Home's identity chip, ‹ still lands on Home,
//   · and Home means home — the result screen may not float above it.
//
// Asserted in PIXELS, the test13 lesson: every .ov shares one z-index, so a
// screen can be `.on`, correct in the DOM, and completely covered. What comes
// back from elementFromPoint is the room the player is actually looking at.
//
// Served suite: the online chunk is lazy, so it needs a real origin. Supabase
// is stubbed at the network edge — this asserts OUR decisions, not theirs.
import pkg from 'playwright';
const { chromium } = pkg;
import { SUPABASE_AUTH_STORAGE_KEY } from '../src/config.ts';
import { servedBase } from './serve.mjs';
const URL = await servedBase();
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const GUEST_ID = '00000000-0000-4000-8000-0000000f00d5';
const SESSION = {
  access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.` +
    `${b64({ sub: GUEST_ID, aud: 'authenticated', role: 'authenticated', is_anonymous: true,
             exp: Math.floor(Date.now() / 1000) + 3600 })}.stub`,
  token_type: 'bearer', expires_in: 3600, refresh_token: 'stub',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: GUEST_ID, aud: 'authenticated', role: 'authenticated', email: null,
          is_anonymous: true, created_at: '2026-06-01T00:00:00Z',
          app_metadata: {}, user_metadata: {}, identities: [] },
};
const PROFILE = { id: GUEST_ID, nickname: 'TestGuest001', rating: 1012, avatar: 'die:5:cy',
                  created_at: '2026-06-01T00:00:00Z', named_at: '2026-06-01T00:00:00Z' };
/* THE BOARD the ladder door is walked on (case 6). Four rows with MINE among
   them — the app finds it by NICKNAME (ladder-screen.ts), so that is the field
   that has to agree with the cached profile, not the id. */
const BOARD = [
  { rank: 1, nickname: 'CosmicRaven681', points: 4600, wins: 20, losses: 12, avatar: 'die:2:gold', apex: true, peak: 4600 },
  { rank: 2, nickname: 'LuckyCrow407', points: 3220, wins: 19, losses: 12, avatar: 'die:4:mg', apex: false, peak: 3300 },
  { rank: 3, nickname: PROFILE.nickname, points: PROFILE.rating, wins: 12, losses: 7, avatar: PROFILE.avatar, apex: false, peak: 1080 },
  { rank: 4, nickname: 'ZestyFox981', points: 900, wins: 10, losses: 6, avatar: 'die:6:cy', apex: false, peak: 950 },
];
/* the match that just ended, as play.ts reports it: a win worth +18 points
   over a named opponent whose own row the RPC will fill in late */
const REPORT = { won: true, draw: false, forfeit: false, my: 41, their: 29,
                 delta: 18, opp: 'NovaComet992', oppAvatar: 'die:3:mg', oppRating: 1104 };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true,
    locale: 'en-US' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  /* Kill the service worker before app code runs: once it controls the page it
     re-issues requests from the worker, where page.route() cannot see them —
     and a stub that never fires would talk to the live backend. */
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: () => Promise.resolve({ addEventListener() {} }), ready: new Promise(() => {}),
               controller: null, addEventListener() {}, getRegistrations: () => Promise.resolve([]) },
    });
  });
  /* a returning, experienced device: a live session, the profile cache the
     result screen deals the own plate from, and a game already played (a
     newcomer would be offered the tutorial instead of a queue) */
  await page.addInitScript(([sess, prof, storageKey]) => {
    localStorage.setItem(storageKey, sess);
    localStorage.setItem('knucklebones.online.profile', prof);
    localStorage.setItem('knucklebones.v1', JSON.stringify({ played: true }));
  }, [JSON.stringify(SESSION), JSON.stringify({ nickname: PROFILE.nickname,
      avatar: PROFILE.avatar, rating: PROFILE.rating, rank: 3, apex: false }),
      SUPABASE_AUTH_STORAGE_KEY]);

  await page.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(r.request().url().includes('token') ? SESSION : { keys: [] }) }));
  /* ONE handler for the whole REST surface, switching on the path: route order
     is not something a suite should have to reason about. */
  await page.route('**/rest/v1/**', (r) => {
    const u = r.request().url();
    const json = (body) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.includes('/rpc/current_season')) return json('11111111-1111-4111-8111-111111111111');
    if (u.includes('/rpc/player_standing')) return json([{ points: 1012, rank: 3, population: 40, percentile: 7.5 }]);
    if (u.includes('/rpc/best_streak')) return json(4);
    if (u.includes('/rpc/match_history')) return json([]);
    // the foe's WHOLE row (migration 0028) — what turns their plate into the
    // face-off's door, and it can only arrive AFTER the screen is already up
    if (u.includes('/rpc/player_card')) return json([{ streak: 2, since: '2026-06-01T00:00:00Z',
      points: 1104, wins: 31, losses: 19, games: 50, rank: 1, apex: false, peak: 1150 }]);
    if (u.includes('/rpc/leaderboard_before')) return json([]);
    if (u.includes('/rpc/leaderboard')) return json(BOARD);
    if (u.includes('/season_ratings')) return json([{ points: 1012, peak: 1080, wins: 12, losses: 7, draws: 1 }]);
    if (u.includes('/profiles')) return json([PROFILE]);
    return json([]);
  });

  /* THE ROOM THE PLAYER IS IN. Being `.on` proves nothing — every .ov shares
     one z-index, so a covered screen is still `.on`. A hidden overlay is
     pointer-events:none and elementFromPoint skips it, so what comes back is
     the top layer's own DOM: the paint, not the bookkeeping. */
  const room = () => page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return { id: el?.closest('.ov')?.id ?? null, title: document.querySelector('#onTitle')?.textContent ?? null };
  });
  /* THE CELEBRATION IS OVER WHEN THE LAYER STAYS EMPTY. A win launches its
     shells 190ms apart (ui/fx.ts) and each ember removes itself, so #endFx is
     briefly empty BETWEEN two of them — this suite believed that once and read
     the tail of the first burst as a second one. Quiet has to hold. */
  const celebrationOver = async () => {
    let quiet = 0;
    for (let i = 0; i < 80 && quiet < 6; i++) {
      await page.waitForTimeout(200);
      quiet = await page.evaluate(() => document.getElementById('endFx').childElementCount === 0) ? quiet + 1 : 0;
    }
    return quiet >= 6;
  };
  /* WHAT IS MOVING ON THE PLATES, by name — the deal, the slam, the beaten
     row's jolt and its dust ring (styles/main.css). getAnimations() drops an
     animation once it has finished and stops affecting the element, so an
     empty list IS a still frame and a full one IS the theatre running. */
  const theatre = () => page.evaluate(() => document.getElementById('endPlates')
    .getAnimations({ subtree: true }).map((a) => a.animationName).filter(Boolean).sort());
  /* the result screen as the player reads it, plus the two facts that separate
     THE SAME SCREEN from a re-dealt one: the foe's plate keeps the door only
     the late RPC could have opened, and nothing is celebrating a second time */
  const resultFace = () => page.evaluate(() => ({
    title: document.querySelector('#endTitle')?.textContent,
    scores: [document.querySelector('#endYou')?.textContent, document.querySelector('#endCpu')?.textContent],
    names: [...document.querySelectorAll('#endPlates .nm2')].map((e) => e.textContent),
    doors: [...document.querySelectorAll('#endPlates > *')].map((e) => e.tagName),
    fireworks: document.getElementById('endFx').childElementCount,
  }));

  /* A LOST SCREEN TAKES THE NEXT STEP WITH IT: the tap after the failed one is
     aimed at a plate that is no longer on screen, and a suite that let that
     throw would report a click timeout instead of the navigation it was
     written to describe. Every step runs inside one catch, so the checks that
     already ran are the report. */
  page.setDefaultTimeout(20000);
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });

    /* 1 · the door that already worked: Home's identity chip opens the profile,
       and ‹ goes back to Home. This is the caller the fix must not disturb. */
    await page.waitForSelector('#homeChip');
    await page.click('#homeChip');
    await page.waitForFunction(() => document.querySelector('#onAccount')?.hidden === false);
    await page.waitForTimeout(400);
    out.fromHome = { profile: await room() };
    await page.click('#btnOnlineBack');
    await page.waitForTimeout(500);
    out.fromHome.back = await room();
    check(out.fromHome.profile.id === 'ovOnline' && out.fromHome.profile.title === 'PROFILE',
          'the home chip did not open the profile', out.fromHome);
    check(out.fromHome.back.id === 'ovStart', '‹ from a profile opened at Home must land on Home', out.fromHome);

    /* 2 · a match ends. enterMatch takes every menu down (online/play.ts) and the
       result screen opens over the table — stand the stage up the same way. */
    await page.evaluate((r) => {
      document.getElementById('ovStart').classList.remove('on');
      window.__kbResult(r);
    }, REPORT);
    // both plates become doors only once the late RPCs land and re-deal them —
    // wait for that, so a tap cannot race the rebuild
    await page.waitForFunction(() => document.querySelectorAll('#endPlates button').length === 2);
    // and let the celebration finish, so any burst seen later can only be a second one
    check(await celebrationOver(), 'the win never stopped celebrating', null);
    const dealt = await resultFace();
    out.result = { room: await room(), ...dealt, theatre: await theatre() };
    check(out.result.theatre.length === 0, 'the plates never settled', out.result);
    check(out.result.room.id === 'ovEnd', 'the result screen never became the room', out.result);
    check(dealt.names[0] === PROFILE.nickname && dealt.names[1] === REPORT.opp,
          'the result screen dealt the wrong plates', dealt);

    /* 3 · THE BUG: tap your own plate, then come back. */
    await page.click('#endPlates > *:first-child');
    await page.waitForFunction(() => document.querySelector('#onAccount')?.hidden === false);
    await page.waitForTimeout(400);
    out.profileFromResult = await room();
    check(out.profileFromResult.id === 'ovOnline' && out.profileFromResult.title === 'PROFILE',
          'the result screen\'s own plate did not open the profile', out.profileFromResult);

    await page.click('#btnOnlineBack');
    /* the plates take their stage again the moment the screen is uncovered —
       read it while it runs (the stamp's slam is still pending at 400ms, and
       a pending animation is a listed one) */
    await page.waitForTimeout(400);
    out.replay = await theatre();
    check(out.replay.includes('stampSlam') && out.replay.includes('plateIn'),
          'coming back did not replay the plates', out.replay);
    await page.waitForTimeout(2000);  // let the theatre finish before reading the still frame
    const back = await resultFace();
    out.backOnResult = { room: await room(), ...back };
    check(out.backOnResult.room.id === 'ovEnd',
          'BACK FROM THE PROFILE LOST THE RESULT SCREEN', out.backOnResult);
    check(back.title === dealt.title && String(back.scores) === String(dealt.scores)
          && String(back.names) === String(dealt.names),
          'the result came back saying something else', { back, dealt });
    check(String(back.doors) === String(dealt.doors) && back.doors[1] === 'BUTTON',
          'the foe plate lost the door the late RPC opened — the screen was re-dealt, not kept',
          { back, dealt });
    check(back.fireworks === 0, 'the celebration fired a second time on the way back', back);
    check(await theatre().then((t) => t.length === 0), 'the replayed plates never settled', out.replay);

    /* 4 · one level at a time: the avatar picker climbs to the profile, and only
       the profile's own ‹ goes on to the result. */
    await page.click('#endPlates > *:first-child');
    await page.waitForFunction(() => document.querySelector('#onAccount')?.hidden === false);
    await page.click('#btnAvatar');
    await page.waitForFunction(() => document.querySelector('#onAvatar')?.hidden === false);
    await page.waitForTimeout(300);
    out.oneLevel = { avatar: await room() };
    await page.click('#btnOnlineBack');
    await page.waitForFunction(() => document.querySelector('#onAccount')?.hidden === false);
    await page.waitForTimeout(300);
    out.oneLevel.profile = await room();
    await page.click('#btnOnlineBack');
    await page.waitForTimeout(900);
    out.oneLevel.result = await room();
    check(out.oneLevel.avatar.title === 'AVATAR', 'the avatar picker never opened', out.oneLevel);
    check(out.oneLevel.profile.id === 'ovOnline' && out.oneLevel.profile.title === 'PROFILE',
          '‹ from the avatar picker skipped the profile', out.oneLevel);
    check(out.oneLevel.result.id === 'ovEnd', '‹ from the profile lost the result screen', out.oneLevel);

    /* 5 · Home means home: nothing may be left floating above the title screen. */
    await page.click('#btnEndQuiet');
    await page.waitForTimeout(700);
    out.home = { room: await room(),
                 endOn: await page.evaluate(() => document.getElementById('ovEnd').classList.contains('on')) };
    check(out.home.room.id === 'ovStart' && out.home.endOn === false,
          'Home arrived with the result screen still on top of it', out.home);

    /* 6 · THE LADDER IS A DOOR TOO. My own row opens my profile — a face-off
       against myself answers nothing — so ‹ has to hand back the list I was
       reading rather than the main menu (user report). The ladder lives INSIDE
       this overlay, so the right answer is a panel swap, not a way out of it:
       that is why these checks read the TITLE as well as the room, since
       #ovOnline is the room for the profile and the ladder alike. */
    await page.click('#btnBoardHome');
    await page.waitForFunction(() => document.querySelector('#onBoard')?.hidden === false
      && document.querySelectorAll('.lrow.me').length === 1);
    await page.waitForTimeout(300);
    out.ladder = { board: await room() };
    await page.click('.lrow.me');
    await page.waitForFunction(() => document.querySelector('#onAccount')?.hidden === false);
    await page.waitForTimeout(300);
    out.ladder.profile = await room();
    await page.click('#btnOnlineBack');
    await page.waitForTimeout(500);
    out.ladder.back = await room();
    check(out.ladder.board.title === 'LADDER', 'the ladder never opened', out.ladder);
    check(out.ladder.profile.id === 'ovOnline' && out.ladder.profile.title === 'PROFILE',
          'my own ladder row did not open my profile', out.ladder);
    /* JUDGED BEFORE THE NEXT STEP IS TAKEN. If ‹ dropped the player home, the
       overlay is gone and the click below has nothing to hit — the suite would
       report a 20s click timeout instead of the navigation it exists to
       describe (the hazard its own preamble names). So this reads first, and
       the rest of the walk only happens if there is still a ladder to walk. */
    check(out.ladder.back.id === 'ovOnline' && out.ladder.back.title === 'LADDER',
          'BACK FROM THE PROFILE LEFT THE LADDER', out.ladder);
    if (out.ladder.back.id === 'ovOnline') {
      /* ...and the slot it borrowed is HANDED BACK. The ladder door fills the
         same ‹ slot Home and the result screen fill, so if it kept it, the
         ladder's own ‹ would lead to the ladder and the player would be shut
         in a room that returns to itself. */
      await page.click('#btnOnlineBack');
      await page.waitForTimeout(500);
      out.ladder.home = await room();
      check(out.ladder.home.id === 'ovStart',
            'the ladder kept the profile\u2019s answer: its own \u2039 no longer leads home', out.ladder);
    }
  } catch (e) { problems.push('the walk broke off :: ' + String(e.message).split('\n')[0]); }

  out.errs = errs;
  check(errs.length === 0, 'page errors', errs);
  await ctx.close();
  console.log(JSON.stringify({ out, problems }, null, 2));
} finally { await browser.close(); }
process.exit(problems.length ? 1 : 0);
