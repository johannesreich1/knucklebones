import pkg from 'playwright';
const { chromium, devices } = pkg;
import { serveTree } from './serve.mjs';
/* Served over LOCAL HTTP for the same reason as test10: the settings-persist
   coda reloads and asserts the flags came back, and Chromium's file://
   DOMStorage can hydrate the reloaded document from a stale disk commit
   straight through the keeper page (run 32486960831 lost this suite's write
   the same afternoon test10 lost its own twice). One live http-origin area,
   no disk race. Own server on a kernel-picked port, gone with the process
   (tests/serve.mjs), so no peer session's gate can answer it. The remaining
   file suites keep covering file://. */
const { url } = await serveTree('.');   // the repo root: the single-file artifact is built there
const F = url + 'knucklebones-neon.html';
const browser = await chromium.launch();
const problems = [], errs = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
/* over http the single-file page would try to register its service worker
   (file:// never attempts it) and 404 on /sw.js — not this suite's subject,
   and the console error would fail the gate. Make the capability absent, the
   same world every file:// suite already runs in. */
await ctx.addInitScript(() => { try { delete Navigator.prototype.serviceWorker; } catch { /* strict hosts keep it */ } });
await ctx.addInitScript(() => { const k = 'knucklebones.v1', cur = JSON.parse(localStorage.getItem(k) || '{}'); if (!cur.played) { cur.played = true; localStorage.setItem(k, JSON.stringify(cur)); } });   // an experienced player: the first-run tutorial offer is test19's subject
const page = await ctx.newPage();
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(F); await page.waitForTimeout(500);

// start collecting every score popup as it appears
await page.evaluate(() => {
  window.__pops = [];
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.classList && n.classList.contains('pts')) {
        window.__pops.push({ text: n.textContent, board: n.closest('#topBoard') ? 'top' : 'bot' });
      }
    }
  }).observe(document.getElementById('tableEl'), { childList: true, subtree: true });
});

// ===== hud shape: no wordmark in-game, exactly settings + menu =====
out.hud = await page.evaluate(() => ({
  brand: !!document.querySelector('.hud .brand'),
  icons: [...document.querySelectorAll('.hud .ico')].map(b => b.id),
  titleStillNamed: document.querySelector('#ovStart h1').textContent === 'KNUCKLEBONES',
}));
check(!out.hud.brand, 'wordmark still in the in-game hud', out.hud);
check(out.hud.icons.join(',') === 'btnLeave', 'hud must hold ONLY the way out', out.hud);
check(out.hud.titleStillNamed, 'title screen lost the name', out.hud);

// ===== popups, deterministically via the tutorial (home strip button) =====
// the tutorial now lives one level in, behind HOW TO PLAY
await page.tap('#btnLearn'); await page.waitForTimeout(320);
await page.tap('#btnLearnTut'); await page.waitForTimeout(500);
await page.tap('#coach');
async function waitChoose(maxMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await page.evaluate(() => window.__kb.S.phase);
    if (s === 'choose' || s === 'over') return s;
    await page.waitForTimeout(100);
  }
  return 'timeout';
}
await waitChoose();
await page.tap('#botBoard .col[data-col="0"]');   // first 4 → +4
await waitChoose();
await page.tap('#botBoard .col[data-col="0"]');   // second 4 → +12 (16-4), gold
await waitChoose();
await page.tap('#botBoard .col[data-col="1"]');   // 5 smashes CPU's 5 → +5 and −5
await page.waitForTimeout(1500);
out.pops = await page.evaluate(() => window.__pops);
const texts = out.pops.map(p => p.text + '@' + p.board);
check(texts.includes('+4@bot'), 'no +4 popup on first placement', texts);
check(texts.includes('+12@bot'), 'multiplier popup not +12', texts);
check(texts.includes('+5@bot'), 'no +5 popup on destruction turn', texts);
check(texts.includes('−5@top'), 'no −5 popup on the destroyed column', texts);
// CPU placements pop too
check(out.pops.some(p => p.board === 'top' && p.text.startsWith('+')), 'CPU placements never pop', texts);
// popups clean themselves up — wait until the game is idle so nothing is mid-flight
await waitChoose();
await page.waitForTimeout(1300);
out.leftover = await page.evaluate(() => document.querySelectorAll('.pts').length);
check(out.leftover === 0, 'popups leak into the DOM', out.leftover);

