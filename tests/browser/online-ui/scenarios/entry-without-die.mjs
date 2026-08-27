// NO LOADING DIE BETWEEN HOME AND THE QUEUE.
//
// A returning player who asks for a ranked match should look at the searching
// queue, not at a spinner standing in front of it. Two paths used to break
// that, and neither was covered:
//
//   · NEXT DUEL on the result screen held the online shell's own centred die
//     while it re-verified the rune collection, so a second match started
//     behind a wait that a fresh entry does not show.
//   · Home's goOnline() raised the eager #ovLoad die for the whole entry, not
//     just for the lazy chunk's download — so even an already-downloaded
//     chunk painted a die on top of the queue one frame later.
//
// Both are invisible to state assertions: the die is correct DOM in a correct
// panel, it is simply ON SCREEN. So these probes sample FRAMES and watch the
// class attribute, the way loading-panels.mjs samples its entry.
import { RESOURCES } from '../../../../src/i18n/catalogs.ts';

const LOOKING = RESOURCES.en.online.matchmaking.looking;

const REPORT = {
  won: true,
  draw: false,
  forfeit: false,
  my: 48,
  their: 31,
  delta: 21,
  opp: 'NovaComet992',
  oppAvatar: 'die:3:mg',
  oppRating: 1072,
};

const bounded = (promise, message, timeout = 7000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), timeout)),
]);

/* One watcher for both dice. The rAF sampler answers "was it ON SCREEN in a
   frame the player could see"; the class observer additionally catches a
   show/hide pair that opens and closes inside a single frame — which a frame
   sampler would sleep straight through. */
