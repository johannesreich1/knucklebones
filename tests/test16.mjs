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
const URL = 'http://127.0.0.1:8123/';
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
async function visit({ anonymous = 200, attached = false }) {
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
  await page.route('**/rest/v1/profiles*', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ id: GUEST_ID, nickname: 'TestGuest001', rating: 1000, created_at: new Date().toISOString() }]) }));
  await page.route('**/rest/v1/matches*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/auth/v1/.well-known/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"keys":[]}' }));

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  // the home chip carrying the player's identity IS the door to the account view
  await page.waitForSelector('#homeChip');
  await page.click('#homeChip');
  await page.waitForSelector('#ovOnline', { state: 'attached', timeout: 15000 });
  await page.waitForFunction(() => {
    const a = document.querySelector('#onAccount'), s = document.querySelector('#onAuth');
    return (a && !a.hidden) || (s && !s.hidden);
  }, null, { timeout: 15000 });
  await page.waitForTimeout(250);

  const seen = await page.evaluate(() => {
    const vis = (s) => { const e = document.querySelector(s); if (!e) return false;
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      panel: document.querySelector('#onAccount')?.hidden === false ? 'account' : 'auth',
      title: document.querySelector('#onTitle')?.textContent,
      nickname: document.querySelector('#accName')?.textContent,
      guestBox: vis('#accGuest'),
      signOut: vis('#btnSignOut'),
      actions: [...document.querySelectorAll('#onAuthActs .btn')].map((x) => x.textContent),
    };
  });
  await ctx.close();
  return { seen, errs, signupCalls };
}

try {
  // 1 · the newcomer: no form, a name, a rating, and the offer to keep it
  const fresh = await visit({});
  out.fresh = fresh.seen;
  check(fresh.seen.panel === 'account', 'newcomer was asked to sign in', fresh.seen);
  check(fresh.seen.nickname === 'TestGuest001', 'guest got no nickname', fresh.seen);
  check(fresh.seen.guestBox === true, 'guest was not offered the way up', fresh.seen);
  check(fresh.seen.signOut === false, 'guest offered Sign out — that discards, not signs out', fresh.seen);
  check(fresh.errs.length === 0, 'page errors on the guest path', fresh.errs);

  // 2 · the project with anonymous sign-ins off: degrade to the old panel
  const off = await visit({ anonymous: 422 });
  out.providerOff = off.seen;
  check(off.seen.panel === 'auth', 'no fallback when guests are unavailable', off.seen);
  check(off.seen.actions.join() === 'Sign in,Create account', 'fallback lost its actions', off.seen);
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