// quit tutorial (via Settings — the sheet holds the quit button now),
// popups must also fire in a NORMAL game (they are not tutorial-only)
await page.tap('#btnLeave'); await page.waitForTimeout(300);
await page.tap('#btnAskYes'); await page.waitForTimeout(400);
await page.evaluate(() => { window.__pops = []; });
await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
await page.tap('#btnPlay'); await page.waitForTimeout(1500);
if (await waitChoose() === 'choose') {
  const lg = await page.evaluate(() => window.__kb.S.boards[1].map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0));
  await page.tap(`#botBoard .col[data-col="${lg[0]}"]`);
  await page.waitForTimeout(1000);
}
out.normalPops = await page.evaluate(() => window.__pops.filter(p => p.board === 'bot').length);
check(out.normalPops >= 1, 'no score popup in normal play', out.normalPops);
// while strategy previews stay off
out.normalPills = await page.evaluate(() => document.querySelectorAll('.chip .dl.show').length);
check(out.normalPills === 0, 'previews leaked back into normal play', out.normalPills);

// ===== settings panel — a HOME sheet since the HUD became quit-only =====
await page.evaluate(() => window.__kb.goHome());
await page.waitForTimeout(300);
await page.tap('#btnSettingsHome'); await page.waitForTimeout(400);
out.settingsOpen = await page.evaluate(() => ({
  on: document.getElementById('ovSettings').classList.contains('on'),
  sndOn: document.querySelector('#sndSeg button.on')?.dataset.s,
  faceOn: document.querySelector('#faceSeg button.on')?.dataset.f,
}));
check(out.settingsOpen.on && out.settingsOpen.sndOn === '1' && out.settingsOpen.faceOn === 'pips',
      'settings did not open with current values', out.settingsOpen);

await page.tap('#sndSeg button[data-s="0"]'); await page.waitForTimeout(200);
await page.tap('#faceSeg button[data-f="nums"]'); await page.waitForTimeout(200);
// Settings holds the two toggles and nothing else — the rules are reached
// through the HOW TO PLAY hub on home, which is now their ONLY door.
out.settingsIsToggles = await page.evaluate(() => ({
  how2: !!document.getElementById('btnHow2'),
  quit: !!document.querySelector('#ovSettings #btnMenu'),
  buttons: [...document.querySelectorAll('#ovSettings .pbody .btn')].length,
}));
check(!out.settingsIsToggles.how2 && !out.settingsIsToggles.quit && out.settingsIsToggles.buttons === 0,
      'settings still carries a button that belongs elsewhere', out.settingsIsToggles);
await page.tap('#btnSettingsBack'); await page.waitForTimeout(300);
await page.tap('#btnLearn'); await page.waitForTimeout(320);
await page.tap('#btnLearnRules'); await page.waitForTimeout(400);
out.help = await page.evaluate(() => ({
  rules: document.getElementById('ovRules').classList.contains('on'),
  settings: document.getElementById('ovSettings').classList.contains('on'),
}));
check(out.help.rules && !out.help.settings, 'help did not open from the hub', out.help);
await page.tap('#btnCloseRules'); await page.waitForTimeout(300);

// Choices persist across reload — but WAIT FOR THE WRITE first: this reload
// raced the save on CI's slow runner (2026-08-20, same class as test10's).
// The poll makes the wait deterministic and names the true failure when the
// save itself never lands.
await page.waitForFunction(() => {
  try { const d = JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}');
        return d.sound === false && d.numerals === true; }
  catch { return false; }
}, null, { timeout: 8000 }).catch(() => { /* the check below names the failure */ });
out.savedSettings = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}');
  return d.sound === false && d.numerals === true;
});
check(out.savedSettings, 'settings were never SAVED — the write itself is missing', out);
// Same reload hazard as test10: over file:// this page is the origin's only
// document, and its teardown races the storage area's disk commit (CI reds
// 2026-08-21, defaults-after-reload while the poll above passed). The keeper
// pins the area across the reload; the read-back is polled, not slept for.
const keeper = await ctx.newPage();
await keeper.goto(F);
await keeper.evaluate(() => localStorage.length);   // binds the storage area
await page.reload();
await page.waitForFunction(() => window.__kb?.S?.sound === false && window.__kb.S.numerals === true,
  null, { timeout: 8000 }).catch(() => { /* the check below names the failure */ });