const WATCH = () => {
  window.__kbDieWatch = { frames: 0, eagerVisible: 0, shellVisible: 0,
                          eagerClassEverOn: false, panels: [], stop: false };
  const watch = window.__kbDieWatch;
  const eager = document.getElementById('ovLoad');
  if (eager) {
    new MutationObserver(() => {
      if (eager.classList.contains('on')) watch.eagerClassEverOn = true;
    }).observe(eager, { attributes: true, attributeFilter: ['class'] });
  }
  const onScreen = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && style.visibility !== 'hidden' && style.display !== 'none'
      && Number(style.opacity) > 0.01;
  };
  const sample = () => {
    if (watch.stop) return;
    watch.frames++;
    const shell = document.getElementById('onLoading');
    if (eager?.classList.contains('on') && onScreen(eager)) watch.eagerVisible++;
    if (shell && !shell.hidden && onScreen(shell)) watch.shellVisible++;
    const visible = [...document.querySelectorAll('#ovOnline .panel')]
      .filter((panel) => !panel.hidden && panel.getBoundingClientRect().height > 0)
      .map((panel) => panel.id).join();
    if (visible && watch.panels[watch.panels.length - 1] !== visible) watch.panels.push(visible);
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

const readWatch = (page) => page.evaluate(() => {
  window.__kbDieWatch.stop = true;
  return { ...window.__kbDieWatch };
});

/* NEXT DUEL: hold the rune-collection read the entry re-verifies, so the
   browser must paint the state that wait sits behind. For a returning player
   that is the searching queue — the same seam a fresh entry uses — and never
   the shell die that used to cover it. */
async function nextDuelProbe(page, routes) {
  /* Leave the queue first, so the searching panel asserted below can only be
     one this transition painted — not the one that was already standing.
     Cancel is the queue's own way out; it has no back arrow. */
  await page.click('#btnQueueCancel');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  /* A finished ranked match, staged the way play.ts leaves it: entering the
     match took every menu down, and the result opens over the bare table. */
  await page.evaluate((report) => {
    document.getElementById('ovStart').classList.remove('on');
    window.__kbResult(report);
  }, REPORT);
  await page.waitForSelector('#ovEnd.on', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('#endPlates button').length === 2);
  await page.waitForTimeout(250); // let the result screen's own rune read land
  routes.deferNextRuneResponse();
  await page.evaluate(WATCH);
  await page.click('#btnAgain');
  await bounded(routes.runeRequestStarted, 'Next Duel never re-read the rune collection');
  // two frames of held state: enough for a deferred die to have appeared
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const held = await page.evaluate(() => {
    const message = document.querySelector('#onQueue .qmsg');
    const queue = document.getElementById('onQueue');
    const shell = document.getElementById('onLoading');
    return {
      queueVisible: !!queue && !queue.hidden && queue.getBoundingClientRect().height > 0,
      label: message?.textContent?.trim() ?? null,
      i18n: message?.getAttribute('data-i18n') ?? null,
      clock: document.getElementById('qTime')?.textContent ?? null,
      title: document.getElementById('onTitle')?.textContent ?? null,
      shellDieHidden: shell?.hidden === true,
      endClosed: !document.getElementById('ovEnd')?.classList.contains('on'),
    };
  });
  routes.releaseRuneResponse();
  await bounded(routes.runeRequestFinished, 'the held Next Duel rune read never finished');
  await page.waitForSelector('#onQueue:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(300);
  return { held, watch: await readWatch(page) };
}

/* HOME → RANKED on a chunk that is already downloaded. The first entry of the
   page session may legitimately show the eager die while the chunk loads; the
   SECOND may not, because there is nothing left to wait for. Backing out to
   Home and re-entering is the only way to guarantee that warmth.
   The entry's own account read is held open so the searching queue must stand
   there for many frames — otherwise a die raised over it is gone again before
   a frame sampler can see it, and the regression reads as a class flicker
   rather than as the wait the player actually reported. */
async function warmChunkProbe(page, routes) {
  await page.click('#btnQueueCancel');
  await page.waitForSelector('#ovStart.on', { timeout: 15000 });
  await page.waitForTimeout(120);
  routes.deferNextRuneResponse();
  await page.evaluate(WATCH);
  await page.click('#btnOnline');
  await bounded(routes.runeRequestStarted, 'the warm ranked entry never hydrated');
  await page.waitForTimeout(600);
  const held = await page.evaluate(() => {
    const queue = document.getElementById('onQueue');
    const eager = document.getElementById('ovLoad');
    return {
      queueVisible: !!queue && !queue.hidden && queue.getBoundingClientRect().height > 0,
      label: document.querySelector('#onQueue .qmsg')?.textContent?.trim() ?? null,
      eagerOn: eager?.classList.contains('on') ?? null,
    };
  });
  routes.releaseRuneResponse();
  await bounded(routes.runeRequestFinished, 'the held warm-entry rune read never finished');
  await page.waitForSelector('#onQueue:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(300);
  const watch = await readWatch(page);
  return { held, watch, firstPanel: watch.panels[0] ?? null };
}

/* A DROPPED CHUNK MUST NOT LEAVE THE DIE STANDING. The import can reject — a
   bad deploy, a flaky edge — and the entry then has nothing to hand the screen
   to. What the player must never be left with is the load die sitting on Home
   owning every tap, or an unhandled rejection in place of a released die.
   Two things this arranges deliberately:
   · a COLD context. Once a page has loaded the chunk, WebKit answers the next
     import from cache with no request to intercept, so the failure cannot be
     injected into the page the rest of this tree drives.
   · the app's one-shot recovery reload (boot/platform.ts, bindStaleChunkRecovery)
     ALREADY SPENT. Otherwise the page reloads out from under the assertion and
     a die left standing would be swept away by the reload rather than by the
     entry letting go of it — which is the thing being checked. Its guard flag
     makes that state reachable, and it is a real one: the second dropped
     chunk inside fifteen seconds. */
async function chunkFailureProbe(page) {
  const origin = new URL(page.url()).origin;
  const context = await page.context().browser().newContext({
    viewport: { width: 430, height: 932 }, hasTouch: true, locale: 'en-US',
  });
  const cold = await context.newPage();
  const errs = [];
  cold.on('pageerror', (error) => errs.push(error.message));
  // this context carries no Supabase stubs, so nothing may leave the origin
  await cold.route((url) => !String(url).startsWith(origin), (route) => route.abort());
  await cold.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: () => Promise.resolve({ addEventListener() {} }),
               ready: new Promise(() => {}), controller: null,
               addEventListener() {}, getRegistrations: () => Promise.resolve([]) },
    });
    localStorage.setItem('knucklebones.v1', JSON.stringify({ played: true }));
    sessionStorage.setItem('kb.chunkReload', '1'); // recovery reload already spent
    const loads = Number(sessionStorage.getItem('kb.probeLoads') ?? '0') + 1;
    sessionStorage.setItem('kb.probeLoads', String(loads));
  });
  let attempts = 0;
  await cold.route(/\/assets\/ui-[^/]*\.js$/, async (route) => {
    attempts++;
    /* Fail SLOWLY, and with a 503 rather than a transport abort. Slowly,
       because the warm on pointerdown and the entry on pointerup are
       milliseconds apart and an instant failure could be spent between them;
       503, because it is the realistic shape of a chunk lost to a bad deploy. */
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fulfill({ status: 503, contentType: 'text/plain', body: 'chunk gone' });
  });
  await cold.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
  await cold.waitForSelector('#ovStart.on', { timeout: 15000 });
  await cold.click('#btnOnline');
  /* Well past the point where a successful entry would have painted, so "the
     die let go and Home stands" is a settled fact rather than a race. */
  await cold.waitForTimeout(1500);
  /* And ASK AGAIN. A failure kept in the session's module promise would be
     replayed here — as a module with no openOnline on it, which is a thrown
     TypeError rather than a second quiet miss. */
  await cold.click('#btnOnline');
  await cold.waitForTimeout(1500);
  const afterFailure = await cold.evaluate(() => {
    const eager = document.getElementById('ovLoad');
    const rect = eager?.getBoundingClientRect();
    const style = eager ? getComputedStyle(eager) : null;
    const button = document.getElementById('btnOnline');
    const box = button?.getBoundingClientRect();
    const hit = box ? document.elementFromPoint(box.left + box.width / 2,
      box.top + box.height / 2) : null;
    return {
      home: document.getElementById('ovStart')?.classList.contains('on') ?? null,
      /* the shell only exists once the chunk has run, so its absence is the
         failure and its presence would be a load that quietly succeeded */
      shellInstalled: !!document.getElementById('ovOnline'),
      dieClassOn: eager?.classList.contains('on') ?? null,
      dieOnScreen: !!rect && rect.height > 0 && Number(style?.opacity ?? 0) > 0.01,
      // Home owns the hit again — a die left up would take it, class or no class
      homeOwnsTheHit: !!hit && !!button?.contains(hit),
      reloaded: Number(sessionStorage.getItem('kb.probeLoads') ?? '0') > 1,
    };
  });
  await context.close();
  return { afterFailure, attempts, errs };
}

