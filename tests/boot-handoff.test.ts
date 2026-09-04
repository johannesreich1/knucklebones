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
  scales(): Record<string, number>;
  root(): HTMLElement;
  home(): HTMLElement;
  wordmark(): HTMLElement;
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
    home() { return document.querySelector('#ovStart'); },
    /* .splitmark .split carries a STATIC layout scale (96/120) of its own, so
       "which element is transformed" cannot be asked of one frame — it is
       answered by which element's transform CHANGES when the beat is staged. */
    scales() {
      const out = {};
      for (const sel of ['.hero #homeMark', '.hero .splitmark', '.hero .splitmark .split']) {
        const el = document.querySelector(sel);
        if (el) out[sel] = window.__bh.scale(el);
      }
      return out;
    },
    wordmark() { return document.querySelector('.hero h1'); },
  };
`;
await page.evaluate(helpers);

/* Read the resting state BEFORE staging anything. Reading it after teardown
   measures a transition still running home — 60ms in, the mark was at 1.376. */
const fits = await page.evaluate(() => {
  const home = window.__bh.home();
  return { scrollW: home.scrollWidth, clientW: home.clientWidth,
    scrollH: home.scrollHeight, clientH: home.clientHeight };
});

const settled = await page.evaluate(() => ({
  markShown: window.__bh.shown(window.__bh.mark()),
  markScale: window.__bh.scale(window.__bh.mark()),
  eyebrowShown: window.__bh.shown(window.__bh.eyebrow()),
  scales: window.__bh.scales(),
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
  ownerScale: window.__bh.scale(window.__bh.owner()),
  markFilter: getComputedStyle(window.__bh.mark()).filter,
  scales: window.__bh.scales(),
  eyebrowShown: window.__bh.shown(window.__bh.eyebrow()),
  ownerGrey: /grayscale\(1\)/.test(getComputedStyle(window.__bh.owner()).filter),
  wordmarkFilter: getComputedStyle(window.__bh.wordmark()).filter,
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
  ownerWillChange: getComputedStyle(window.__bh.owner()).willChange,
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
    wordmarkFilter: getComputedStyle(window.__bh.wordmark()).filter,
    varsLeft: ['--boot-dx', '--boot-dy', '--boot-scale'].filter((n) => root.style.getPropertyValue(n)) };
});
/* HOME'S GROUND, measured on its own. Home's content is hidden for this: the
   primary CTA is a wide cyan slab and any reading taken through it is the
   button, not the ground. R-G separates the two owners in the default pair —
   positive where theirs (magenta) leads, negative where yours (cyan) does. */
const groundFile = join(tmpdir(), 'kb-home-ground.png');
await page.evaluate(() => {
  const hide = document.createElement('style');
  hide.id = 'kb-ground-probe';
  hide.textContent = '#kbroot #ovStart>*{visibility:hidden}';
  window.__bh.root().appendChild(hide);
});
await page.screenshot({ path: groundFile });
await page.evaluate(() => document.getElementById('kb-ground-probe')?.remove());
const ground = (() => {
  const px = readPngPixels(groundFile);
  let theirs = 0, yours = 0;
  for (let x = 6; x < px.width - 6; x += 6) {
    for (let y = 0; y < px.height; y += 4) {
      const p = px.pixel(x, y);
      const chroma = p.red - p.green;
      if (y < px.height * .45) theirs = Math.max(theirs, chroma);
      else yours = Math.min(yours, chroma);
    }
  }
  return { theirs, yours, ratio: +(Math.abs(yours) / Math.max(1, theirs)).toFixed(2) };
})();

const out = { settled, launch, run, glow, cleanup, painted, fits, ground };
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
check(out.launch.ownerScale > 1.5,
  'the launch frame does not scale the mark up to the storyboard\'s size', out.launch);
/* THE ELEMENT THAT MOVES MUST BE THE ELEMENT THAT FILTERS. A parent's filter is
   recomputed from what its children render, so a transformed child inside a
   filtered parent makes the two disagree every frame — the arrangement behind
   the extra glow reported on the mark after the beat settles, and the same
   shape as the clipped-title bug. .splitmark .split carries a static layout
   scale of its own and is excluded by being unaffected by the boot vars; what
   this forbids is the BOOT transform landing anywhere but on #homeMark. */
const moved = Object.keys(out.launch.scales)
  .filter((sel) => out.launch.scales[sel] !== out.settled.scales[sel]);
check(JSON.stringify(moved) === JSON.stringify(['.hero #homeMark']),
  'the boot transform is not on the element that owns the glow — a filtered '
  + 'parent recomputing around a scaling child is what this beat must not be',
  { moved, settled: out.settled.scales, launch: out.launch.scales });
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

/* 5 — THE WORDMARK CARRIES NO FILTER WHILE IT MOVES. .ov h1 clips a gradient
   to its glyphs, and a filter on such an element makes Safari abandon the clip
   and paint the gradient as a SOLID RECTANGLE — the repo learned this on
   #endTitle (screens/result.css) and left the rule written beside the filter in
   components/overlays.css. The handoff then animated this title anyway, and the
   box appeared around the hero type on first load. Chromium does not reproduce
   the paint bug, so this asserts the RULE rather than the pixels: no filter on
   a background-clip:text title that is mid-animation. */
check(out.launch.wordmarkFilter === 'none',
  'the wordmark is filtered while the handoff animates it — a filter on a '
  + 'background-clip:text element makes Safari paint the gradient as a solid '
  + 'rectangle behind the words', out.launch);

/* 6 — HOME OFFERS NOTHING TO SCROLL TO. #ovStart is a scroll container, so any
   descendant reaching past its bottom or right edge becomes scrollable area —
   and the clouds spent a release as an ::after at inset:-30%, which is exactly
   30% of empty ground to scroll into on both axes. Reported as "I can scroll to
   the bottom and right even though there is no content". Decoration belongs in
   a background, which has no box to overflow. */
check(out.fits.scrollW <= out.fits.clientW && out.fits.scrollH <= out.fits.clientH + 1,
  'Home scrolls past its own content — something reaches beyond the scroll '
  + 'container, and empty ground is scrollable', out.fits);

/* 3 — only compositor properties on the mark. A filter here re-blurs a scaling
   surface every frame; the colour belongs to the parent's colour matrix. */
check(out.run.markTransitions === 'all' || out.run.markTransitions === 'none'
  || !/transform|opacity|filter/.test(out.run.markTransitions),
  'the mark itself animates during the handoff — the whole beat belongs to '
  + '#homeMark, so that the glow and the movement are one layer', out.run);
const ownerProps = out.run.ownerTransitions.split(',').map((p) => p.trim()).sort();
check(JSON.stringify(ownerProps) === JSON.stringify(['filter', 'opacity', 'transform']),
  'the owner must animate transform, opacity and filter together — split across '
  + 'two elements, the filter is re-derived from a scaling child every frame', out.run);
check(/transform/.test(out.run.ownerWillChange),
  'the owner must be promoted for the scale, or it re-rasterises per frame', out.run);

/* 4 — NO ADDED GLOW ON THE HOME MARK. This assertion used to say the opposite:
   it required a drop-shadow and demanded the owner be padded by at least its
   blur, because the glow was being clipped on device. Johannes settled it from
   two device screenshots on 2026-09-04 and chose the frame WITHOUT the halo, so
   the shadows are gone and the padding that only ever existed to contain them
   went with them. Measured off those shots, the rejected frame ran 8 luma
   hotter than the chosen one right around the die.
   It is also what makes the launch seam honest: the launch image carries almost
   no light outside its die (gone within ~40px of a 497px die), and the first
   webview frame is supposed to BE that picture. A glow here is the mark
   blooming the instant the webview takes the screen. */
check(out.glow.blurs.length === 0 && out.glow.filter === 'none',
  'the Home mark has grown an added glow again — the owner chose the frame '
  + 'without one, and the launch image this continues carries none either',
  out.glow);

/* 7 — THEIRS ON TOP, YOURS BELOW AND QUIETER (owner call). This is asserted in
   painted pixels rather than in the token, because the token is exactly where
   it went wrong: --duel-clouds-still is declared on #kbroot, so the var()s
   inside it resolve THERE, and a --cloud-p1-a override written on #ovStart was
   inert. Home shipped a release painting the live table's full-strength clouds
   while a dimming rule sat in home.css reading as if it worked. Nothing about
   that is visible in the CSS; only the ground is. */
check(out.ground.theirs > 24 && Math.abs(out.ground.yours) > 8,
  'Home has lost one of its two owners — the ground should carry theirs above '
  + 'and yours below, both visible', out.ground);
check(out.ground.ratio < .6,
  'Home\'s lower cloud is not subordinate to its upper one — yours is reading '
  + 'as heavy as theirs, which is what an inert alpha knob looks like', out.ground);

/* the resting screen is the finished one — nothing staged, nothing faded */
check(out.settled.markShown === 1 && out.settled.markScale === 1 && out.settled.eyebrowShown === 1,
  'Home does not rest in its settled state', out.settled);
/* and the beat leaves nothing behind: a stale class would strand the screen */
check(!/booting|boot-run/.test(out.cleanup.classes) && out.cleanup.varsLeft.length === 0,
  'the handoff left its classes or its measured vars on the root', out.cleanup);
/* AND THE WORDMARK STAYS UNFILTERED ONCE THE CLASSES COME OFF. The check above
   at the launch frame only proved the glow was gone WHILE the type travelled;
   `#kbroot.booting .hero h1{filter:none}` is scoped to that class, so removing
   it handed the drop-shadow straight back. Johannes reported the result from a
   device: a glow around KNUCKLEBONES that is there after the intro settles and
   absent when you return to Home from another view, because only the first
   path leaves a filter on an element that also clips a gradient to its glyphs.
   Home's title is settled, not static, so it is asserted in its settled state. */
check(out.cleanup.wordmarkFilter === 'none',
  'the wordmark carries a filter once the handoff classes come off — the glow '
  + 'returns to a gradient-clipped title and Home reads differently on first '
  + 'load than on every return to it', out.cleanup);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