out.persist = await page.evaluate(() => ({
  sound: window.__kb.S.sound, numerals: window.__kb.S.numerals,
  cls: document.documentElement.classList.contains('numerals'),
  ...(window.__kb.S.sound === false ? {} : { raw: localStorage.getItem('knucklebones.v1') }),
}));
await keeper.close();
check(out.persist.sound === false && out.persist.numerals === true && out.persist.cls,
      'settings did not persist', out.persist);

/* Settings is a HOME sheet now: mid-match the HUD asks one question (quit),
   and sound/dice-faces live where nothing is at stake. */
await page.evaluate(() => window.__kb.goHome());
await page.waitForTimeout(300);
await page.tap('#btnSettingsHome'); await page.waitForTimeout(300);
out.sheet = await page.evaluate(() => ({
  reset: !!document.getElementById('btnResetStats'),
  done: [...document.querySelectorAll('#ovSettings .btn')].some(b => /done/i.test(b.textContent)),
  back: document.querySelector('#ovSettings .shead #btnSettingsBack')?.textContent ?? '',
  title: document.querySelector('#ovSettings .shead .ttl')?.textContent ?? '',
  quitInSheet: !!document.querySelector('#ovSettings #btnMenu'),
  buildTag: !!document.querySelector('#ovSettings #buildTag'),
}));
check(!out.sheet.quitInSheet, 'Quit is still inside the Settings sheet', out.sheet);
check(out.sheet.buildTag, 'the build tag is not at the bottom of Settings', out.sheet);
check(!out.sheet.reset, 'Reset record still in Settings', out.sheet);
check(!out.sheet.done, 'Settings still has a bottom Done button', out.sheet);
// Settings is a PAGE below Home now (user call, 2026-08-21): ‹ left like
// OFFLINE and the ladder, not the old sheet ✕ on the right
check(out.sheet.back === '‹' && out.sheet.title === 'SETTINGS', 'Settings page header wrong', out.sheet);
await page.tap('#btnSettingsBack'); await page.waitForTimeout(300);
out.sheetClosed = await page.evaluate(() => !document.getElementById('ovSettings').classList.contains('on'));
check(out.sheetClosed, 'Settings ‹ did not close the page', out.sheetClosed);

// ===== the iOS back gesture (ui/swipeback): an edge swipe presses the =====
// header's own ‹ — same handler as the button, so the two cannot disagree
const edgeSwipe = () => page.evaluate(() => {
  const mk = (x, y) => new Touch({ identifier: 7, target: document.body, clientX: x, clientY: y });
  const fire = (type, t) => document.body.dispatchEvent(new TouchEvent(type, {
    touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true }));
  fire('touchstart', mk(12, 300));
  for (const x of [30, 55, 90]) fire('touchmove', mk(x, 304));
  fire('touchend', mk(90, 304));
});
await page.tap('#btnSettingsHome'); await page.waitForTimeout(400);
await edgeSwipe(); await page.waitForTimeout(500);   // .ov visibility flips .28s after .on drops
out.swipe = await page.evaluate(() => ({
  on: document.getElementById('ovSettings').classList.contains('on'),
  vis: getComputedStyle(document.getElementById('ovSettings')).visibility,
}));
check(!out.swipe.on && out.swipe.vis === 'hidden', 'edge swipe did not close Settings', out.swipe);
// home is the root — the same swipe there must go nowhere
await edgeSwipe(); await page.waitForTimeout(300);
out.swipeHome = await page.evaluate(() =>
  [...document.querySelectorAll('.ov.on')].map(o => o.id).join(','));
check(out.swipeHome === 'ovStart', 'edge swipe on home navigated somewhere', out.swipeHome);

