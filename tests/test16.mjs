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
async function visit({ anonymous = 200, attached = false, door = 'chip', named = false, motion = null }) {
  // NO isMobile here: under WebKit it quietly disables page.route(), and a
  // stub that never fires would let this suite talk to the live backend.
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true,
                                         ...(motion ? { reducedMotion: motion } : {}) });
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
     kind of half-rendered state only a click can reveal.
     And the card is a SHEET now (design 30c, user call 2026-08-22): no ✕
     anywhere, a grabber on its top edge, up from the bottom on arrival and
     back down there on a drag. Every line below reads PIXELS — a sheet that
     merely appeared, or a drag the card ignored, agrees with the DOM
     perfectly (test13's lesson). */
  let faceoff = null;
  if (door === 'board') {
    /* THE ARRIVAL, sampled frame by frame — armed BEFORE the tap, because the
       flight is 340ms and the interesting part is its first frame. One custom
       property drives the card's transform and the wash's alpha, so both are
       read here: if they ever disagree, the fade lands somewhere the card is
       not. */
    const armFlight = () => page.evaluate(() => {
      window.__fo = { vh: window.innerHeight, frames: [] };
      const alpha = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c || '');
        if (!m) return 1;
        const p = m[1].split(',');
        return p.length > 3 ? parseFloat(p[3]) : 1;
      };
      const tick = () => {
        const c = document.querySelector('.focard'), ov = document.querySelector('.faceoff');
        if (c && ov) window.__fo.frames.push({ top: Math.round(c.getBoundingClientRect().top),
                                               a: alpha(getComputedStyle(ov).backgroundColor) });
        if (window.__fo.frames.length < 36) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // one door in, used for every reopen below: tap a row, wait for the RPC's
    // digits, then let the 340ms arrival land before anything is measured
    const open = async () => {
      await page.click('#ovOnline .lb .lrow');
      await page.waitForFunction(() =>
        /\d/.test(document.querySelector('.faceoff .fostreak')?.textContent ?? ''), null, { timeout: 15000 });
      await page.waitForTimeout(450);
    };
    const gone = () => page.waitForFunction(() => !document.querySelector('.faceoff'),
                                            null, { timeout: 4000 }).then(() => true, () => false);
    /* THE GRABBER, MEASURED AS THE PLAYER MEETS IT (design 30c-foexit-grabber).
       No ✕ lives on this card any more — not in the corner, not in a header,
       not under the stats. What replaces it is a 40×4 bar on the card's top
       EDGE that is also a real, labelled, focusable button, because a gesture
       alone is silent to a screen reader and unreachable from a keyboard.
       ONE measurement, taken at every width this suite tries: the painted box,
       the TIGHTEST distance to anything the card draws below it — reported as
       a number, because a boolean that passes by 0.00px says nothing about how
       close the next change came — and the size of the area that actually
       answers a finger, which only elementFromPoint can see: a 14px control
       carrying an invisible expander and a 14px control without one have the
       same rect and are not the same control. */
    const grabMetrics = () => page.evaluate(() => {
      const ov = document.querySelector('.faceoff');
      const b = ov?.querySelector('.fograb'), bar = ov?.querySelector('.fobar');
      const cb = ov?.querySelector('.focard')?.getBoundingClientRect();
      const bb = b?.getBoundingClientRect(), rb = bar?.getBoundingClientRect();
      if (!b || !bb || !cb) return null;
      const bits = [...ov.querySelectorAll('.focols .av,.focols .fnm,.focols .gpill,.focols .fovs')]
        .map((el) => el.getBoundingClientRect());
      // how far two boxes stand apart along the axis that separates them,
      // negative where they overlap — so a regression states HOW far it went
      const apart = (q) => Math.max(q.left - bb.right, bb.left - q.right,
                                    q.top - bb.bottom, bb.top - q.bottom);
      /* the hit band, walked outward from the middle of the bar one pixel at a
         time. It counts the points that ANSWER, and a box owns its top-left
         edge but not its bottom-right one, so the outermost answering points
         span exactly one pixel less than the box they belong to — hence the
         +1 below, which makes these the box's own numbers again. */
      const mine = (x, y) => { const el = document.elementFromPoint(x, y); return !!el && (el === b || b.contains(el)); };
      const cx = (bb.left + bb.right) / 2, cy = (bb.top + bb.bottom) / 2;
      let top = cy, bot = cy, left = cx, right = cx;
      while (top > 1 && mine(cx, top - 1)) top--;
      while (bot < window.innerHeight - 1 && mine(cx, bot + 1)) bot++;
      while (left > 1 && mine(left - 1, cy)) left--;
      while (right < window.innerWidth - 1 && mine(right + 1, cy)) right++;
      return {
        tag: b.tagName, label: b.getAttribute('aria-label') ?? '',
        focusable: b.tabIndex >= 0 && !b.disabled,
        bar: rb ? { w: Math.round(rb.width), h: Math.round(rb.height) } : null,
        /* centred on the card, and standing on its top edge */
        centred: Math.abs(cx - (cb.left + cb.right) / 2) < 1,
        fromTop: Math.round(bb.top - cb.top),
        /* and it costs the card NO width: the 46px avatars and the
           130px-capped nickname keep the whole card */
        clearBy: bits.length ? Math.round(Math.min(...bits.map(apart)) * 10) / 10 : null,
        // what a FINGER gets, which is not what is drawn
        tap: { w: Math.round(right - left) + 1, h: Math.round(bot - top) + 1 },
        avatar: Math.round(ov.querySelector('.focol .av')?.getBoundingClientRect().width ?? 0),
      };
    });
    await armFlight();
    await open();
    faceoff = await page.evaluate(() => {
      const ov = document.querySelector('.faceoff');
      const rc = ov?.querySelector('.focard')?.getBoundingClientRect();
      /* the pixel test, not the rect test: the card first shipped at z-index
         60 under the board overlay (z 80) — present in the DOM, invisible on
         screen. elementFromPoint answers what the PLAYER gets. */
      const hit = rc ? document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2) : null;
      const f = window.__fo.frames;
      return {
        visible: !!rc && rc.width > 0 && rc.height > 0 && !!ov?.contains(hit),
        solo: !!ov?.classList.contains('solo'),
        vsShown: !!ov?.querySelector('.fovs'),
        name: ov?.querySelector('.fnm')?.textContent,
        streak: ov?.querySelector('.fostreak')?.textContent,
        record: [...(ov?.querySelectorAll('.fost') ?? [])].map((s) => s.textContent?.trim() ?? '')[1] ?? '',
        /* IT CAME UP FROM THE BOTTOM. Not "a class was added": the card's own
           box started far below where it settled and climbed, and the wash
           was thinner then than it is now. The first sample is whatever frame
           the rAF caught, so the assertion is about DISTANCE TRAVELLED, not
           about catching frame zero. */
        arrive: f.length ? { first: f[0].top, last: f[f.length - 1].top, vh: window.__fo.vh,
                             washFirst: f[0].a, washLast: f[f.length - 1].a,
                             rose: f.every((s, i) => i === 0 || s.top <= f[i - 1].top + 1) } : null,
        /* nothing anywhere still offers the retired shapes */
        noX: !ov?.querySelector('.foexit') && ![...(ov?.querySelectorAll('button') ?? [])]
          .some((b) => (b.textContent ?? '').includes('✕')),
        bottomBtns: [...(ov?.querySelectorAll('.btn') ?? [])].map((b) => b.textContent?.trim() ?? ''),
        gapLine: !!ov?.querySelector('.fogap'),
        rest: rc ? Math.round(rc.top) : null,
      };
    });
    faceoff.grab = await grabMetrics();
    /* MOTION REDUCED: the sheet still arrives and still leaves, it simply does
       not travel to do either. Nothing below applies — a drag is the player's
       own finger and is never reduced, but there is no flight to measure. */
    if (motion === 'reduce') {
      await page.keyboard.press('Escape');
      // read at once, with no grace: an exit FLIGHT would still be on screen
      faceoff.escInstant = await page.evaluate(() => !document.querySelector('.faceoff'));
    } else {
      /* THE TIGHTEST PHONE. 320px wide: the card is 292px, and the grabber must
         still be centred on its edge and still cost it nothing horizontally. */
      await page.setViewportSize({ width: 320, height: 640 });
      await page.waitForTimeout(120);
      // the same measurement, not a second copy of it — a narrow phone is a
      // width the grabber is measured AT, not a different grabber
      faceoff.narrow = {
        card: await page.evaluate(() =>
          Math.round(document.querySelector('.focard').getBoundingClientRect().width)),
        ...await grabMetrics(),
      };
      await page.setViewportSize({ width: 430, height: 932 });
      await page.waitForTimeout(120);

      /* THE DRAG. Two of them, synthesised on the card itself — one short, one
         past the 96px commit line — and both read as pixels: where the card is
         while the finger holds it, and whether it is still on screen after. */
      const grip = await page.evaluate(() => {
        const c = document.querySelector('.focard').getBoundingClientRect();
        return { x: Math.round(c.x + c.width / 2), y: Math.round(c.top + 7), rest: Math.round(c.top) };
      });
      const dragTo = async (dist, steps = 8, pace = 16) => {
        await page.mouse.move(grip.x, grip.y);
        await page.mouse.down();
        for (let i = 1; i <= steps; i++) {
          await page.mouse.move(grip.x, grip.y + Math.round((dist * i) / steps));
          if (pace) await page.waitForTimeout(pace);
        }
      };
      // (a) 48px, half the line: the card follows the finger and the wash
      //     lightens with it — then the release springs it home.
      await dragTo(48);
      faceoff.held = await page.evaluate(() => {
        const ov = document.querySelector('.faceoff');
        const c = ov?.querySelector('.focard')?.getBoundingClientRect();
        const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(ov).backgroundColor || '');
        const p = m ? m[1].split(',') : [];
        return { top: c ? Math.round(c.top) : null, wash: p.length > 3 ? parseFloat(p[3]) : 1 };
      });
      // a finger that pauses before lifting is a change of mind, not a flick —
      // and it keeps this assertion about the DISTANCE rule, not the velocity one
      await page.waitForTimeout(160);
      await page.mouse.up();
      await page.waitForTimeout(400);
      faceoff.sprung = await page.evaluate(() => {
        const ov = document.querySelector('.faceoff');
        const c = ov?.querySelector('.focard')?.getBoundingClientRect();
        return { alive: !!ov, top: c ? Math.round(c.top) : null };
      });
      // (b) the backdrop, which the ✕ never was and still has to be: a tap on
      //     the wash outside the card closes it — and the click that ends a
      //     drag must never be mistaken for one (it is swallowed above).
      await page.mouse.click(8, 8);
      faceoff.backdropClosed = await gone();
      /* (b2) THE SAME PAIR, ON A FINGER. Every drag above is driven with the
         mouse, which always emits the compatibility click that spends the
         one-click swallow. A TOUCH that moved emits no click at all, so the
         flag outlived its gesture and ate the player's next honest tap on the
         wash — the tap of someone who started a drag, thought better of it,
         and reached for the way out. Measured 3/3 on a trusted touch stream
         before the fix; the mouse path could not see it, which is why this
         step exists in the finger's own idiom. */
      await open();
      const tgrip = await page.evaluate(() => {
        const b = document.querySelector('.fograb').getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
      });
      await page.touchscreen.tap(tgrip.x, tgrip.y + 0);          // settle the surface
      await open();
      await page.evaluate(async ([x, y]) => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const fire = (t, cy) => document.elementFromPoint(x, Math.min(cy, innerHeight - 1))
          ?.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true,
            clientX: x, clientY: cy, bubbles: true, cancelable: true }));
        fire('pointerdown', y);
        /* PACED LIKE A FINGER. Dispatched back to back, six 8px steps arrive in
           ~0ms and the velocity rule reads them as a flick — which commits, and
           the card leaves. That is the harness moving impossibly fast, not the
           app being wrong: 8px per 40ms is 0.2px/ms, well under the 0.5 the
           flick asks for. The lift then waits out the 80ms staleness window,
           so this is unambiguously a slow drag released short. */
        for (let i = 1; i <= 6; i++) { await wait(40); fire('pointermove', y + i * 8); }
        await wait(120);
        fire('pointerup', y + 48);
      }, [tgrip.x, tgrip.y]);
      await page.waitForTimeout(300);
      faceoff.touchSprung = await page.evaluate(() => {
        const c = document.querySelector('.faceoff .focard')?.getBoundingClientRect();
        return { alive: !!document.querySelector('.faceoff'), top: c ? Math.round(c.top) : null };
      });
      await page.touchscreen.tap(8, 8);
      faceoff.touchBackdropClosed = await gone();
      /* and if it was eaten, take the card off by hand so the walk continues:
         a sheet left standing intercepts every later click and the suite would
         report a 30s timeout instead of the door that stopped answering. */
      if (!faceoff.touchBackdropClosed) await page.evaluate(() => document.querySelector('.faceoff')?.remove());
      // (c) 140px, past the line: released, it goes, and the ladder is back
      await open();
      await dragTo(140);
      await page.waitForTimeout(160);
      await page.mouse.up();
      faceoff.dragClosed = await gone();
      /* (c2) THE FLICK: 40px, less than half the commit line, but thrown and
         released while still moving. Distance alone would spring this home, and
         a flick that springs back feels stuck — so velocity commits it too. */
      await open();
      await dragTo(40, 4, 0);
      await page.mouse.up();
      faceoff.flickClosed = await gone();
      /* (d) the keyboard: Escape, the door that was never visible — and the
         exit FLIGHT it starts, sampled frame by frame like the arrival. The
         wash is at alpha 0 about 40% of the way down, but the overlay covers
         inset:0 until it is removed, so for the rest of the flight a sheet
         nobody can see is still between the finger and the ladder. Read at the
         middle of the screen, every frame: while the card rests there the
         sheet must answer, and from the moment it starts leaving it must not. */
      await open();
      await page.evaluate(() => {
        window.__exit = { pressed: -1, f: [] };
        const tick = () => {
          const ov = document.querySelector('.faceoff');
          if (!ov) return;
          const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
          window.__exit.f.push({ top: ov.querySelector('.focard').getBoundingClientRect().top,
                                 hit: !!(el && (el === ov || ov.contains(el))) });
          if (window.__exit.f.length < 60) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.waitForTimeout(60);
      await page.evaluate(() => { window.__exit.pressed = window.__exit.f.length; });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(320);
      faceoff.exit = await page.evaluate(() => {
        const { f, pressed } = window.__exit, rest = f.length ? f[0].top : 0;
        /* "leaving" is not a class here, it is the card being visibly lower
           than it rested. The frames between the last one that is certainly
           BEFORE the press and the first one that has certainly MOVED are the
           key's own flight time and belong to neither side. */
        const at = f.slice(0, Math.max(0, pressed));
        const off = f.slice(f.findIndex((s) => s.top > rest + 2));
        return { rested: at.length, restedHit: at.filter((s) => s.hit).length,
                 leaving: off.length, leavingHit: off.filter((s) => s.hit).length };
      });
      faceoff.escClosed = await gone();
      /* (e) THE PLAIN TAP, which is the door most players will use. It is not
         the keyboard's door wearing gloves: a press that captured the pointer
         on contact handed the tap's click to .focard, so the grabber's own
         listener never ran, the backdrop's `target === ov` was false, and the
         sheet sat exactly where it was — green tests and all, because the only
         one asked was Enter. What the click LANDED on is reported beside
         whether the card left, because the target IS the bug. */
      const clickGrab = async (where) => {
        const p = await page.evaluate((w) => {
          const b = document.querySelector('.fograb').getBoundingClientRect();
          window.__ct = null;
          document.addEventListener('click', (e) => {
            window.__ct = e.target instanceof Element ? (e.target.className || e.target.tagName) : '?';
          }, { capture: true, once: true });
          return { x: Math.round((b.left + b.right) / 2),
                   y: Math.round(w === 'bar' ? (b.top + b.bottom) / 2 : b.bottom + 2) };
        }, where);
        await page.mouse.click(p.x, p.y);
        return page.evaluate(() => window.__ct);
      };
      await open();
      faceoff.tapTarget = await clickGrab('bar');
      faceoff.tapClosed = await gone();
      /* (f) …and the same tap on the half of the target that is not drawn. 2px
         below the bar's box is off the 14px wrapper and onto the invisible
         expander that carries it to 44px. Same finger, same door — or the
         expander is gone and the tap lands on the card, which has no answer. */
      await open();
      faceoff.expandTarget = await clickGrab('under');
      faceoff.expandClosed = await gone();
      /* (g) THE ANNOUNCEABLE DOOR. With the ✕ gone the gesture is the only exit
         a sighted mouse user can see, and a gesture is nothing to a screen
         reader. The grabber is therefore a real button: it takes focus, it has
         a name, and Enter on it dismisses through the same close().
         LAST, and it has to be: Home's own Enter shortcut (boot.ts) fires
         through every overlay above it, so this press also starts a local game
         and puts the first-run tutorial offer over the ladder. That is not
         this card's doing and not this suite's business — but anything that
         needs the ladder must happen before it. */
      await open();
      faceoff.focused = await page.evaluate(() => {
        const b = document.querySelector('.fograb');
        b.focus();
        return document.activeElement === b;
      });
      await page.keyboard.press('Enter');
      faceoff.keyClosed = await gone();
    }
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
  /* THE WAY OUT (design 30c-foexit-grabber, user call 2026-08-22): the card is
     a sheet. It arrives from the bottom, it wears a grabber instead of a ✕,
     and it leaves by being dragged back down — with the backdrop tap and
     Escape untouched, because they were never the thing that was wrong. */
  const fo = board.faceoff;
  check(fo?.noX === true, 'a ✕ is still on the face-off — the card wears a grabber now', fo?.grab);
  check(fo?.bottomBtns.length === 0, 'the face-off still carries a bottom dismissal', fo?.bottomBtns);
  check(!fo?.gapLine, 'the points-between-you line is back on the face-off', fo);
  // the grabber, painted: a 40×4 bar, centred, standing ON the card's top edge
  check(fo?.grab?.bar?.w === 40 && fo?.grab?.bar?.h === 4,
        'the grabber bar is not the 40×4 the design measured', fo?.grab);
  check(fo?.grab?.centred === true, 'the grabber is not centred on the card', fo?.grab);
  check(fo?.grab?.fromTop != null && fo.grab.fromTop >= 0 && fo.grab.fromTop <= 14,
        'the grabber does not sit on the card\u2019s top edge', fo?.grab);
  /* CLEARANCE, AS A DISTANCE. This shipped passing by 0.00px \u2014 the wrapper's
     bottom edge and the avatars' top edge on the same pixel, held apart by a
     tolerance rather than by a gap. The number is asserted, and the number is
     reported, so the next change says how close it came instead of flipping. */
  check(fo?.grab?.clearBy != null && fo.grab.clearBy >= 3,
        'the grabber does not clear the card\u2019s content by a real distance', fo?.grab);
  /* THE TARGET A FINGER GETS. 76\u00d714 is under WCAG 2.5.8's 24\u00d724 floor and far
     under the 44px a thumb wants, and it replaced a 30\u00d730 control. The bar
     stays 40\u00d74 \u2014 an invisible expander does the work, the .rune idiom \u2014 so
     this can only be read by asking the screen who answers there. */
  check(fo?.grab?.tap?.h >= 44 && fo?.grab?.tap?.w >= 44,
        'the grabber\u2019s real tap target is smaller than 44px \u2014 the drawn bar is all there is',
        fo?.grab);
  check(fo?.grab?.avatar === 46, 'the grabber cost the face-off its 46px avatars', fo?.grab);
  /* IT CAME UP FROM THE BOTTOM, and the wash came up with it. One custom
     property drives both, so a card that arrived over a wash already at full
     weight means the two have been split apart again. */
  check(fo?.arrive?.first != null && fo.arrive.first - fo.arrive.last > 200,
        'the face-off did not slide in from the bottom — it simply appeared', fo?.arrive);
  check(fo?.arrive?.rose === true, 'the face-off\u2019s arrival did not travel upward', fo?.arrive);
  check(fo?.arrive?.washFirst < fo?.arrive?.washLast - 0.1,
        'the backdrop wash did not fade in with the card', fo?.arrive);
  // the tightest phone: 320px wide, so a 292px card — the grabber costs it nothing
  check(fo?.narrow?.card === 292, 'the face-off card is not 292px on a 320px screen', fo?.narrow);
  check(fo?.narrow?.avatar === 46 && fo?.narrow?.centred === true && fo?.narrow?.clearBy >= 3
        && fo?.narrow?.tap?.h >= 44,
        'the grabber crowds the card on the narrowest phone', fo?.narrow);
  /* THE DRAG. Held at 48px the card is 48px lower and the wash is thinner;
     released short of the 96px line it springs home and nothing happened. */
  check(fo?.held?.top != null && Math.abs(fo.held.top - (fo.rest + 48)) <= 6,
        'the card does not follow the finger', { held: fo?.held, rest: fo?.rest });
  check(fo?.held?.wash < 0.6, 'the wash does not lighten as the card travels', fo?.held);
  check(fo?.sprung?.alive === true && Math.abs(fo.sprung.top - fo.rest) <= 2,
        'a drag short of the commit line did not spring the card home', fo?.sprung);
  // every other door, still one implementation: backdrop, gesture, keyboard
  /* the finger's pair: it springs home, and the very next tap on the wash is
     answered. A swallow that outlives its gesture fails the second half. */
  check(fo?.touchSprung?.alive === true,
        'a 48px TOUCH drag dismissed the card instead of springing it home', fo?.touchSprung);
  check(fo?.touchBackdropClosed === true,
        'AFTER A TOUCH SPRING-BACK THE BACKDROP TAP WAS EATEN — the card ignored the way out', fo?.touchSprung);
  check(fo?.backdropClosed === true, 'a tap on the backdrop no longer closes the face-off', fo);
  check(fo?.dragClosed === true, 'a drag past the commit line did not dismiss the face-off', fo);
  check(fo?.flickClosed === true,
        'a fast flick short of the line did not dismiss — the velocity rule is gone', fo);
  check(fo?.escClosed === true, 'Escape no longer closes the face-off', fo);
  /* THE DEPARTING SHEET. While it rests it takes the tap that lands on it —
     that is the control here — and from the first frame of the exit flight it
     takes none, because for most of that flight there is nothing to see and
     the ladder underneath is what the finger was aiming at. */
  check(fo?.exit?.rested > 0 && fo?.exit?.restedHit === fo?.exit?.rested,
        'the resting face-off does not take the tap that lands on it', fo?.exit);
  check(fo?.exit?.leaving >= 2 && fo?.exit?.leavingHit === 0,
        'the departing face-off still eats taps while it flies out', fo?.exit);
  /* and the one the gesture cost: with no ✕ there must still be something a
     screen reader announces and a keyboard can press */
  check(fo?.grab?.tag === 'BUTTON' && fo?.grab?.label === 'Close' && fo?.grab?.focusable === true,
        'the face-off has no announceable way out now that the ✕ is gone', fo?.grab);
  check(fo?.focused === true && fo?.keyClosed === true,
        'the grabber cannot be focused and pressed to close', fo);
  /* THE PLAIN TAP, which is the door most players will use and the one the
     keyboard path above cannot vouch for: the click must land ON the grabber
     — not on the card that captured the pointer out from under it — and the
     sheet must go. Both halves of the target are pushed: the drawn bar, and
     the invisible expander 2px below it. */
  check(fo?.tapTarget === 'fograb' && fo?.tapClosed === true,
        'a plain tap on the grabber does not dismiss the face-off',
        { landedOn: fo?.tapTarget, closed: fo?.tapClosed });
  check(fo?.expandTarget === 'fograb' && fo?.expandClosed === true,
        'a tap just under the drawn bar misses the grabber — its touch expander is gone',
        { landedOn: fo?.expandTarget, closed: fo?.expandClosed });

  /* 1b-ii · THE SAME SHEET WITH MOTION REDUCED. It still arrives and it still
     leaves — it just does not travel to do either, so a player who asked the
     OS for stillness is not handed a 340px flight and a 180ms exit. */
  const still = await visit({ door: 'board', motion: 'reduce' });
  const sfo = still.faceoff;
  check(sfo?.visible === true, 'the face-off does not arrive at all with motion reduced', sfo);
  /* ±2px, because the streak cell swaps a loading die for a digit and a
     centred card settles by a pixel when it does — the FLIGHT is 932px */
  check(sfo?.arrive != null && Math.abs(sfo.arrive.first - sfo.arrive.last) <= 2
        && sfo.arrive.washFirst === sfo.arrive.washLast,
        'the face-off still flies in with motion reduced', sfo?.arrive);
  check(sfo?.escInstant === true,
        'the face-off still flies OUT with motion reduced', sfo);
  check(still.errs.length === 0, 'page errors with motion reduced', still.errs);
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
