/* A PAGE OPENS AT ITS TOP. A .pbody keeps its scrollTop while its page is
   closed — nothing ever reset it — so a view read to the bottom and left came
   back still at the bottom, and the push carried it in that way from its very
   first frame, wearing the full scrolled frost as it arrived (owner report,
   2026-09-03: "a new page before being opened and the animation starts, should
   be fully scrolled to the top"). Measured then: RULES reopening at 693 of 693
   on an iPhone 13, 942 of 942 at 360x480, and SETTINGS at 332 of 332.

   Its own file rather than a case inside settings-navigation, which sits close
   to its 400-line budget and owns a different question — where the Settings
   controls are and what they do, not what a page looks like on arrival. */
import { waitForOverlayTransitions } from '../../support/overlay-transitions.mjs';

async function settled(page) {
  await waitForOverlayTransitions(page, '.ov');
  await page.waitForFunction(() => !document.getElementById('kbroot')
    ?.classList.contains('page-motion-active'), null, { timeout: 1500 });
}

export async function runPageOpensAtTopScenarios(suite) {
  const { page, out, check } = suite;

  await page.evaluate(() => window.__kb.goHome());
  await page.waitForSelector('#ovStart.on');
  await settled(page);
  await page.tap('#btnLearn'); await page.waitForTimeout(320);
  await settled(page);
  await page.tap('#btnLearnRules'); await page.waitForTimeout(400);
  await settled(page);

  const readToEnd = await page.evaluate(() => {
    const body = document.querySelector('#ovRules .pbody');
    body.scrollTop = body.scrollHeight;
    body.dispatchEvent(new Event('scroll'));
    return { readTo: body.scrollTop, room: body.scrollHeight - body.clientHeight };
  });
  await page.tap('[data-learn-back="ovRules"]'); await page.waitForTimeout(320);
  await settled(page);
  /* The body keeps its place while the page is CLOSED — that is not the bug,
     and reading it here is what proves the page really had been scrolled when
     the arrival below comes back at zero. */
  const keptWhileClosed = await page.evaluate(() =>
    document.querySelector('#ovRules .pbody').scrollTop);

  await page.tap('#btnLearnRules');
  /* Sampled across the whole push rather than at one instant: nothing scrolls
     a page during its own navigation, so a single non-zero reading anywhere in
     the window is the bug — and a fix that scrolled to the top LATE, which the
     player would see as a jump, is still caught. */
  const duringPush = await page.evaluate(async () => {
    const body = document.querySelector('#ovRules .pbody');
    const head = document.querySelector('#ovRules .shead');
    const tops = [];
    const frost = [];
    const started = performance.now();
    while (performance.now() - started < 500) {
      tops.push(body.scrollTop);
      frost.push(Number(getComputedStyle(head, '::before').opacity));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return { topmost: Math.max(...tops), frostiest: Math.max(...frost), frames: tops.length };
  });
  await settled(page);

  out.pageOpensAtTop = { ...readToEnd, keptWhileClosed, ...duringPush };
  check(out.pageOpensAtTop.room > 40 && out.pageOpensAtTop.frames > 4
      && out.pageOpensAtTop.keptWhileClosed > 40,
  'RULES no longer scrolls, or no frames were sampled — this proves nothing',
  out.pageOpensAtTop);
  check(out.pageOpensAtTop.topmost === 0,
    'a reopened page animates in already scrolled — the player watches it '
    + 'arrive at the place they left it instead of at its top', out.pageOpensAtTop);
  check(out.pageOpensAtTop.frostiest === 0,
    'a reopened page wears its scrolled frost while it animates in',
    out.pageOpensAtTop);

  /* Hand the shared page back the way it was found. Every scenario here drives
     the same tab, and badge-cards reads the learn library from HOME right
     after — left on RULES it waits out its whole budget on a button that is
     present but covered. */
  await page.tap('[data-learn-back="ovRules"]'); await page.waitForTimeout(320);
  await settled(page);
  await page.tap('#btnLearnBack'); await page.waitForTimeout(320);
  await settled(page);
  out.pageOpensAtTop.leftAtHome = await page.evaluate(() =>
    [...document.querySelectorAll('.ov.on')].map((o) => o.id).join(','));
  check(out.pageOpensAtTop.leftAtHome === 'ovStart',
    'this scenario did not hand the shared page back at Home', out.pageOpensAtTop);
}