export async function runEntryWithoutDieScenarios(suite) {
  const { visit, out, check } = suite;

  const nextDuel = await visit({ door: 'play', named: true, probe: nextDuelProbe });
  out.nextDuelEntryWait = nextDuel.probeResult;
  const held = nextDuel.probeResult?.held;
  const duelWatch = nextDuel.probeResult?.watch;
  check(held?.queueVisible === true && held.label === LOOKING
      && held.i18n === 'online:matchmaking.looking' && held.title === 'MATCHMAKING'
      && held.shellDieHidden === true && held.endClosed === true,
  'Next Duel did not hold its wait in the localized searching queue', held);
  check(duelWatch?.frames > 0 && duelWatch.shellVisible === 0
      && duelWatch.eagerVisible === 0 && duelWatch.eagerClassEverOn === false,
  'a loading die was on screen during the Next Duel transition', duelWatch);
  check(duelWatch?.panels?.join('|') === 'onQueue',
    'Next Duel painted a panel other than the searching queue', duelWatch?.panels);
  check(nextDuel.errs.length === 0, 'page errors during the Next Duel transition', nextDuel.errs);

  const warm = await visit({ door: 'play', named: true, probe: warmChunkProbe });
  out.warmChunkEntry = warm.probeResult;
  const warmWatch = warm.probeResult?.watch;
  const warmHeld = warm.probeResult?.held;
  check(warmHeld?.queueVisible === true && warmHeld.label === LOOKING
      && warmHeld.eagerOn === false,
  'a warm ranked entry stood behind the eager loading die while it hydrated', warmHeld);
  check(warmWatch?.frames > 0 && warmWatch.eagerVisible === 0
      && warmWatch.eagerClassEverOn === false,
  'Home raised the eager loading die for a chunk that was already loaded', warmWatch);
  check(warm.probeResult?.firstPanel === 'onQueue',
    'a warm ranked entry painted something other than the searching queue first',
    warm.probeResult);
  check(warmWatch?.shellVisible === 0,
    'a warm ranked entry raised the online shell die over the searching queue', warmWatch);
  check(warm.errs.length === 0, 'page errors during a warm ranked entry', warm.errs);

  const dropped = await visit({ door: 'play', named: true, probe: chunkFailureProbe });
  out.droppedChunkRecovery = dropped.probeResult;
  const failure = dropped.probeResult?.afterFailure;
  check(failure?.shellInstalled === false && failure.reloaded === false
      && dropped.probeResult.attempts === 1,
  'the dropped-chunk probe did not actually drop the chunk', dropped.probeResult);
  check(failure?.home === true && failure.dieClassOn === false
      && failure.dieOnScreen === false && failure.homeOwnsTheHit === true,
  'a dropped online chunk left the loading die standing over Home', failure);
  check(dropped.probeResult?.errs?.length === 0,
    'a dropped online chunk raised an unhandled page error', dropped.probeResult?.errs);
}