// ===== the HUD badge names what is in play, and explains each of it =====
// Reported bug: tapping the badge opened the modes library online and did
// nothing offline, because the listener lived inside the online chunk. Both
// flows now paint the badge through render.paintBadge and boot binds ONE
// delegated tap against the chip's data-lib, so neither the affordance nor a
// second roster can go missing on one side.
//
// The badge is a row of chips: the mode always, the dealt spell beside it. It
// carries no tally (user call) — and the tally was how classic alone lost the
// affordance, since S.scoring is 0 for CLASSIC and the old `if (S.scoring)`
// fell straight through to the win/loss line. So classic is tested FIRST here.
const chipsNow = () => page.evaluate(() => {
  const r = document.getElementById('rec');
  return {
    text: r.textContent.replace(/\s+/g, ' ').trim(),
    chips: [...r.querySelectorAll('.rchip')].map(c => {
      const b = c.getBoundingClientRect(), i = c.querySelector('.mi');
      return { lib: c.dataset.lib ?? null, id: c.dataset.id ?? null,
               name: c.textContent.replace(/[\sⓘⓘ]+/g, ' ').trim(),
               tappable: c.classList.contains('tapmode'), icon: !!c.querySelector('svg'),
               shown: b.width > 0 && b.height > 0,
               // the ⓘ rule must reach OFFLINE — it lived in the online chunk once
               infoStyled: !!i && getComputedStyle(i).marginLeft !== '0px' };
    }),
  };
});
/* THE ROSTERS, READ FROM HOW TO PLAY — twice a guard. They are the source of
   truth the badge's card must agree with word for word and hue for hue (both
   are built from the registries by ui/library, and the sheet reuses the very
   markup the roster card is made of), and they are the door that had to SURVIVE
   the badge changing destination: a chip no longer opens a roster, so if the
   Learn hub had come along with it the whole library would be unreachable. */
const rosterEntry = async (btn, ov, id) => {
  await page.tap('#btnLearn'); await page.waitForTimeout(320);
  await page.tap(btn); await page.waitForTimeout(420);
  const r = await page.evaluate(([ov, id]) => {
    const o = document.getElementById(ov);
    const c = o?.querySelector(`.modecard[data-mode="${id}"]`);
    const h = c?.querySelector('.mchead');
    return { on: o?.classList.contains('on') ?? false,
             name: c?.querySelector('.mcname')?.textContent?.trim() ?? '',
             detail: c?.querySelector('.mcdetail')?.textContent?.trim() ?? '',
             // the entry's OWN hue, as painted — not the token it came from
             hue: h ? getComputedStyle(h).color : '' };
  }, [ov, id]);
  await page.tap(`[data-close="${ov}"]`); await page.waitForTimeout(300);
  await page.tap('#btnLearnBack'); await page.waitForTimeout(340);
  return r;
};
out.rosterMode = await rosterEntry('#btnLearnModes', 'ovModes', 'singlestrike');
out.rosterSpell = await rosterEntry('#btnLearnSpells', 'ovSpells', 'ward');
for (const [k, r] of [['modes', out.rosterMode], ['spells', out.rosterSpell]]) {
  check(r.on, `HOW TO PLAY no longer opens the ${k} library`, r);
  check(r.name.length > 0 && r.detail.length > 20, `the ${k} roster entry is empty`, r);
}

const playLocal = async (mode, spell) => {
  await page.evaluate(([m, s]) => {
    window.__kb.S.localMode = m; window.__kb.S.spell = s; window.__kb.openPractice();
  }, [mode, spell]);
  await page.tap('#btnPlay'); await page.waitForTimeout(1200);
};
const leaveGame = async () => {
  await page.tap('#btnLeave'); await page.waitForTimeout(250);
  await page.tap('#btnAskYes'); await page.waitForTimeout(400);
};

// CLASSIC, no spell: one chip, naming the mode, tappable — no record anywhere
await playLocal(0, '');
out.badgeClassic = await chipsNow();
check(out.badgeClassic.chips.length === 1, 'classic should show exactly one chip', out.badgeClassic);
check(out.badgeClassic.chips[0]?.id === 'classic' && out.badgeClassic.chips[0]?.tappable,
  'CLASSIC must name itself and open its rules like every other mode', out.badgeClassic);
check(!/\bW\b|\bL\b|\bP1\b|\bP2\b/.test(out.badgeClassic.text),
  'the badge still carries a tally — it names what is played, not the score', out.badgeClassic.text);
await leaveGame();

