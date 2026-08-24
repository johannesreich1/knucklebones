// LIVE two-browser test of online match play against the real backend.
// NOT part of the automated gate (needs the two SQL-created e2e users and
// mutates live data). Participant queues/active matches are cleaned before and
// after every run, including failures. Match history and season-rating cleanup
// remain explicit owner actions when the target must not retain probe records.
// See e2e-pvp.mjs for the API-level version. Run: npm run test:live:pvp-ui
// two browser contexts, one live PvP match, then a bot match
import pkg from 'playwright';
const { chromium, devices } = pkg;
import { SUPABASE_AUTH_STORAGE_KEY } from '../src/config.ts';
import { servedBase } from './serve.mjs';
import { readLivePvpConfig } from './support/live-pvp-config.mjs';
import { cleanupLivePvpState } from './support/live-pvp-cleanup.mjs';
// its own origin, on a kernel-picked port: nothing to start by hand, nothing
// for a peer session's gate to collide with (tests/serve.mjs)
const liveConfig = readLivePvpConfig();
if (liveConfig.target !== 'production') {
  throw new Error('The UI live probe uses the production-configured app build and is production-only.');
}
const { supabaseUrl: SUPA, publishableKey: ANON, users } = liveConfig;
const BASE = await servedBase();
const problems = [];
const errs = [];
const participants = [];
let report = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
let browser = null;
try {
  const authenticate = async (email, pass, label) => {
    const r = await fetch(SUPA + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass }),
    });
    const sess = await r.json();
    if (!r.ok || !sess.access_token || !sess.user?.id) {
      // Never stringify an auth response: malformed responses can still carry
      // reusable access or refresh tokens.
      throw new Error(`login failed for ${label}: HTTP ${r.status}; missing required session fields`);
    }
    sess.expires_at ??= Math.floor(Date.now() / 1000) + (sess.expires_in ?? 3600);
    /* a returning device also holds the profile cache (session.ts myProfile
       writes it) — the result screen deals the own plate's NAME from it */
    const pr = await fetch(SUPA + `/rest/v1/profiles?id=eq.${sess.user.id}&select=nickname,rating,avatar`, {
      headers: { apikey: ANON, Authorization: 'Bearer ' + sess.access_token } });
    const prof = (await pr.json())?.[0];
    if (!prof?.nickname) throw new Error(`no profile for ${label}: HTTP ${pr.status}`);
    return { sess, prof };
  };

  /* Authenticate both dedicated accounts before the app boots. Otherwise its
     signed-out path could mint anonymous guests and enqueue them before a
     failed baseline check had a chance to stop the probe. */
  const identities = [];
  for (const [index, user] of users.entries()) {
    const identity = await authenticate(user.email, user.password, `live user ${index ? 'B' : 'A'}`);
    identities.push(identity);
    participants.push({ id: identity.sess.user.id, jwt: identity.sess.access_token });
  }
  const baselineErrors = await cleanupLivePvpState({
    supabaseUrl: SUPA, publishableKey: ANON, participants,
  });
  if (baselineErrors.length) {
    throw new Error(`could not establish a clean live-test baseline: ${baselineErrors.join('; ')}`);
  }

  browser = await chromium.launch();
  const mk = async ({ sess, prof }) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
    /* a fresh context is a NEWCOMER: matchmaking would stop to offer the
       tutorial (ui/firstrun) before the queue panel. Seed a played device. */
    await ctx.addInitScript(([k, v, p]) => {
      localStorage.setItem(k, v);
      localStorage.setItem('knucklebones.online.profile', p);
      localStorage.setItem('knucklebones.v1', JSON.stringify({ played: true }));
    }, [SUPABASE_AUTH_STORAGE_KEY, JSON.stringify(sess), JSON.stringify(prof)]);
    const page = await ctx.newPage();
    page.errs = [];
    page.on('pageerror', e => page.errs.push(e.message));
    await page.goto(BASE + 'index.html');
    await page.waitForTimeout(500);
    await page.tap('#btnOnline');
    // the home's PLAY RANKED deep-links to 'play': a live session drops
    // straight into the queue — no menu stop, no extra tap
    await page.waitForSelector('#onQueue:not([hidden])', { timeout: 8000 });
    return page;
  };
  const A = await mk(identities[0]);  // A queues here
  const B = await mk(identities[1]);  // B pairs on its first join

  const inMatch = p => p.evaluate(() => (document.getElementById('rec')?.textContent ?? '').startsWith('ONLINE')
    && !document.getElementById('ovOnline').classList.contains('on'));
  const snap = p => p.evaluate(() => {
    const S = window.__kb.S;
    const online = window.__kbOnline?.();
    const root = document.getElementById('kbroot');
    const spellBar = document.getElementById('spellBar');
    return { turn: S.turn, bottom: S.bottom, phase: S.phase, busy: S.busy,
             b0: JSON.stringify(S.boards[0]), b1: JSON.stringify(S.boards[1]),
             over: document.getElementById('ovEnd').classList.contains('on'),
             viewer: online?.you ?? null,
             opponentTurn: root.classList.contains('opponent-turn'),
             spellBarDisplay: getComputedStyle(spellBar).display,
             visibleRunes: [...spellBar.querySelectorAll('.rune:not([hidden])')]
               .filter((rune) => !!rune.offsetParent).length };
  });
  const checkLiveTurnPresentation = (who, state) => {
    check(state.spellBarDisplay === 'none' && state.visibleRunes === 0,
      `${who}: ranked play exposed the offline spell rail`, state);
    if (state.over || state.phase === 'over'
        || (state.phase !== 'choose' && state.phase !== 'anim')) return;
    check(state.viewer === 0 || state.viewer === 1,
      `${who}: live snapshot has no authenticated viewer seat`, state);
    check(state.opponentTurn === (state.turn !== state.viewer),
      `${who}: opponent-turn does not match the authenticated viewer`, state);
  };

  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if (await inMatch(A) && await inMatch(B)) break;
    await A.waitForTimeout(400);
  }
  check(await inMatch(A) && await inMatch(B), 'both players did not enter the match');
  const [midA, midB] = await Promise.all([A, B].map(p => p.evaluate(() => window.__kbOnline?.()?.matchId)));
  check(!!midA && midA === midB, 'players are in DIFFERENT matches', { midA, midB });
  if (midA !== midB) throw new Error('abort: separate matches');
  let [initialA, initialB] = [await snap(A), await snap(B)];
  for (let attempt = 0; attempt < 40; attempt++) {
    const ready = (state) => !state.busy && (state.phase === 'choose' || state.phase === 'anim')
      && (state.viewer === 0 || state.viewer === 1);
    if (ready(initialA) && ready(initialB)) break;
    await A.waitForTimeout(200);
    [initialA, initialB] = [await snap(A), await snap(B)];
  }
  check(!initialA.busy && !initialB.busy
      && (initialA.phase === 'choose' || initialA.phase === 'anim')
      && (initialB.phase === 'choose' || initialB.phase === 'anim'),
    'initial ranked turn presentation never settled after sync', { a: initialA, b: initialB });
  checkLiveTurnPresentation('A initial', initialA);
  checkLiveTurnPresentation('B initial', initialB);

  // play to completion: whoever's turn it is taps their first legal column
  let rounds = 0, finished = false;
  while (rounds < 80 && !finished) {
    const [sa, sb] = [await snap(A), await snap(B)];
    if (sa.over && sb.over) { finished = true; break; }
    if (!sa.over) checkLiveTurnPresentation('A round ' + rounds, sa);
    if (!sb.over) checkLiveTurnPresentation('B round ' + rounds, sb);
    for (const [p, s] of [[A, sa], [B, sb]]) {
      if (!s.over && s.phase === 'choose' && s.turn === s.bottom) {
        const col = await p.evaluate(() => {
          const S = window.__kb.S;
          return S.boards[S.bottom].findIndex(c => c.length < 3);
        });
        if (col >= 0) await p.tap(`#botBoard .col[data-col="${col}"]`);
      }
    }
    await A.waitForTimeout(900);
    rounds++;
  }
  // allow the finish handler to fire on both
  await A.waitForTimeout(3000);
  const [fa, fb] = [await snap(A), await snap(B)];
  check(fa.over && fb.over, 'match did not finish on both screens', { fa: fa.over, fb: fb.over, rounds });
  // boards agreed at the end
  check(fa.b0 === fb.b0 && fa.b1 === fb.b1, 'boards diverged between players', { a: fa, b: fb });
  check(!fa.opponentTurn && !fb.opponentTurn,
    'the opponent-turn presentation survived ranked match completion', { a: fa, b: fb });
  check(fa.spellBarDisplay === 'none' && fb.spellBarDisplay === 'none'
      && fa.visibleRunes === 0 && fb.visibleRunes === 0,
    'the ranked result exposed the offline spell rail', { a: fa, b: fb });
  // the finish lands on the SHARED end screen (ui/endscreen, design 36f):
  // two identity plates — you as a button row carrying the points delta, the
  // foe in .theirs — the winner's row gold, a beaten foe stamped. The ranked
  // scoreline drops its labels: the plates carry the names now.
  const endState = p => p.evaluate(() => {
    const plates = [...document.querySelectorAll('#endPlates .pplate')].map(el => ({
      tag: el.tagName, theirs: el.classList.contains('theirs'),
      won: el.classList.contains('wonp'), lost: el.classList.contains('lostp'),
      name: el.querySelector('.nm2')?.textContent ?? '',
      stamp: el.querySelector('.pstamp')?.textContent ?? null,
      delta: el.querySelector('.pdelta')?.textContent ?? null,
    }));
    const ov = document.getElementById('ovEnd');
    let nick = null;
    try { nick = JSON.parse(localStorage.getItem('knucklebones.online.profile') ?? 'null')?.nickname ?? null; }
    catch { /* forgetful host */ }
    return {
      on: ov.classList.contains('on'),
      outcome: ['win', 'lose', 'draw'].find(c => ov.classList.contains(c)) ?? null,
      title: document.getElementById('endTitle').textContent,
      youLbl: document.getElementById('endYouLbl').textContent,
      cpuLbl: document.getElementById('endCpuLbl').textContent,
      againHidden: document.getElementById('btnAgain').hidden,
      againLabel: document.getElementById('btnAgain').textContent,
      platesHidden: document.getElementById('endPlates').hidden,
      plates, nick,
    };
  });
  const [eA, eB] = [await endState(A), await endState(B)];
  for (const [who, e] of [['A', eA], ['B', eB]]) {
    check(e.on, who + ': end screen not shown after the match', e);
    check(!e.platesHidden && e.plates.length === 2, who + ': expected two identity plates', e.plates);
    const [me, foe] = e.plates;
    if (!me || !foe) continue;
    check(me.tag === 'BUTTON' && !me.theirs, who + ': own plate should be a button row', me);
    check(!!e.nick && me.name === e.nick, who + ': own plate does not carry the nickname', { me, nick: e.nick });
    // the foe row's TAG is deliberately unasserted — it is growing a door
    // (face-off) in a parallel change; .theirs is the row's identity
    check(foe.theirs, who + ': foe plate should wear .theirs', foe);
    check(/^[+-]\d+$/.test(me.delta ?? ''), who + ': own plate missing the points delta', me);
    check(e.youLbl === '' && e.cpuLbl === '', who + ': ranked scoreline labels should be empty', e);
    check(!e.againHidden && e.againLabel === 'Next duel', who + ': Next duel action missing', e);
    if (e.outcome === 'win') {
      check(e.title === 'VICTORY' && me.won && !foe.won, who + ': winner row not marked', e);
      check(foe.stamp === 'BEATEN', who + ': beaten foe not stamped', foe);
    } else if (e.outcome === 'lose') {
      check(e.title === 'DEFEAT' && foe.won && !me.won, who + ': loser dressing wrong', e);
      check(foe.stamp === null, who + ': only a win stamps the foe', foe);
    } else {
      check(e.outcome === 'draw' && e.title === 'DEAD HEAT' && !me.won && !foe.won,
        who + ': draw dressing wrong', e);
      check(foe.stamp === null, who + ': a draw must not stamp the foe', foe);
    }
  }
  // the two screens tell ONE story: mirrored outcomes, mirrored names
  check((eA.outcome === 'win' && eB.outcome === 'lose')
    || (eA.outcome === 'lose' && eB.outcome === 'win')
    || (eA.outcome === 'draw' && eB.outcome === 'draw'),
    'outcomes do not mirror across screens', { a: eA.outcome, b: eB.outcome });
  check(eA.plates[1]?.name === eB.plates[0]?.name && eB.plates[1]?.name === eA.plates[0]?.name,
    'plate names do not mirror across screens', { a: eA.plates, b: eB.plates });

  // ---- bot match: alice alone via Next duel, waits past the bot threshold ----
  // close B first: an occluded page gets its timers throttled by headless
  // Chromium, which once slowed A's animation chain past the round budget
  await B.close();
  await A.bringToFront();
  await A.tap('#btnAgain');
  const t1 = Date.now();
  while (Date.now() - t1 < 25000) { if (await inMatch(A)) break; await A.waitForTimeout(500); }
  check(await inMatch(A), 'bot match did not start');
  let brounds = 0;
  // headroom: a bot now takes a RANDOM think (usually fast, rarely ~6s) instead
  // of a fixed beat, so a whole match can run several seconds longer than before
  while (brounds < 120) {
    const s = await snap(A);
    if (s.over) break;
    checkLiveTurnPresentation('bot round ' + brounds, s);
    if (s.phase === 'choose' && s.turn === s.bottom) {
      const col = await A.evaluate(() => {
        const S = window.__kb.S;
        return S.boards[S.bottom].findIndex(c => c.length < 3);
      });
      if (col >= 0) await A.tap(`#botBoard .col[data-col="${col}"]`);
    }
    await A.waitForTimeout(700);
    brounds++;
  }
  await A.waitForTimeout(3000);
  const botFinal = await snap(A);
  check(botFinal.over, 'bot match did not finish', { brounds });
  check(!botFinal.opponentTurn && botFinal.spellBarDisplay === 'none' && botFinal.visibleRunes === 0,
    'the bot match left opponent-turn or the spell rail visible after completion', botFinal);
  // the bot is a ranked opponent like any other: the end screen deals it a plate
  const eBot = await endState(A);
  check(eBot.on && eBot.plates.length === 2, 'bot-match end screen not dealt', eBot);

  check(A.errs.length === 0 && B.errs.length === 0, 'page errors', { a: A.errs.slice(0, 3), b: B.errs.slice(0, 3) });
  report = { rounds, brounds, endA: eA, endB: eB };
} catch (error) {
  errs.push(String(error));
} finally {
  // Stop all polling before cleanup, then terminalize/dequeue with the same
  // participant credentials the probe used. The server is in-process and
  // unref'd, so it leaves with this process.
  try { await browser?.close(); } catch (error) { errs.push(String(error)); }
  errs.push(...await cleanupLivePvpState({
    supabaseUrl: SUPA, publishableKey: ANON, participants,
  }));
}
console.log(JSON.stringify({ ...report, problems, errs }, null, 2));
process.exit(problems.length || errs.length ? 1 : 0);
