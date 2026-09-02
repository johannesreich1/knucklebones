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
import { checkRenderingFont } from './support/rendering-font.mjs';

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
const page = await browser.newPage({ viewport: { width: 900, height: 600 }, locale: 'en-US' });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

/* EVERY height below is a font measurement. A host rendering the cards in a
   face the app never names does not produce a smaller set of true failures —
   it produces a list of cards that are "12px too tall" and sends the reader
   off to edit card declarations. Name the cause once, here, before the loop. */
const font = await checkRenderingFont(page);
out.font = font;
check(!font.problem,
  'not rendering in a font the app names, so every height below is measured '
  + 'against a face no player has', font);

const clipped = [], unexpanded = [];
let pilferStudy = null;
let navigationCard = null;
const selectedPlayCards = new Map([
  ['10-home-signed-in', 'Play ranked match'],
  ['11-home-signed-out', 'Play ranked match'],
  ['13d-homeid-plate', 'Play ranked match'],
  ['52f-equip-lit-plate', 'Play ranked match'],
  ['23-result', 'Next duel'],
  ['23-result-defeat', 'Next duel'],
  ['36d-endid-foe', 'Next duel'],
  ['36f-endid-plates', 'Next duel'],
  ['41-end-local', 'Next duel'],
  ['52h-equip-threshold', 'Next duel'],
]);
const playCtas = [], plainCtas = [];
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

  const basename = f.replace(/--(?:sm|max|tab)(?=\.html$)/u, '').replace(/\.html$/u, '');
  const expectedLabel = selectedPlayCards.get(basename);
  if (expectedLabel) {
    playCtas.push(await page.evaluate(({ card, expected }) => {
      const button = document.querySelector('.btn.primary.play-cta');
      const icon = button?.querySelector(':scope > .btn-leading-icon:not([hidden])');
      const label = button?.querySelector(':scope > .btn-label');
      const svg = icon?.querySelector('svg');
      const die = svg?.querySelector('rect');
      const pips = [...(svg?.querySelectorAll('circle') ?? [])];
      const glint = button?.getAnimations({ subtree: true })
        .find((animation) => animation.animationName === 'primaryGlint');
      const iconRect = icon?.getBoundingClientRect();
      const labelRect = label?.getBoundingClientRect();
      const buttonRect = button?.getBoundingClientRect();
      return {
        card,
        expected,
        label: label?.textContent?.trim() ?? '',
        buttonText: button?.textContent?.trim() ?? '',
        iconBeforeLabel: !!button && !!icon && !!label
          && [...button.children].indexOf(icon) < [...button.children].indexOf(label),
        viewBox: svg?.getAttribute('viewBox') ?? null,
        cant: svg?.querySelector('g')?.getAttribute('transform') ?? null,
        die: die ? [die.getAttribute('x'), die.getAttribute('y'), die.getAttribute('width'),
          die.getAttribute('height'), die.getAttribute('rx')] : null,
        pips: pips.map((pip) => [pip.getAttribute('cx'), pip.getAttribute('cy'), pip.getAttribute('r')]),
        size: iconRect ? [iconRect.width, iconRect.height] : null,
        gap: iconRect && labelRect ? +(labelRect.left - iconRect.right).toFixed(2) : null,
        centreError: buttonRect && iconRect && labelRect
          ? +((Math.min(iconRect.left, labelRect.left) + Math.max(iconRect.right, labelRect.right)) / 2
            - (buttonRect.left + buttonRect.width / 2)).toFixed(2)
          : null,
        duration: glint?.effect?.getTiming().duration ?? null,
        sheen: button ? getComputedStyle(button, '::after').backgroundImage : '',
        secondaryIcons: document.querySelectorAll('.btn:not(.play-cta) > .btn-leading-icon:not([hidden])').length,
      };
    }, { card: f, expected: expectedLabel }));
  } else if (f === '00-foundations.html' || f === '40-local-menu.html') {
    plainCtas.push(await page.evaluate((card) => {
      const button = document.querySelector('.btn.primary');
      const glint = button?.getAnimations({ subtree: true })
        .find((animation) => animation.animationName === 'primaryGlint');
      return {
        card,
        playClass: button?.classList.contains('play-cta') ?? false,
        icon: !!button?.querySelector(':scope > .btn-leading-icon:not([hidden])'),
        duration: glint?.effect?.getTiming().duration ?? null,
        sheen: button ? getComputedStyle(button, '::after').backgroundImage : '',
      };
    }, f));
  }

  if (f === '00-navigation.html') {
    navigationCard = await page.evaluate(() => {
      const button = document.querySelector('.shead [data-page-back]');
      const svg = button?.querySelector('svg.cico-back');
      const box = svg?.getBoundingClientRect();
      return {
        text: button?.textContent?.trim() ?? '',
        transparent: button ? getComputedStyle(button).backgroundImage === 'none' : false,
        size: box ? [box.width, box.height] : null,
        p1: !!svg?.querySelector('.back-bracket--p1'),
        p2: !!svg?.querySelector('.back-bracket--p2'),
        chevron: !!svg?.querySelector('.back-chevron'),
      };
    });
  }

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
out.playCtas = playCtas;
out.plainCtas = plainCtas;
out.navigationCard = navigationCard;
check(clipped.length === 0, 'design cards taller than the frame the pane gives them', clipped);
check(unexpanded.length === 0, 'design cards shipping an unexpanded {{token}} as copy', unexpanded);
check(navigationCard?.text === '' && navigationCard.transparent
    && navigationCard.p1 && navigationCard.p2 && navigationCard.chevron
    && navigationCard.size?.every((size) => size === 30),
  'the normative Navigation card does not render the shared 30px Duel Brackets control',
  navigationCard);
check(pilferStudy?.targetAnimations.split(',').map((name) => name.trim()).join(',') === 'pigone,pi5lean'
    && pilferStudy?.gripAnimation === 'pi5grip'
    && pilferStudy?.gripInsets.every((inset) => inset === '0px')
    && pilferStudy?.gripRadius === '14px' && pilferStudy?.releaseLines === 0,
  'PI5 rendered without its waiting lean or retained the removed crossing line', pilferStudy);
/* Six responsive screen cards emit four device sizes; the four focused
   identity/study cards have one deliberately fixed comparison frame. */
check(playCtas.length === 28
    && playCtas.every((cta) => cta.label === cta.expected && cta.buttonText === cta.expected
      && cta.iconBeforeLabel && cta.viewBox === '0 0 24 24'
      && cta.cant === 'rotate(-8 12 12)'
      && JSON.stringify(cta.die) === JSON.stringify(['4.5', '4.5', '15', '15', '3.4'])
      && JSON.stringify(cta.pips) === JSON.stringify([
        ['8.5', '8.5', '1.25'], ['12', '12', '1.25'], ['15.5', '15.5', '1.25'],
      ])
      && cta.size?.every((size) => size === 25) && cta.gap === 11
      && Math.abs(cta.centreError) <= .5 && cta.duration === 4600
      && cta.sheen.includes('0.21') && cta.secondaryIcons === 0),
  'an active Home/result card drifted from the selected option-01 CTA', playCtas);
check(plainCtas.length === 2 && plainCtas.every((cta) => !cta.playClass && !cta.icon
    && cta.sheen.includes('0.15'))
    && plainCtas.find((cta) => cta.card === '00-foundations.html')?.duration === null
    && plainCtas.find((cta) => cta.card === '40-local-menu.html')?.duration === 5200,
  'a generic or Offline primary card inherited the selected play treatment', plainCtas);

console.log(JSON.stringify({ out, problems, errs }, null, 2));