// SINGLE STRIKE + WARD: two chips, each iconed, tappable and ⓘ-marked
await playLocal(4, 'ward');
out.badge = await chipsNow();
check(out.badge.chips.length === 2, 'a dealt spell must add its own chip', out.badge);
check(out.badge.chips[0]?.id === 'singlestrike' && /SINGLE STRIKE/.test(out.badge.chips[0]?.name),
  'the mode chip does not name the mode in play', out.badge);
check(out.badge.chips[1]?.id === 'ward' && out.badge.chips[1]?.lib === 'spells',
  'the spell chip does not name the rune dealt', out.badge);
check(out.badge.chips.every(c => c.shown && c.icon && c.tappable && c.infoStyled),
  'a chip is not a shown, iconed, tappable, ⓘ-marked control offline', out.badge);

/* ===== EACH CHIP DEALS ITS OWN CARD (user call 2026-08-23) =====
   A chip used to throw the WHOLE roster up as a full-screen overlay and leave
   the player to find the line they asked about. It deals the ONE entry now, on
   the sheet the ladder's face-off rides in (ui/sheet) — the SAME component, so
   the arrival, the wash, the 96px commit line, the flick, the spring home, the
   backdrop tap and the grabber are one implementation guarded in two suites
   (test16 drives the face-off's copy of these very numbers).
   Every line below reads PIXELS: a card that merely appeared in the DOM, a
   tint that never reached the paint, or a drag the card ignored all agree with
   the DOM perfectly (test13's lesson). And both chips walk the same steps,
   because a row of chips that behaves differently per roster is the bug the
   badge was made a row to prevent. */
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
// one door in, used for every reopen below: arm the sampler, tap the chip, and
// let the 340ms arrival land before anything is measured
const openCard = async (lib) => {
  await armFlight();
  await page.tap(`#rec .rchip[data-lib="${lib}"]`);
  await page.waitForTimeout(520);
  /* A chip must deal a CARD, not a roster. Whatever else the tap threw up is
     reported and then swept: a regression that reopens the old full-screen
     library leaves it covering the screen, and every later step of this walk
     would report a 30s timeout on it instead of the door that actually broke. */
  const left = await page.evaluate(() =>
    [...document.querySelectorAll('.ov.on')].map((o) => o.id).join(','));
  if (left) {
    await page.evaluate((ids) => ids.split(',').forEach((i) =>
      document.getElementById(i)?.classList.remove('on')), left);
    await page.waitForTimeout(320);   // .ov hides .28s after .on drops
  }
  return left;
};
const cardGone = () => page.waitForFunction(() => !document.querySelector('.faceoff'),
                                            null, { timeout: 4000 }).then(() => true, () => false);
const readCard = () => page.evaluate(() => {
  const ov = document.querySelector('.faceoff'), c = ov?.querySelector('.focard');
  if (!ov || !c) return null;
  const r = c.getBoundingClientRect();
  /* the pixel test, not the rect test: a card under something else is present
     in the DOM and invisible on screen. elementFromPoint answers what the
     PLAYER gets. */
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const head = ov.querySelector('.mchead');
  const f = window.__fo.frames;
  return {
    visible: r.width > 0 && r.height > 0 && ov.contains(hit),
    role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'),
    label: c.getAttribute('aria-label'),
    name: ov.querySelector('.mcname')?.textContent?.trim() ?? '',
    blurb: ov.querySelector('.mcblurb')?.textContent?.trim() ?? '',
    detail: ov.querySelector('.mcdetail')?.textContent?.trim() ?? '',
    icon: !!ov.querySelector('.mchead svg'),
    /* THE TINT, AS PAINTED. The heading burns with the entry's own hue and the
       frame catches it; the rule text must NOT — a detail paragraph tinted to
       its mode is a detail paragraph nobody finishes. */
    hue: head ? getComputedStyle(head).color : '',
    border: getComputedStyle(c).borderTopColor,
    detailColor: getComputedStyle(ov.querySelector('.mcdetail')).color,
    /* IT CAME UP FROM THE BOTTOM. Not "a class was added": the card's own box
       started far below where it settled and climbed, and the wash was thinner
       then than it is now. The first sample is whatever frame the rAF caught,
       so this is about DISTANCE TRAVELLED, not about catching frame zero. */
    arrive: f.length ? { first: f[0].top, last: f[f.length - 1].top, vh: window.__fo.vh,
                         washFirst: f[0].a, washLast: f[f.length - 1].a,
                         rose: f.every((s, i) => i === 0 || s.top <= f[i - 1].top + 1) } : null,
    rest: Math.round(r.top),
  };
});

