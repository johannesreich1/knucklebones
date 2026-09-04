/* THE BOOT HANDOFF, asserted as the player sees it — design 15b / A2.
 *
 * Every check here exists because the beat shipped broken in exactly that way
 * during development and nothing caught it. All three faults were invisible in
 * the diff and obvious the moment the transition was scrubbed frame by frame:
 *
 *   1. The start state darkened the mark with brightness(.62). The die's halves
 *      are translucent, so darkening them against a dark ground made the mark
 *      DISAPPEAR — the whole large-scale half of the travel played invisibly
 *      and the mark seemed to pop into existence two thirds of the way through.
 *   2. The rule that hides everything except the mark excluded `.splitmark`,
 *      but the hero's direct child is the `#homeMark` wrapper. So it hid the
 *      one element it was written to keep on screen.
 *   3. The mark transitioned a filter holding two 26px drop-shadows while
 *      scaling 96 -> 196px. On a 3x phone that re-blurs a ~590px surface every
 *      frame, which is what "laggy" was. Only transform and opacity may animate
 *      on the mark now; the colour arrives as a colour matrix on its parent.
 *
 * A fourth guards the glow: it must live INSIDE the element that owns it, so a
 * promoted compositor layer has no light outside its own bounds to clip.
 */
import { chromium } from 'playwright';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPngPixels } from './support/png-pixels.ts';

/* The helpers are installed once in the page and reused across the separate
   evaluates below — separate, because one batched task is not guaranteed to
   flush style between a class change and the next read. They live on window,
   so the type has to say so. */
interface BootHandoffProbe {
  shown(el: Element): number;
  scale(el: Element): number;
  mark(): HTMLElement;
  owner(): HTMLElement;
  eyebrow(): HTMLElement;
  root(): HTMLElement;
}
declare global {
  interface Window { __bh: BootHandoffProbe }
}

const problems: string[] = [];
const errs: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown): void => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, locale: 'en-US' });
page.on('pageerror', (error) => errs.push(`PAGEERROR: ${error.message}`));
await page.goto(`file://${join(process.cwd(), 'dist/main/index.html')}`);
await page.waitForTimeout(900);

const helpers = `
  window.__bh = {
    shown(el) { let v = 1, n = el;
      while (n && n !== document.documentElement) { v *= Number(getComputedStyle(n).opacity); n = n.parentElement; }
      return +v.toFixed(3); },
    scale(el) { return +new DOMMatrixReadOnly(getComputedStyle(el).transform).a.toFixed(3); },
    mark() { return document.querySelector('.hero .splitmark'); },
    owner() { return document.querySelector('.hero #homeMark'); },
    eyebrow() { return document.querySelector('.hero .eyebrow'); },
    root() { return document.querySelector('#kbroot'); },
  };
`;
await page.evaluate(helpers);

/* Read the resting state BEFORE staging anything. Reading it after teardown
   measures a transition still running home — 60ms in, the mark was at 1.376. */
const settled = await page.evaluate(() => ({
  markShown: window.__bh.shown(window.__bh.mark()),
  markScale: window.__bh.scale(window.__bh.mark()),
  eyebrowShown: window.__bh.shown(window.__bh.eyebrow()),
}));

const glow = await page.evaluate(() => {
  const owner = window.__bh.owner();
  const filter = getComputedStyle(owner).filter;
  /* the blur radius is the LAST length in each drop-shadow, and the colour that
     precedes it carries its own parentheses — so this reads every "<n>px)" the
     filter contains rather than trying to bracket-match a drop-shadow(). */
  const blurs = [...filter.matchAll(/(\d+(?:\.\d+)?)px\)/g)].map((hit) => Number(hit[1]));
  return { ownerPadding: parseFloat(getComputedStyle(owner).paddingTop), blurs, filter: filter.slice(0, 60) };
});

await page.evaluate(() => {
  const root = window.__bh.root(); const mark = window.__bh.mark();
  const seat = mark.getBoundingClientRect();
  root.style.setProperty('--boot-dx', (window.innerWidth / 2 - (seat.left + seat.width / 2)) + 'px');
  root.style.setProperty('--boot-dy', (window.innerHeight / 2 - (seat.top + seat.height / 2)) + 'px');
  root.style.setProperty('--boot-scale', '2.04');
  root.classList.add('booting');
});
await page.waitForTimeout(60);
const launch = await page.evaluate(() => ({
  markShown: window.__bh.shown(window.__bh.mark()),
  markScale: window.__bh.scale(window.__bh.mark()),
  markFilter: getComputedStyle(window.__bh.mark()).filter,
  eyebrowShown: window.__bh.shown(window.__bh.eyebrow()),
  ownerGrey: /grayscale\(1\)/.test(getComputedStyle(window.__bh.owner()).filter),
}));

/* THE MARK MUST BE VISIBLE IN PIXELS, not merely un-faded. The original fault
   darkened it with brightness(.62) — a filter, so opacity stayed 1 and every
   property-level check passed while the mark was invisible against the dark
   ground. Only reading what was painted catches that, which is the repo's rule
   for anything the player can see. */
