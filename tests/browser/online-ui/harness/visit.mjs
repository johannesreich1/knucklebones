import { installOnlineRoutes } from './routes.mjs';
import { readOnlineView } from './read-view.mjs';
import { probeFaceoff } from '../scenarios/faceoff-probe.mjs';
import { probeAccountActions } from './account-probes.mjs';

/* One harness: open the app with Supabase answering however this case wants,
   tap Account, and report what the player is looking at. */
export function createVisit({ browser, URL, SESSION, GUEST_ID }) {
  return async function visit({
    anonymous = 200,
    attached = false,
    door = 'chip',
    named = false,
    motion = null,
  }) {
    // NO isMobile here: under WebKit it quietly disables page.route(), and a
    // stub that never fires would let this suite talk to the live backend.
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true,
                                           ...(motion ? { reducedMotion: motion } : {}) });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    const signupCalls = await installOnlineRoutes(page, {
      anonymous, attached, door, named, SESSION, GUEST_ID,
    });
    if (door === 'play') {
      /* Ranked newcomers stop at the once-only tutorial offer. This probe is
         about the queue the returning player sees, so enter as a played device. */
      await page.addInitScript(() => localStorage.setItem(
        'knucklebones.v1', JSON.stringify({ played: true }),
      ));
    }

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    // the home chip carrying the player's identity IS the door to the account view
    const entry = door === 'board' ? '#btnBoardHome' : door === 'play' ? '#btnOnline' : '#homeChip';
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
    await page.click(entry);
    await page.waitForSelector('#ovOnline', { state: 'attached', timeout: 15000 });
    if (door === 'play') {
      await page.waitForSelector('#onQueue:not([hidden])', { timeout: 15000 });
    } else if (door === 'board') {
      await page.waitForSelector('#ovOnline .lb .lrow', { timeout: 15000 });
    } else {
      await page.waitForFunction(() => {
        const a = document.querySelector('#onAccount'), s = document.querySelector('#onAuth');
        return (a && !a.hidden) || (s && !s.hidden);
      }, null, { timeout: 15000 });
    }
    await page.waitForTimeout(250);
    // online.css has now landed. Its selectors may style its own screens and
    // body-level sheets, but must not repaint the eager Home hiding underneath.
    const homeAfterOnline = await homeSnapshot();

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
      await page.click('#btnQueueCancel');
      await page.waitForTimeout(50);
      await ctx.close();
      return { queueLabel: samples, errs, signupCalls: signupCalls(),
               homeStyles: { before: homeBeforeOnline, after: homeAfterOnline } };
    }

    const seen = await readOnlineView(page);
    const faceoff = await probeFaceoff(page, { door, motion });
    const { claimFlow, askAbove, ptsDoor } = await probeAccountActions(page, { door, named });

    await ctx.close();
    return { seen, errs, signupCalls: signupCalls(), faceoff, ptsDoor, claimFlow, askAbove,
             homeStyles: { before: homeBeforeOnline, after: homeAfterOnline } };
  };
}