const WANT = { modes: out.rosterMode, spells: out.rosterSpell };
for (const lib of ['modes', 'spells']) {
  const roster = WANT[lib];
  // no roster came with it: a chip is not a door to the whole library any more
  const left = out['cardRosters_' + lib] = await openCard(lib);
  const c = out['card_' + lib] = await readCard();
  check(!!c && c.visible, `tapping the ${lib} chip deals no card the player can see`, c);
  check(c?.name === roster.name && c?.detail === roster.detail,
    `the ${lib} card does not say what the roster says about the entry in play`,
    { card: { name: c?.name, detail: c?.detail }, roster });
  check((c?.detail?.length ?? 0) > 20 && c?.icon && (c?.blurb?.length ?? 0) > 0,
    `the ${lib} card is missing the entry's icon, blurb or rule`, c);
  check(left === '', `the ${lib} chip still throws the whole roster up instead of the entry`, left);
  // the tint is the ENTRY'S OWN, the same hue the roster paints it in
  check(c?.hue === roster.hue, `the ${lib} card is not lit by that entry's hue`,
    { card: c?.hue, roster: roster.hue });
  check(c?.border !== 'rgba(255, 255, 255, 0.15)' && c?.border !== c?.detailColor,
    `the ${lib} card wears the plain frame — the tint never reached the border`, c);
  check(c?.detailColor === 'rgb(198, 211, 238)',
    `the ${lib} card tinted its rule text; the rule has to stay readable`, c?.detailColor);
  // it ARRIVED, from below, with the wash thickening behind it
  check(c?.arrive?.rose === true && (c?.arrive?.first - c?.arrive?.last) > 40,
    `the ${lib} card did not travel up from the bottom`, c?.arrive);
  check((c?.arrive?.washFirst ?? 1) < (c?.arrive?.washLast ?? 0),
    `the wash did not fade in with the ${lib} card`, c?.arrive);
  // the screen reader's door: a real labelled dialog on a real labelled button
  check(c?.role === 'dialog' && c?.modal === 'true' && c?.label === roster.name,
    `the ${lib} card is not an announceable dialog naming its entry`, c);
  // and the same way out on both: a tap outside
  await page.mouse.click(8, 8);
  out['cardBackdrop_' + lib] = await cardGone();
  check(out['cardBackdrop_' + lib], `a tap outside does not dismiss the ${lib} card`, null);
}
// the two cards are LIT DIFFERENTLY — one tint for the mode, another for the
// rune, both straight off the registry
check(out.card_modes?.hue !== out.card_spells?.hue &&
      out.card_modes?.border !== out.card_spells?.border,
  'a mode and a spell were dealt in the same colour', { m: out.card_modes?.hue, s: out.card_spells?.hue });

/* THE DRAG, on the badge's card as on the ladder's: past 96px the release
   sends it away, short of that it springs home. Both are read as pixels —
   where the card is while the finger holds it, and whether it is on screen
   after the lift. */
await openCard('modes');
const grip = await page.evaluate(() => {
  const el = document.querySelector('.focard');
  if (!el) return null;
  const c = el.getBoundingClientRect();
  return { x: Math.round(c.x + c.width / 2), y: Math.round(c.top + 7), rest: Math.round(c.top) };
});
check(!!grip, 'the mode chip dealt no card to drag', null);
if (grip) {
  const dragTo = async (dist, steps = 8, pace = 16) => {
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(grip.x, grip.y + Math.round((dist * i) / steps));
      if (pace) await page.waitForTimeout(pace);
    }
  };
  // (a) 44px, short of the line: the card follows the finger, then springs home
  await dragTo(44);
  out.cardHeld = await page.evaluate(() => {
    const c = document.querySelector('.focard')?.getBoundingClientRect();
    return c ? Math.round(c.top) : null;
  });
  check(out.cardHeld - grip.rest > 30, 'the card did not follow the finger down', { held: out.cardHeld, rest: grip.rest });
  // a finger that pauses before lifting is a change of mind, not a flick — which
  // keeps this about the DISTANCE rule, not the velocity one
  await page.waitForTimeout(160);
  await page.mouse.up();
  await page.waitForTimeout(420);
  out.cardSprung = await page.evaluate(() => {
    const c = document.querySelector('.faceoff .focard')?.getBoundingClientRect();
    return { alive: !!document.querySelector('.faceoff'), top: c ? Math.round(c.top) : null };
  });
  check(out.cardSprung.alive && Math.abs(out.cardSprung.top - grip.rest) <= 2,
    'a short drag did not spring the card home', { ...out.cardSprung, rest: grip.rest });
  // (b) 150px, past the line: released, it goes
  await dragTo(150);
  await page.waitForTimeout(160);
  await page.mouse.up();
  out.cardDragClosed = await cardGone();
  check(out.cardDragClosed, 'a drag past the commit line did not dismiss the card', null);
}

