// THE IDENTITY LADDER: nobody is asked to type anything to play.
//
// A first-timer who taps ACCOUNT (or RANKED) becomes a guest — a real user row,
// a real nickname, a real rating — without ever seeing a form. The panel they
// land on offers the way UP; it never blocks the way in.
//
// Two failure modes are worth locking down, and both are invisible to a test
// that only checks the happy path:
//   · the project with anonymous sign-ins switched OFF must fall back to the
//     old sign-in panel rather than dead-ending,
//   · a device that has held a real account must NOT be silently re-minted as
//     a guest — that player signed out in order to sign back in.
//
// Served suite: the online chunk is lazy, so it needs a real origin. Supabase
// is stubbed at the network edge — this asserts OUR decisions, not theirs.
import pkg from 'playwright';
const { webkit } = pkg;
import { servedBase } from './serve.mjs';
// the origin comes from run-all (KB_URL) or from a server this suite starts —
// a kernel-picked port either way, so a peer's gate cannot answer it
const URL = await servedBase();
const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.` +
  `${b64({ sub, aud: 'authenticated', role: 'authenticated', is_anonymous: true,
           exp: Math.floor(Date.now() / 1000) + 3600 })}.stub`;

const GUEST_ID = '00000000-0000-4000-8000-00000000beef';
const SESSION = {
  access_token: jwt(GUEST_ID), token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'stub',
  user: { id: GUEST_ID, aud: 'authenticated', role: 'authenticated',
          email: null, is_anonymous: true, created_at: new Date().toISOString(),
          app_metadata: {}, user_metadata: {}, identities: [] },
};

const browser = await webkit.launch();

/* one harness: open the app with supabase answering however this case wants,
   tap ACCOUNT, report what the player is looking at */
async function visit({ anonymous = 200, attached = false, door = 'chip', named = false }) {
  // NO isMobile here: under WebKit it quietly disables page.route(), and a
  // stub that never fires would let this suite talk to the live backend.
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  let signupCalls = 0;
  page.on('pageerror', (e) => errs.push(e.message));

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
  await page.route('**/auth/v1/signup*', (r) => {
    signupCalls++;
    return anonymous === 200
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) })
      : r.fulfill({ status: 422, contentType: 'application/json',
                    body: JSON.stringify({ code: 'anonymous_provider_disabled', message: 'Anonymous sign-ins are disabled' }) });
  });
  /* stateful, like the live table: the claim PATCH flips named_at (migration
     0026's trigger stamps it server-side), and every later GET tells the
     claimed truth — nickname included */
  let claimed = named;
  await page.route('**/rest/v1/profiles*', (r) => {
    if (r.request().method() === 'PATCH') {
      claimed = true;
      return r.fulfill({ status: 204, body: '' });
    }
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: GUEST_ID, nickname: claimed && door === 'claim' ? 'NeonKing77' : 'TestGuest001',
                              rating: 1000, created_at: new Date().toISOString(),
                              named_at: claimed ? '2026-08-01T00:00:00Z' : null }]) });
  });
  await page.route('**/rest/v1/matches*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/auth/v1/.well-known/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"keys":[]}' }));
  /* the 0022 shape: points/rank/apex/avatar/peak. The two rows sit in
     DIFFERENT groups (1,072 is IVORY, 465 is BONE) so the board has to draw a
     horizon for each — the group structure is asserted below. */
  await page.route('**/rest/v1/rpc/leaderboard*', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ nickname: 'NovaComet992', points: 1072, wins: 7, losses: 2, games: 9, rank: 1, apex: false, avatar: 'die:3:mg', peak: 1100 },
                          { nickname: 'TestGuest001', points: 465, wins: 42, losses: 61, games: 103, rank: 2, apex: false, avatar: 'die:5:cy', peak: 700 }]) }));
  await page.route('**/rest/v1/rpc/player_card*', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ streak: 4, since: '2026-06-01T00:00:00Z' }]) }));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  // the home chip carrying the player's identity IS the door to the account view
  const entry = door === 'board' ? '#btnBoardHome' : '#homeChip';
  await page.waitForSelector(entry);
  await page.click(entry);
  await page.waitForSelector('#ovOnline', { state: 'attached', timeout: 15000 });
  if (door === 'board') {
    await page.waitForSelector('#ovOnline .lb .lrow', { timeout: 15000 });
  } else {
    await page.waitForFunction(() => {
      const a = document.querySelector('#onAccount'), s = document.querySelector('#onAuth');
      return (a && !a.hidden) || (s && !s.hidden);
    }, null, { timeout: 15000 });
  }
  await page.waitForTimeout(250);

  const seen = await page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); if (!e) return false;
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      panel: document.querySelector('#onAccount')?.hidden === false ? 'account' : 'auth',
      title: document.querySelector('#onTitle')?.textContent,
      /* the profile shows the name ONCE, as the headline under the ring. The
         claim card exists only while the name is still the minted placeholder
         (migration 0026): its input starts EMPTY, with the current name as the
         placeholder — the name you keep by never claiming. */
      accName: document.querySelector('#accName')?.textContent,
      accNameShown: vis('#accName'),
      claim: vis('#accClaim'),
      nickValue: document.querySelector('#onNick')?.value,
      nickHint: document.querySelector('#onNick')?.placeholder,
      guestBox: vis('#accGuest'),
      signOut: vis('#btnSignOut'),
      actions: [...document.querySelectorAll('#onAuthActs .btn')].map((x) => x.textContent),
      /* the OTHER door out of this panel. "Create account" stopped being a
         second action here: signing up from the sign-in form minted a fresh
         empty account and threw away the guest rating, so it is a swap to the
         panel that creates one properly (user call). */
      swapDoor: document.querySelector('#btnAuthSwap')?.hidden === false
        ? document.querySelector('#btnAuthSwap')?.textContent : null,
      /* What a ladder row SAYS. It used to read "42W/103" — wins over games —
         so a loss appeared nowhere on the ladder while the HUD and the account
         card both said W · L. All three go through ui/record.ts now, and this
         reads the rendered row because the old bug was invisible to anything
         that only inspected the data. */
      rows: [...document.querySelectorAll('#ovOnline .lb .lrow')].map((r) => {
        const ws = r.querySelector('.ws'); const l = ws?.querySelector('.n2');
        return { text: ws?.textContent ?? '', lossItalic: l ? getComputedStyle(l).fontStyle : null,
                 pts: r.querySelector('.rt')?.textContent ?? '' };
      }),
      /* the groups, as the reader meets them: a horizon labels each material
         change, and the board OPENS with one — a list that starts with a bare
         row has lost its structure */
      horizons: [...document.querySelectorAll('#ovOnline .lb .ghor .gn')].map((e) => e.textContent),
      firstIsHorizon: !!document.querySelector('#ovOnline .lb')?.firstElementChild?.classList.contains('ghor'),
    };
  });
  /* the tap: a board row deals the face-off. The reader here is signed OUT,
     so the card must be the one-column variant — a VS against nobody is the
     kind of half-rendered state only a click can reveal. */
  let faceoff = null;
  if (door === 'board') {
    await page.click('#ovOnline .lb .lrow');
    // the pending cell holds the loading DIE now (no text), so wait for the
    // RPC's actual digits rather than for the old '–' placeholder to change
    await page.waitForFunction(() =>
      /\d/.test(document.querySelector('.faceoff .fostreak')?.textContent ?? ''), null, { timeout: 15000 });
    faceoff = await page.evaluate(() => {
      const ov = document.querySelector('.faceoff');
      const rc = ov?.querySelector('.focard')?.getBoundingClientRect();
      /* the pixel test, not the rect test: the card first shipped at z-index
         60 under the board overlay (z 80) — present in the DOM, invisible on
         screen. elementFromPoint answers what the PLAYER gets. */
      const hit = rc ? document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2) : null;
      return {
        visible: !!rc && rc.width > 0 && rc.height > 0 && !!ov?.contains(hit),
        solo: !!ov?.classList.contains('solo'),
        vsShown: !!ov?.querySelector('.fovs'),
        name: ov?.querySelector('.fnm')?.textContent,
        streak: ov?.querySelector('.fostreak')?.textContent,
        record: [...(ov?.querySelectorAll('.fost') ?? [])].map((s) => s.textContent?.trim() ?? '')[1] ?? '',
      };
    });
  }
  /* the claim, end to end: type, confirm through the shared ask-card, watch
     the card retire, the headline take the name, and the way-up offer arrive
     (a guest just chained a forever-name to a device-only account) */
  let claimFlow = null;
  if (door === 'claim') {
    await page.fill('#onNick', 'NeonKing77');
    await page.click('#btnClaim');
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    const confirmHead = await page.evaluate(() => document.querySelector('#askHead')?.textContent);
    await page.click('#btnAskYes');
    await page.waitForFunction(() => document.querySelector('#askHead')?.textContent?.startsWith('Keep '),
      null, { timeout: 15000 });
    const state = await page.evaluate(() => {
      const vis = (s) => { const e = document.querySelector(s); if (!e) return false;
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return { head: document.querySelector('#askHead')?.textContent,
               claimGone: !vis('#accClaim'),
               headline: document.querySelector('#accName')?.textContent,
               /* an invitation wears primary on YES (ask's loud flag) — read
                  the computed paint, not the class list */
               yesLoud: getComputedStyle(document.querySelector('#btnAskYes')).backgroundImage.includes('gradient') };
    });
    await page.click('#btnAskYes'); // "Create account" — the way up
    await page.waitForFunction(() => document.querySelector('#onAuth')?.hidden === false, null, { timeout: 5000 });
    claimFlow = { confirmHead, ...state, authShown: true };
  }
  /* the ask-card vs later overlays: every .ov shares one z-index, so DOM order
     paints. Recreate the hazard (an overlay re-appended AFTER #ovAsk — the
     offline-quit-then-profile ordering) and assert the card wins the PIXEL:
     ask() re-appends itself on every open. test13's lesson — state and DOM can
     agree while the player sees neither. */
  let askAbove = null;
  if (named) {
    await page.click('#btnDeleteAcc');
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    await page.click('#btnAskNo');
    await page.evaluate(() => document.body.appendChild(document.querySelector('#ovOnline')));
    await page.click('#btnDeleteAcc');
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    askAbove = await page.evaluate(() => {
      const card = document.querySelector('#ovAsk .askcard');
      const rc = card.getBoundingClientRect();
      return card.contains(document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2));
    });
    await page.click('#btnAskNo');
  }
  /* the points on the profile are a door: tapping them opens the ladder */
  let ptsDoor = null;
  if (door === 'chip') {
    const onAccount = await page.evaluate(() => document.querySelector('#onAccount')?.hidden === false);
    if (onAccount) {
      await page.click('#btnLadder');
      await page.waitForSelector('#ovOnline .lb .lrow', { timeout: 15000 });
      ptsDoor = await page.evaluate(() => ({
        board: document.querySelector('#onBoard')?.hidden === false,
        title: document.querySelector('#onTitle')?.textContent,
      }));
    }
  }
  await ctx.close();
  return { seen, errs, signupCalls, faceoff, ptsDoor, claimFlow, askAbove };
}

try {
  // 1 · the newcomer: no form, a name, a rating, and the offer to keep it
  const fresh = await visit({});
  out.fresh = fresh.seen;
  check(fresh.seen.panel === 'account', 'newcomer was asked to sign in', fresh.seen);
  check(fresh.seen.accName === 'TestGuest001' && fresh.seen.accNameShown === true,
        'guest got no visible nickname headline', fresh.seen);
  /* the unnamed player is offered their ONE claim: empty input, the minted
     name as the placeholder they keep by never typing */
  check(fresh.seen.claim === true, 'a fresh player was not offered the name claim', fresh.seen);
  check(fresh.seen.nickValue === '' && fresh.seen.nickHint === 'TestGuest001',
        'the claim input should start empty with the minted name as placeholder', fresh.seen);
  check(fresh.seen.guestBox === true, 'guest was not offered the way up', fresh.seen);
  check(fresh.seen.signOut === false, 'guest offered Sign out — that discards, not signs out', fresh.seen);
  check(fresh.errs.length === 0, 'page errors on the guest path', fresh.errs);
  // the ladder-points block is a door: tapping it lands on the board
  check(fresh.ptsDoor?.board === true && fresh.ptsDoor?.title === 'LADDER',
        'tapping the points on the profile does not open the ladder', fresh.ptsDoor);

  // 1b · the ladder that same guest lands on: a row states BOTH sides
  const board = await visit({ door: 'board' });
  out.ladder = board.seen.rows;
  check(board.seen.rows.length === 2, 'ladder did not render its rows', board.seen.rows);
  check(board.seen.rows[0]?.text === 'W 7 · L 2', 'a ladder row does not state wins AND losses', board.seen.rows);
  check(board.seen.rows[1]?.text === 'W 42 · L 61', 'a lopsided record is not stated in full', board.seen.rows);
  check(board.seen.rows.every((r) => r.lossItalic === 'normal'),
        'the loss count is rendering italic — .n2 lost its shape outside the HUD', board.seen.rows);
  /* points, read from the RENDERED row: the 0018 migration renamed the RPC's
     column rating → points and the ladder printed "undefined" for a day while
     this mock still spoke the old shape. The mock now mirrors the live RPC,
     and this line fails if the client and it ever disagree about names again. */
  check(board.seen.rows[0]?.pts === '1,072', 'a ladder row does not state the points', board.seen.rows);
  // the groups, as structure: one horizon per material change, and the board opens with one
  check(board.seen.horizons.join() === 'IVORY,BONE', 'the group horizons are missing or wrong', board.seen.horizons);
  check(board.seen.firstIsHorizon === true, 'the board does not open with its group horizon', board.seen);
  // the tap: a row deals the face-off, one-column for a signed-out reader
  check(board.faceoff?.visible === true, 'tapping a row does not deal the face-off', board.faceoff);
  check(board.faceoff?.solo === true && board.faceoff?.vsShown === false,
        'a signed-out reader was dealt a VS column with nobody in it', board.faceoff);
  check(board.faceoff?.name === 'NovaComet992', 'the face-off names the wrong player', board.faceoff);
  check(board.faceoff?.streak === '4', 'the face-off streak did not arrive from player_card', board.faceoff);
  check(board.faceoff?.record.includes('W 7') && board.faceoff?.record.includes('L 2'),
        'the face-off does not state both sides of the record', board.faceoff);
  check(board.errs.length === 0, 'page errors on the ladder', board.errs);

  // 1c · the named player: the claim is spent, the card is GONE — not
  // disabled, not re-offered. The headline is all that remains of the name UI.
  const namedRun = await visit({ named: true });
  out.named = { accName: namedRun.seen.accName, claim: namedRun.seen.claim };
  check(namedRun.seen.accName === 'TestGuest001', 'a named player lost their headline', namedRun.seen);
  check(namedRun.seen.claim === false, 'the claim card survives after the name is set', namedRun.seen);
  check(namedRun.askAbove === true,
        'the ask-card opened UNDER a later overlay — ask() lost its re-append', namedRun.askAbove);
  check(namedRun.errs.length === 0, 'page errors on the named path', namedRun.errs);

  // 1d · the claim itself: confirm through the shared ask-card, the card
  // retires, the headline takes the name, and a GUEST is offered the way up
  const claimRun = await visit({ door: 'claim' });
  out.claim = claimRun.claimFlow;
  check(claimRun.claimFlow?.confirmHead === 'Play as NeonKing77?',
        'claiming does not ask the deliberate question', claimRun.claimFlow);
  check(claimRun.claimFlow?.head === 'Keep NeonKing77 forever?',
        'a guest claim did not offer the way up', claimRun.claimFlow);
  check(claimRun.claimFlow?.claimGone === true, 'the claim card survived its own success', claimRun.claimFlow);
  check(claimRun.claimFlow?.headline === 'NeonKing77', 'the headline did not take the claimed name', claimRun.claimFlow);
  check(claimRun.claimFlow?.authShown === true, 'Create account did not open the attach panel', claimRun.claimFlow);
  check(claimRun.claimFlow?.yesLoud === true,
        'the way-up offer does not wear primary on its yes', claimRun.claimFlow);
  check(claimRun.errs.length === 0, 'page errors on the claim flow', claimRun.errs);

  // 2 · the project with anonymous sign-ins off: degrade to the old panel
  const off = await visit({ anonymous: 422 });
  out.providerOff = off.seen;
  check(off.seen.panel === 'auth', 'no fallback when guests are unavailable', off.seen);
  check(off.seen.actions.join() === 'Sign in', 'the fallback lost its sign-in', off.seen);
  check(off.seen.swapDoor === 'Create account', 'the fallback offers no way to make an account', off.seen);
  check(off.errs.length === 0, 'page errors when guests are refused', off.errs);

  // 3 · the returning player: signing out must not mint a guest over them
  const back = await visit({ attached: true });
  out.afterSignOut = back.seen;
  check(back.seen.panel === 'auth', 'a signed-out player was re-minted as a guest', back.seen);
  check(back.signupCalls === 0, 'a guest was minted for a device that had a real account', back.signupCalls);
} catch (e) {
  problems.push('THREW :: ' + e.message);
}
await browser.close();
console.log(JSON.stringify({ out, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