const shotFile = join(tmpdir(), 'kb-boot-launch.png');
const clip = await page.evaluate(() => {
  const r = window.__bh.mark().getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
});
await page.screenshot({ path: shotFile, clip });
const painted = (() => {
  const px = readPngPixels(shotFile);
  const luma = (p: { red: number; green: number; blue: number }) =>
    (p.red * 299 + p.green * 587 + p.blue * 114) / 1000;
  let brightest = 0;
  for (let y = 0; y < px.height; y += 2) {
    for (let x = 0; x < px.width; x += 2) brightest = Math.max(brightest, luma(px.pixel(x, y)));
  }
  return { brightest: +brightest.toFixed(1), ground: +luma(px.pixel(1, 1)).toFixed(1) };
})();

await page.evaluate(() => window.__bh.root().classList.add('boot-run'));
await page.waitForTimeout(60);
const run = await page.evaluate(() => ({
  markTransitions: getComputedStyle(window.__bh.mark()).transitionProperty,
  ownerTransitions: getComputedStyle(window.__bh.owner()).transitionProperty,
  markWillChange: getComputedStyle(window.__bh.mark()).willChange,
}));

await page.evaluate(() => {
  const root = window.__bh.root();
  root.classList.remove('booting', 'boot-run');
  for (const name of ['--boot-dx', '--boot-dy', '--boot-scale']) root.style.removeProperty(name);
});
await page.waitForTimeout(60);
const cleanup = await page.evaluate(() => {
  const root = window.__bh.root();
  return { classes: root.className,
    varsLeft: ['--boot-dx', '--boot-dy', '--boot-scale'].filter((n) => root.style.getPropertyValue(n)) };
});
const out = { settled, launch, run, glow, cleanup, painted };
await browser.close();

/* 1 + 2 — the launch frame must SHOW the mark. Either historical fault takes
   this to zero: the darkened one by opacity, the wrapper one by an ancestor. */
check(out.launch.markShown >= .5,
  'the launch frame does not show the mark — it is hidden or faded to nothing',
  out.launch);
check(out.painted.brightest - out.painted.ground >= 40,
  'the launch frame paints no visible mark — it is on screen but not legible '
  + 'against the ground (a filter can hide it while opacity still reads 1)',
  out.painted);
check(out.launch.markScale > 1.5,
  'the launch frame does not scale the mark up to the storyboard\'s size', out.launch);
/* The fade is the SPLASH's: tools/splash.mjs paints the launch mark at
   opacity .62, and the webview's first frame has to be the same picture. An
   earlier version darkened with brightness(.62) instead — the mark stayed
   legible, so no visibility check catches it, but it no longer matched the
   frame it is continuing. The mark carries NO filter of its own: the colour
   belongs to its parent, where it costs a colour matrix instead of a reblur. */
check(Math.abs(out.launch.markShown - .62) < .02 && out.launch.markFilter === 'none',
  'the launch frame must fade the mark to the splash\'s .62 with no filter of '
  + 'its own — a filter here both diverges from the splash and repaints', out.launch);
check(out.launch.eyebrowShown === 0,
  'the launch frame must hide everything except the mark', out.launch);
check(out.launch.ownerGrey,
  'the launch frame must be colourless — the launch image is greyscale', out.launch);

/* 3 — only compositor properties on the mark. A filter here re-blurs a scaling
   surface every frame; the colour belongs to the parent's colour matrix. */
const markProps = out.run.markTransitions.split(',').map((p) => p.trim()).sort();
check(JSON.stringify(markProps) === JSON.stringify(['opacity', 'transform']),
  'the mark must animate transform and opacity ONLY — a filter here repaints '
  + 'a blurred, scaling surface every frame', out.run);
check(/transform/.test(out.run.markWillChange),
  'the mark must be promoted for the scale, or it re-rasterises per frame', out.run);
check(out.run.ownerTransitions.includes('filter'),
  'the colour must arrive on the mark\'s owner, as a filter it can afford', out.run);

/* 4 — the glow inside its own element, so a promoted layer cannot clip it. */
const widest = Math.max(0, ...out.glow.blurs);
check(out.glow.blurs.length > 0 && out.glow.ownerPadding >= widest,
  'the glow reaches outside the element that owns it, where a compositor layer '
  + 'can clip it — pad the owner by at least the shadow\'s blur', out.glow);

/* the resting screen is the finished one — nothing staged, nothing faded */
check(out.settled.markShown === 1 && out.settled.markScale === 1 && out.settled.eyebrowShown === 1,
  'Home does not rest in its settled state', out.settled);
/* and the beat leaves nothing behind: a stale class would strand the screen */
check(!/booting|boot-run/.test(out.cleanup.classes) && out.cleanup.varsLeft.length === 0,
  'the handoff left its classes or its measured vars on the root', out.cleanup);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