/* THE KEYBOARD AND THE SCREEN READER. A gesture is silent and unreachable, so
   the mark that promises it is also a real, labelled, focusable button. */
await openCard('spells');
out.cardGrab = await page.evaluate(() => {
  const b = document.querySelector('.fograb');
  if (!b) return null;
  b.focus();
  return { tag: b.tagName, label: b.getAttribute('aria-label') ?? '',
           focusable: b.tabIndex >= 0 && !b.disabled, focused: document.activeElement === b };
});
check(out.cardGrab?.tag === 'BUTTON' && out.cardGrab?.label.length > 0 &&
      out.cardGrab?.focusable && out.cardGrab?.focused,
  'the card has no announceable, focusable way out', out.cardGrab);
await page.keyboard.press('Enter');
out.cardKeyClosed = await cardGone();
check(out.cardKeyClosed, 'the keyboard door does not dismiss the card', null);
/* Escape too — and, the half that matters, IT MUST NOT REACH PAST THE CARD.
   boot.ts stands its own Escape handler down while a sheet is up, because that
   handler also disarms an armed spell and sweeps the overlays behind. Without
   that guard the player aims a rune, taps the chip to check what the mode
   does, presses Escape to put the card away — and the rune is disarmed too.
   The old assertion only asked whether the card went, which a broken guard
   also satisfies: deleting boot's `if(sheetOpen()) return;` left this suite
   green while the rune was quietly lost. So this arms a spell FIRST and reads
   it back afterwards. */
await openCard('modes');
await page.evaluate(() => window.__kb.spells.arm('ward'));
out.armedBeforeEsc = await page.evaluate(() => ({
  armed: window.__kb.S.spellArmed,
  casting: document.documentElement.classList.contains('casting'),
}));
await page.keyboard.press('Escape');
out.cardEscClosed = await cardGone();
out.armedAfterEsc = await page.evaluate(() => ({
  armed: window.__kb.S.spellArmed,
  casting: document.documentElement.classList.contains('casting'),
}));
check(out.cardEscClosed, 'Escape does not dismiss the card', null);
check(out.armedBeforeEsc?.armed === 'ward', 'the probe never armed the rune', out.armedBeforeEsc);
check(out.armedAfterEsc?.armed === 'ward',
  'ESCAPE REACHED PAST THE CARD AND DISARMED THE RUNE the player had aimed',
  { before: out.armedBeforeEsc, after: out.armedAfterEsc });
// and a SECOND Escape, with no card up, is the one that disarms
await page.keyboard.press('Escape');
out.armedAfterSecond = await page.evaluate(() => window.__kb.S.spellArmed);
check(out.armedAfterSecond === null,
  'with the card gone, Escape must go back to disarming the rune', out.armedAfterSecond);
await leaveGame();

// RANDOM resolves at the deal: the badge must name the rune, never "random"
await playLocal(0, 'random');
out.badgeRandom = await chipsNow();
check(out.badgeRandom.chips.length === 2 && out.badgeRandom.chips[1].id !== 'random',
  'RANDOM must name the rune actually dealt, not the promise to draw one', out.badgeRandom);
await leaveGame();

console.log(JSON.stringify({ out, problems, errs }, null, 2));
await browser.close();   // the server is in-process and unref'd — it goes with us
