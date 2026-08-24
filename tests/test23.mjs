// THE DESIGN CARDS, rendered — not inspected as text.
//
// design/build.mjs already fails on the two mistakes it can see from Node: a
// card that redeclares a bare app class the app pins, and a card that names a
// rune or a spell that does not exist. Everything else about a card is only
// true once a browser has laid it out, and two whole classes of defect were
// invisible to the build:
//
//   1. A CARD THAT DOES NOT FIT ITS FRAME. The Design pane renders each card at
//      the width and height its meta declares, so content taller than that is
//      simply cut off — silently, and only in the pane, never in the preview a
//      person opens locally. Thirteen cards were clipping when this check was
//      written (01-widths lost 811px of itself, 27-spells 312px, the tier ring
//      128px), because the height was hand-guessed when the card was created
//      and nobody re-guessed it as the card grew.
//   2. A TOKEN THAT NEVER EXPANDED. `{{mico:colshield:13}}` mistyped is not an
//      error — the regex simply does not match, and the literal text ships on
//      the card as if it were copy.
//
// Both are exactly the repo's own rule: assert what the reader can SEE.
import pkg from 'playwright';
const { chromium } = pkg;
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const problems = [], errs = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

const dist = join(process.cwd(), 'design', 'dist');
/* build first: the suite must judge the cards as they are RIGHT NOW, not
   whatever a previous run happened to leave in the (gitignored) dist */
try {
  execFileSync(process.execPath, ['design/build.mjs'], { cwd: process.cwd(), stdio: 'pipe' });
} catch (e) {
  problems.push('design/build.mjs failed :: ' + String(e.stdout || e.message).slice(-400));
}

const files = readdirSync(dist).filter((f) => f.endsWith('.html')).sort();
check(files.length > 0, 'no design cards were built', files.length);
out.cards = files.length;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

const clipped = [], unexpanded = [];
let pilferStudy = null;
for (const f of files) {
  const head = readFileSync(join(dist, f), 'utf8').split('\n', 1)[0];
  const w = +(head.match(/width=(\d+)/)?.[1] || 0);
  const h = +(head.match(/height=(\d+)/)?.[1] || 0);
  check(w > 0 && h > 0, 'card has no @dsCard width/height', f);

  await page.setViewportSize({ width: w, height: Math.min(h, 2000) });
  await page.goto('file://' + join(dist, f));
  await page.waitForTimeout(90);
  const real = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
  /* 8px of slack: sub-pixel rounding in the stage's shadow and the flow chips
     is not a card losing content. Anything past that IS content off the card. */
  if (real > h + 8) clipped.push({ card: f, declared: h, renders: real, lost: real - h });

  /* a literal {{…}} that survived the build. Comments are stripped first: a
     card's own CSS comment may legitimately NAME a token while explaining it. */
  const body = readFileSync(join(dist, f), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const left = body.match(/\{\{[^}\s]+\}\}/g);
  if (left) unexpanded.push({ card: f, tokens: [...new Set(left)] });

  /* PI5's source-die visibility beat and waiting lean share one element. A
     more-specific animation shorthand once silently replaced the lean, so the
     rendered card looked unlike production even though both keyframes existed
     in its source. Read the cascade the designer actually sees. */
  if (f === '45e-pilfer-snatch.html') {
    pilferStudy = await page.evaluate(() => {
      const target = document.querySelector('.spsrc > .spmark.tgt');
      const grip = target ? getComputedStyle(target, '::after') : null;
      return {
        targetAnimations: target ? getComputedStyle(target).animationName : 'missing',
        gripAnimation: grip?.animationName ?? 'missing',
        gripInsets: grip ? [grip.top, grip.right, grip.bottom, grip.left] : [],
        gripRadius: grip?.borderRadius ?? 'missing',
        releaseLines: document.querySelectorAll('.spseam').length,
      };
    });
  }
}
await browser.close();

out.clipped = clipped;
out.unexpanded = unexpanded;
out.pilferStudy = pilferStudy;
check(clipped.length === 0, 'design cards taller than the frame the pane gives them', clipped);
check(unexpanded.length === 0, 'design cards shipping an unexpanded {{token}} as copy', unexpanded);
check(pilferStudy?.targetAnimations.split(',').map((name) => name.trim()).join(',') === 'pigone,pi5lean'
    && pilferStudy?.gripAnimation === 'pi5grip'
    && pilferStudy?.gripInsets.every((inset) => inset === '0px')
    && pilferStudy?.gripRadius === '14px' && pilferStudy?.releaseLines === 0,
  'PI5 rendered without its waiting lean or retained the removed crossing line', pilferStudy);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
