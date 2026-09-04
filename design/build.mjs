// Build the design cards: each recursively classified screen body under
// design/screens/ is wrapped with the GAME'S OWN stylesheets (inlined) plus a
// little preview chrome, and lands in design/dist/ ready for DesignSync. The
// flat output keeps each globally unique basename as its durable card identity.
// Design and product share CSS by construction — a token change in src/styles/
// re-skins every design card on the next build.
//
//   mise exec -- node design/build.mjs
//
// Screen file format: first line is a meta comment —
//   <!-- meta name="…" group="…" subtitle="…" width=400 height=900 links="A,B" -->
// followed by the card's body HTML, in which these tokens expand:
//
//   {{die:V:p1|p2|gold[:px]}}   a die face — the class slot takes any of the
//                              app's own die classes, space-separated, so a card
//                              can picture a MULTIPLIED die (`p2 m2`) instead of
//                              restating the shared dice CSS's gold in card CSS
//   {{splitmark[:px]}}          HOME's hero mark, live DOM, following --p1/--p2
//   {{appicon[:px][:light]}}     the shipped launcher mark (the split die), at its
//                              launcher scale and clockwise tilt; `:light` is the
//                              iOS light appearance with its own light ground
//   {{splashmark[:px]}}          the launch screen's mark — the split die, DESATURATED:
//                              one image stands in for all 42 pairs
//   {{mico:MODE[:px]}}          a mode icon — the APP's, imported below
//   {{mhue:MODE}}               a mode's hue — likewise
//   {{sico:SPELL[:px]}}         a rune icon — the APP's (ui/spellicons.ts)
//   {{shue:SPELL}}              a rune's hue — likewise
//   {{account-runes:SPELL,…}}   the Profile collection, owned ids after ':'
//   {{loader[:px][:label]}}     the ONE loading die, in loaderWait's own shape
//   {{versus:N:R:die:F:H|N:R:die:F:H}}  the reveal's me-VS-foe line, the APP's
//   {{ico:NAME[:px]}}           a chrome glyph (the HUD's way out)
//   {{score:A:n:B:n}}           a score line — the HUD's, the ladder's, the card's
//   {{dialnodes[:MODE]}}        the dial's whole node ring, optionally landed
//   {{runefelt:SPELL[:up]}}     the rune deck + the card dealt off it, optionally turned
//   {{runefaces:SPELL}}         one rail card's shared back/face anatomy
//   {{wsettled:mode|rune:ID}}   a reveal answer that has settled: pill + its rule
//   {{wanswer:mode|rune:ID}}    a reveal answer's name + blurb, under the stage
//   {{library:modes|spells[:ID]}}  a whole roster of reference cards, ID ringed
//   {{libentry:modes|spells:ID}}   ONE entry's three lines — the body of the sheet
//   {{picker:modes|spells[:V]}}    an OFFLINE pick row, V selected
//   {{pickinfo:modes|spells[:V]}}  the line under it that names the choice
//
// The last three import from src/ rather than re-describing it: a card that
// hand-copies an icon is a second implementation that drifts the moment the
// first one changes, and the mode icons had reached 122 copies across 12 cards
// before this existed. Needs Node ≥22.18 (type stripping on by default).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { modeIcon, modeHue } from '../src/ui/modeicons.ts';
import { chromeIcon } from '../src/ui/chromeicons.ts';
import { spellIcon, spellHue } from '../src/ui/spellicons.ts';
import { scoreLine } from '../src/ui/record.ts';
import { dialNodes, dialBeat } from '../src/ui/modedial.ts';
import { runeFelt, dealBeat, runeCardFaces } from '../src/ui/runedeal.ts';
import { settledAnswer, answerLines, versus } from '../src/ui/reveal-answer.ts';
import { parseAvatar, AV_HUES } from '../src/ui/avatar.ts';
import { dieMarkup } from '../src/ui/die-markup.ts';
import { loaderWaitMarkup } from '../src/ui/loader.ts';
import { accountRunesMarkup } from '../src/online/screens/account-runes.ts';
import { spellById } from '../src/core/spells.ts';
import { modeById } from '../src/core/modes.ts';
import { libraryBody, libraryCards, pickerButtons, pickInfo, MODE_LIB, SPELL_LIB, MODE_PICKS, SPELL_PICKS } from '../src/ui/library.ts';
import { inlineCssGraph } from '../tools/css-graph.mjs';
import { SPLIT_ICON_PAD, splitDieIconSVG } from '../tools/appicon.mjs';
import { splitMarkMarkup } from '../src/ui/split-mark.ts';
import { discoverDesignScreens } from './screen-library.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const die = (m) => { console.error('DESIGN BUILD FAILED: ' + m); process.exit(1); };
/* modeById falls back to classic by design; spellById returns null, and a card
   naming a rune that does not exist must fail the build rather than render a
   blank card nobody notices for a month */
const spellOr = (id) => spellById(id) ?? die(`no such spell: ${id}`);

let css;
try {
  css = inlineCssGraph(
    ['src/styles/page.css', 'src/styles/main.css', 'src/online/online.css'],
    { rootDir: root },
  ).css;
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}

/* THE FACES TRAVEL WITH THE CARD. The graph is inlined as TEXT into a file that
 * lands in design/dist/, so `url(../fonts/x.woff2)` — correct where it was
 * written, under src/styles/foundations/ — would resolve against the wrong
 * directory and quietly fall back to whatever the host owns. That is the exact
 * failure the app just stopped having, and a card rendering in a face the
 * product does not ship is a card that lies about the product.
 * Inlined rather than copied next to the cards because the Design pane serves
 * one HTML file per card with nothing beside it, and because a card that needs
 * no network renders the same on the Linux runner as it does here.
 * Resolution is by basename against src/styles/fonts/ and it FAILS LOUDLY: app
 * CSS carries no other url() asset today, so anything that does not resolve is
 * a new one nobody taught this about. */
const FONT_DIR = join(root, 'src', 'styles', 'fonts');
css = css.replace(/url\(([^)]*\/)?([\w.-]+\.woff2)\)/g, (_, _dir, file) => {
  let data;
  try {
    data = readFileSync(join(FONT_DIR, file));
  } catch {
    die(`design/build.mjs cannot inline ${file}: no such file in src/styles/fonts/`);
  }
  return `url(data:font/woff2;base64,${data.toString('base64')})`;
});
if (/url\((?!data:)/.test(css)) {
  die('app CSS gained a url() asset design/build.mjs does not know how to inline: '
    + css.match(/url\((?!data:)[^)]*\)/)[0]);
}

/* Bare app classes whose rule would SWALLOW a card's element rather than merely
   tint it — the ones a card must never redefine. Cards deliberately tune shared
   chrome (.shead, .btn, .lbl) and that is the point of them; the hazard is the
   narrow set that hides or hard-sizes, because there the app wins in silence.
   .pip ships opacity:0, so a study's form strip rendered as literally nothing. */
const HOSTILE = { opacity: /opacity\s*:\s*0(?!\.)/, display: /display\s*:\s*none/,
                  position: /position\s*:\s*(absolute|fixed)/, height: /(^|;)\s*height\s*:/ };
/* For each BARE app class, which hostile properties its rule pins. A card may
   wear such a class freely — card CSS is inlined after the app's, so a card
   rule that sets the same property simply wins. The hazard is the card that
   styles the class WITHOUT covering the pinned property: `.step .pts` set only
   a margin, so the app's `position:absolute` survived and four tier numbers
   flew to the corner. */
const greedy = new Map();
/* The boundary must be a LOOKBEHIND: a consuming ([{}]) eats the previous
   rule's closing brace, so consecutive rules alternate matched/skipped and
   half the stylesheet is invisible — .dhead's position:absolute slipped
   through exactly that hole. Comments go first; they can hold braces. */
for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g)) {
  const pinned = Object.entries(HOSTILE).filter(([, re]) => re.test(rule[2])).map(([k]) => k);
  if (!pinned.length) continue;
  for (const sel of rule[1].split(',')) {
    const m = sel.trim().match(/^\.([a-zA-Z][\w-]*)$/);
    if (m) greedy.set(m[1], new Set([...(greedy.get(m[1]) ?? []), ...pinned]));
  }
}

/* preview-only chrome: the phone-shaped stage, the flow-chips strip, and the
   two things a STUDY card always needs — a label over each variant and a note
   under the set explaining the proposal. Those were being redeclared per card
   (53, 71, and every study in 6x/7x/8x), which is a copy per card of two
   rules. They live here now, so a study only writes what is actually new. */
/* RETIRED PRODUCT CSS. The two-dice hero left src/styles/screens/home.css on
   2026-09-03 when Home started wearing the split mark (design 14e / L5). Three
   boards still have to DRAW it — the archived 13c and the logo studies 14a-14c
   all argue against today's hero and are worthless without a picture of it — so
   the rules move here rather than staying dead in the app's bundle. This is the
   one legitimate place for product CSS the product no longer has: a design
   library that cannot render its own history cannot be read. */
const retiredHero = `
.duel{display:flex;align-items:center;gap:18px;margin:20px 0 6px}
.duel .die{width:74px;height:74px;--cell:74px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.34),inset 0 -6px 12px rgba(0,0,0,.35),
  0 5px 14px rgba(0,0,0,.55),
  var(--duel-die-outer-glow,0 0 34px color-mix(in srgb,var(--dc) 45%,transparent))}
.duel .die.p1{transform:rotate(-9deg)}
.duel .die.p2{transform:rotate(9deg)}
.duel .vs{font-size:19px;font-weight:var(--fw-max);letter-spacing:.08em;color:var(--gold);
  text-shadow:0 0 18px rgba(255,209,102,.65);font-style:italic}
`;

const chrome = `${retiredHero}
.cap2{font-size:9.5px;letter-spacing:.26em;color:var(--dim);text-transform:uppercase;
  text-align:center;width:100%}
.note{font-size:11.5px;line-height:1.6;color:#c6d3ee;width:100%;max-width:var(--w-col);
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);
  border-radius:14px;padding:11px 13px;box-sizing:border-box}
.note b{color:var(--gold)}
body{display:flex;flex-direction:column;align-items:center;gap:14px;padding:18px 12px;overflow:auto}
.stage{position:relative;width:384px;border-radius:26px;overflow:hidden;flex:0 0 auto;
  border:1px solid rgba(255,255,255,.14);background:var(--bg);
  box-shadow:0 24px 60px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.04)}
.stage .bgfx{position:absolute;inset:0;overflow:hidden;background:
  radial-gradient(120% 80% at 50% -10%, #17123a 0%, transparent 60%),
  radial-gradient(110% 70% at 50% 110%, #04263a 0%, transparent 60%),var(--bg)}
.stage .bgfx::before{content:"";position:absolute;inset:-30%;
  background:
    radial-gradient(closest-side,rgba(255,47,160,.42),transparent 70%) 20% 16%/64% 48% no-repeat,
    radial-gradient(closest-side,rgba(40,232,255,.36),transparent 70%) 80% 86%/66% 50% no-repeat,
    radial-gradient(closest-side,rgba(126,60,255,.30),transparent 70%) 62% 42%/52% 40% no-repeat;
  filter:blur(34px)}
.stage .scr{position:relative;z-index:1;display:flex;flex-direction:column;
  min-height:640px;padding:14px 16px}
.flows{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:384px}
.flows .fc{font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);
  border:1px dashed rgba(255,255,255,.22);border-radius:99px;padding:3px 9px}
.flows .fc b{color:var(--cy);font-weight:var(--fw-strong)}
.dice-static .die{animation:none}
/* Product cards are compact stages rather than runtime .ov rooms. Start the
   same shared primary-button beat here so Home, results, auth, Offline, and
   question cards preview the shipped motion instead of freezing its base
   pseudo outside the app's topmost-overlay selector. */
.stage .btn.primary:enabled::after{animation:primaryGlint var(--primary-glint-cycle,5.2s) ease-in-out infinite}
/* the app's gradient title is scoped .ov h1 (overlay); cards have no .ov,
   so the chrome provides the same look for bare card headings — reading the
   DUEL PAIR, not the raw hues: .ov h1 tracks --p1/--p2, so a chrome pinned to
   cyan-and-magenta would render every card's title in a palette the player
   may have moved away from in Settings.

   :where() IS LOAD-BEARING. Written as .scr h1 (no :where) this had specificity (0,1,1)
   — exactly the app's own :where(#kbroot) .hero h1 — and the chrome is
   appended last, so it WON. Every card showing the Home wordmark rendered it
   at .22em while the product shipped .24em, and the design library quietly
   disagreed with the app it exists to picture. Reported 2026-09-03 as "font
   sizes not updated" against a build whose fonts were correct.
   At (0,0,1) this is what it was always meant to be: a fallback for headings
   no product rule claims, which any product rule outranks. */
:where(.scr) h1,:where(.scr) h2{margin:0;font-size:23px;font-weight:var(--fw-max);text-align:center;letter-spacing:.22em;
  background:linear-gradient(100deg,var(--p1),#fff 50%,var(--p2));
  -webkit-background-clip:text;background-clip:text;color:transparent}

/* THE STUDY BOARD, once. An animation study pictures the same thing every
   time — two facing half-boards of 52px slots, the chip row under each, a
   caption strip under that, and a nameplate at each end — and every study in
   4b/4c/4d wrote that scaffold out again, ~35 lines apiece, before it got to
   the one idea it exists to show. Same reason .cap2 and .note moved here.
   A card that needs different numbers simply declares them: card CSS is
   inlined after this, so an override is one line rather than a fresh copy.
   (The 4b/4c/4d studies predate this and still carry their identical private
   copy; they lose it the next time one of them is edited.) */
.spfield{position:relative;width:100%;display:flex;flex-direction:column;align-items:center}
.spboard{position:relative;display:grid;grid-template-columns:repeat(3,var(--cell));gap:var(--gap);
  justify-content:center}
.spcol{display:grid;grid-template-rows:repeat(3,var(--cell));gap:var(--gap);position:relative;border-radius:16px}
.spslot{width:var(--cell);height:var(--cell);border-radius:14px;position:relative;
  background:rgba(255,255,255,.028);border:1px solid rgba(255,255,255,.07);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05);display:grid;place-items:center}
/* each half wears its seat's colour, exactly as .side[data-owner] does in play */
.spmine{--cell:52px;--gap:6px}
.spmine .spslot{border-color:rgba(var(--p1-rgb),.13)}
.spfoe{--cell:52px;--gap:6px}
.spfoe .spslot{border-color:rgba(var(--p2-rgb),.13)}
/* THE AIM RING, restated because a card body cannot set the class the app
   opens it with: the real rule is html.casting .col.aim::after, and
   flow/spells puts .aim on the columns the spell's OWN legal() accepts. */
.spcol.aim::after{content:"";position:absolute;inset:-4px;border-radius:20px;pointer-events:none;
  border:1.5px dashed rgba(var(--gold-rgb),.55)}
.sprow3{display:grid;grid-template-columns:repeat(3,var(--cell));gap:var(--gap);
  justify-content:center;width:calc(var(--cell)*3 + var(--gap)*2)}
.spchip{height:20px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:var(--fw-strong);color:var(--c);font-variant-numeric:tabular-nums;position:relative;
  border:1px solid color-mix(in srgb,var(--c) 30%,transparent);
  background:color-mix(in srgb,var(--c) 9%,transparent);
  text-shadow:0 0 10px color-mix(in srgb,var(--c) 70%,transparent)}
/* the chip's corner glyph (a shield, a mode mark). NOTE this catches ANY <i>
   inside a chip, including a two-state count's own readings — which is why a
   counting chip IS the .spcount — class="spchip spcount", so the readings sit
   in the chip's own 20px of height — rather than wrapping a .spcount inside
   one: a nested .spcount
   collapses to zero height here and then clips both readings away. */
.spchip i{position:absolute;right:4px;top:0;bottom:0;display:flex;align-items:center;line-height:0;
  color:var(--gold);filter:drop-shadow(0 0 6px rgba(var(--gold-rgb),.75))}
.splbl{font-size:8.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--dim);
  text-align:center;min-height:11px;padding-top:4px;line-height:1.35}
.splbl.hit{color:var(--hue,var(--gold))}
.splbl.no{color:#8ea3c0}
.splbl.safe{color:var(--gold)}
/* Every mark hangs on a wrapper of the die's own box. In the app it would be a
   class ON the die (the way .die.dying already is); a card cannot add one to a
   token, so a study wraps the token instead. */
.spmark{position:relative;display:block;line-height:0}
/* ONE element, two readings — the number (or face) before the beat and after
   it. The cards own the CUT; this owns only the stacking. */
.spcount{position:relative;overflow:hidden}
.spcount > i{font-style:normal}
.spcount .spnew{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
/* the nameplate at each end of a study board, narrowed to the phone's column */
.pline{max-width:206px;margin:0 auto}

/* THE LAUNCHER STUDY BOARD, once. An app-icon study pictures the same things
   every time — the mark inside iOS's squircle at App Store scale, the same
   mark at Home (60), Spotlight (40) and Settings (29) size on a dark Home
   screen beside the SHIPPED icon, and a note — so that scaffold lives here and
   a study writes only its own mark. A mark is authored ONCE in a 120-unit
   square (.icomark) and every frame scales it with --S, so the 29px Settings
   reading is the hero's own pixels rather than a redrawn small version. The
   dice inside are the app's own die token; a study positions them through
   .icopos wrappers because a card cannot add a class to a token. */
.icohead{width:100%;max-width:var(--w-col);margin:4px auto 0;text-align:left}
.icohead .eyebrow{font-size:9px;letter-spacing:.34em;color:var(--dim);text-transform:uppercase}
.icohead h1{font-size:18px;text-align:left;margin:4px 0 7px}
.icohead p{font-size:10px;line-height:1.55;letter-spacing:.1em;color:var(--dim);margin:0}
.icoframe{position:relative;width:calc(var(--S)*1px);height:calc(var(--S)*1px);flex:0 0 auto;
  border-radius:22.4%;overflow:hidden;isolation:isolate;
  background:linear-gradient(#313131,#141414);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.07),0 8px 22px rgba(0,0,0,.55)}
.icomark{position:absolute;left:0;top:0;width:120px;height:120px;transform-origin:0 0;
  transform:scale(calc(var(--S)/120));overflow:hidden}
.icomark .icopos{position:absolute;display:block;line-height:0;transform-origin:50% 50%}
.icomark .die{animation:none}
.icomark .pip{transition:none}
.icohero{display:flex;flex-direction:column;align-items:center;gap:10px;margin:16px auto 0}
.icohome{width:100%;max-width:var(--w-col);box-sizing:border-box;margin:14px auto 0;
  padding:16px 14px 12px;border-radius:20px;border:1px solid rgba(255,255,255,.08);
  background:radial-gradient(120% 90% at 50% 0%,#141527 0%,#07070c 58%,#000 100%)}
.icorow{display:flex;justify-content:space-between;align-items:flex-start}
.icoapp{display:flex;flex-direction:column;align-items:center;gap:6px;width:64px}
.icoapp .nm{font-family:-apple-system,"SF Pro Text",system-ui,sans-serif;font-size:10.5px;
  color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.6);white-space:nowrap}
.icotile{width:60px;height:60px;border-radius:22.4%;flex:0 0 auto;
  background:linear-gradient(160deg,#2b2c35,#15161c);box-shadow:inset 0 0 0 1px rgba(255,255,255,.05)}
.icoapp .appicon-mark{width:60px;height:60px;border-radius:22.4%;display:block;
  box-shadow:0 8px 22px rgba(0,0,0,.55)}
.icosizes{display:flex;justify-content:center;align-items:flex-end;gap:26px;margin:14px auto 0}
.icosize{display:flex;flex-direction:column;align-items:center;gap:7px}
.icosize .cap2{font-size:8px;letter-spacing:.18em}
`;

/* An avatar is a die wearing a RAW hue (ui/avatar.ts) — never the duel pair,
   because a player who picked a cyan face keeps it whatever Settings does to
   --p1/--p2. paintAvatar fills the slot at runtime; here the slot is filled at
   build time from the same parse, so a card cannot picture a face the app
   could not produce. */
function avatarHtml(spec, size) {
  const { face, hue } = parseAvatar(spec);
  return dieMarkup(face, { classes: 'p1', size, inlineStyle: `--dc:${AV_HUES[hue]}` });
}

/* THE FONT STUDY'S CANDIDATE FACES (study 58).
 *
 * The app ships no font file: src/styles/page.css names OS-provided faces only,
 * which is why tests/support/rendering-font.mjs exists to say out loud when a
 * host is measuring a rendering no player will ever see. A card picturing a
 * candidate therefore has to CARRY that candidate — there is nothing on the
 * machine to name.
 *
 * design/fonts/<slug>/ holds a text subset of each family, cut to the glyphs
 * these cards paint, beside the OFL text that is our permission to ship it at
 * all; candidates.json is the index. The faces go in as data URIs so a synced
 * card needs no network and lays out identically on the Linux runner and here,
 * which is also the study's own argument: a bundled face ends the fontconfig
 * lottery. The subsets are PREVIEW material — a shipped bundle takes the full
 * latin + latin-ext files from the same families. */
const FONT_CANDIDATES = JSON.parse(readFileSync(join(here, 'fonts', 'candidates.json'), 'utf8'));

function fontFaces(slug, onlyWeight) {
  const candidate = FONT_CANDIDATES.find((c) => c.slug === slug);
  if (!candidate) die(`no such font candidate: {{font:${slug}}} (design/fonts/candidates.json)`);
  const weights = Object.keys(candidate.files).map(Number)
    .filter((w) => !onlyWeight || w === onlyWeight);
  if (!weights.length) die(`font candidate ${slug} has no weight ${onlyWeight}`);
  const faces = weights.map((w) => {
    const data = readFileSync(join(here, 'fonts', slug, `${w}.woff2`)).toString('base64');
    /* font-display:block, not swap: a card is a still picture that gets
       screenshotted, and a swap would let the fallback be what the camera
       caught. */
    return `@font-face{font-family:"${candidate.family}";font-style:normal;font-weight:${w};`
      + `font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2")}`;
  });
  /* The card wears the face through a data attribute rather than an inline
     style, so the family name is written ONCE, here, from the index — a card
     that retyped it could ask for a family its own @font-face never defined
     and silently render the fallback, which is the one failure a font study
     must not be able to have. */
  faces.push(`[data-font="${slug}"]{font-family:"${candidate.family}",ui-rounded,system-ui,sans-serif}`);
  return `<style>${faces.join('\n')}</style>`;
}

function appIconMarkup(size, appearance) {
  const svg = appearance === 'light'
    ? splitDieIconSVG(512, SPLIT_ICON_PAD, 'light', false)
    : splitDieIconSVG(512, SPLIT_ICON_PAD, 'dark', true);
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return `<img class="appicon-mark" src="${source}" width="${size}" height="${size}" alt="">`;
}

/* The LAUNCH mark is the launcher's split die DESATURATED, since 2026-09-03.
   The geometry is the same object — tools/splash.mjs draws splitDieIconSVG, so
   tile, storyboard and hero cannot drift — but the launch frame claims no hue.
   It has to: iOS compiles one launch image into Info.plist and has no
   alternate-launch-image API to match its alternate ICONS, so a coloured frame
   would contradict all 41 players who did not keep the default pair. Grey
   contradicts nobody, and the colour arrives when the webview paints.
   The filter and opacity live here rather than in each card's CSS: a card that
   dimmed its own copy would be a second answer to the same question. */
function splashMarkMarkup(size) {
  const svg = splitDieIconSVG(512, SPLIT_ICON_PAD, 'dark', true);
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return `<img class="appicon-mark launch-mark" src="${source}" width="${size}" height="${size}" alt=""`
    + ` style="filter:grayscale(1);opacity:.62">`;
}

/* Device sizes: every screen ships at each of these. The stage is the phone
   screen; on tablet the app keeps its real max-width column, centered — that
   is honestly how it renders there today. Foundations skips variants. */
const SIZES = [
  { key: 'sm', suffix: ' · 360', stageW: 336, minH: 580, dH: -70 },
  { key: 'md', suffix: '', stageW: 384, minH: 640, dH: 0 },
  { key: 'max', suffix: ' · 430 Max', stageW: 402, minH: 720, dH: 50 },
  { key: 'tab', suffix: ' · Tablet', stageW: 520, minH: 960, dH: 300 },
];

mkdirSync(join(here, 'dist'), { recursive: true });
/* Every file this run is entitled to leave behind. dist used to be written
   into and never cleaned, so a screen deleted from design/screens/ kept its
   four built cards AND its four manifest entries forever — and the sync would
   faithfully re-upload a card the repo no longer has. The stale ones are
   pruned AFTER the build rather than by emptying the directory first, because
   two builds can overlap (a peer session, an agent) and a wipe-then-write
   would serve one of them a half-empty dist. */
const built = new Set();
let screens;
try {
  screens = discoverDesignScreens(join(here, 'screens'));
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}

for (const screen of screens) {
  const f = screen.basename;
  const src = readFileSync(screen.file, 'utf8');
  const meta = src.match(/^<!-- meta ([\s\S]*?)-->/);
  if (!meta) die(f + ': missing meta comment');
  const attr = (k, d) => meta[1].match(new RegExp(k + '="([^"]*)"'))?.[1]
    ?? meta[1].match(new RegExp(k + '=(\\d+)'))?.[1] ?? d;
  const name = attr('name', f);
  const group = attr('group', 'Screens');
  const subtitle = attr('subtitle', '');
  const width = attr('width', '412');
  const height = attr('height', '900');
  const links = attr('links', '');

  /* A card's own <style> may not REDEFINE a bare app class. Reuse is the whole
     point of these cards — .btn, .shead, .row are meant to be worn — but a card
     that writes `.pip{...}` is not reusing the die's pip, it is fighting it,
     and the app usually wins silently: .pip ships opacity:0, so a study's form
     strip rendered as nothing at all. Scoped rules (`.tile .k`) are safe by
     construction and are not flagged, and neither is tuning shared chrome —
     only the classes whose app rule HIDES or hard-sizes (see `greedy` above).
     This repo has paid for that three times now (.fc, .table/.face, .pip and
     .chip); it is a check, not a memory. */
  const cut = src.indexOf('</style>');
  const style = cut < 0 ? '' : src.slice(src.indexOf('<style>'), cut);
  const markup = cut < 0 ? src : src.slice(cut);
  if (style) {
    /* A card that both STYLES a name and USES it in markup wants its own
       meaning for it. Scoping its own rule (`.step .pts`) does not help: the
       app's bare `.pts` still matches the element, and .pts is absolutely
       positioned, so four tier numbers flew to the corner. Cards that reuse a
       guarded class on purpose (.ico, .dial, .dtrail) never declare it — that
       is exactly what tells the two apart. */
    const noCss = style.replace(/\/\*[\s\S]*?\*\//g, ' ');       // a comment naming .ico is prose
    const noHtml = markup.replace(/<!--[\s\S]*?-->/g, ' ');
    const used = new Set();
    for (const m of noHtml.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) used.add(c);
    /* every property this card declares, per class name it mentions in a selector */
    const declared = new Map();
    for (const rule of noCss.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g)) {
      const props = new Set([...rule[2].matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((m) => m[1]));
      for (const name of new Set([...rule[1].matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))) {
        declared.set(name, new Set([...(declared.get(name) ?? []), ...props]));
      }
    }
    for (const [name, pinned] of greedy) {
      if (!used.has(name) || !declared.has(name)) continue;   // worn as-is: that is reuse
      const missed = [...pinned].filter((prop) => !declared.get(name).has(prop));
      if (missed.length) {
        die(`${f}: styles .${name}, which the app pins with ${missed.join(', ')} — your rule does `
          + `not override that, so the app's wins. Rename the card's class, or set ${missed.join(' and ')}.`);
      }
    }
  }

  let body = src.slice(meta[0].length)
    .replace(/\{\{appicon(?::(\d+))?(?::(light))?\}\}/g,
      (_, size, appearance) => appIconMarkup(size ? +size : 44, appearance))
    /* a study's candidate typeface, faces and all (design/fonts/) */
    .replace(/\{\{font:([a-z0-9]+)(?::(\d+))?\}\}/g, (_, slug, w) => fontFaces(slug, w ? +w : 0))
    .replace(/\{\{splashmark(?::(\d+))?\}\}/g, (_, size) => splashMarkMarkup(size ? +size : 44))
    /* Home's hero, as LIVE DOM from src/ui/split-mark.ts — the same element the
       app renders, so a card cannot show a mark the product does not have. The
       appicon token is the launcher's baked image and is not interchangeable. */
    .replace(/\{\{splitmark(?::(\d+))?\}\}/g, (_, size) => splitMarkMarkup(size ? +size : 96))
    /* The class slot is a LIST, not one name: a die in play is `p2 m2` when its
       column holds a pair (ui/game/board.ts toggles m2/m3 on that count), and a
       card that could only ask for `p2` had to restate the shared dice CSS to show
       one — a second copy of the multiplier look, in the file that exists to
       stop second copies. `gold` stays as the shorthand it always was. */
    .replace(/\{\{die:(\d):([a-z0-9]+(?: [a-z0-9]+)*)(?::(\d+))?\}\}/g,
      (_, v, cls, size) => dieMarkup(+v, {
        classes: cls === 'gold' ? 'p1 m2' : cls,
        size: size ? +size : undefined,
      }))
    .replace(/\{\{mico:([a-z]+)(?::(\d+))?\}\}/g, (_, id, size) => modeIcon(id, size ? +size : 24))
    .replace(/\{\{mhue:([a-z]+)\}\}/g, (_, id) => modeHue(id))
    /* runes render through the app too. A card that hand-draws one is a second
       implementation of a registry entry: card 27 had five copies of a rune
       that had already been RETIRED, and nothing noticed. spellOr() fails the
       build on a rune that does not exist, same as the felt token. */
    .replace(/\{\{sico:([a-z]+)(?::(\d+))?\}\}/g,
      (_, id, size) => (spellOr(id), spellIcon(id, size ? +size : 22)))
    .replace(/\{\{shue:([a-z]+)\}\}/g, (_, id) => (spellOr(id), spellHue(id)))
    .replace(/\{\{account-runes:([a-z]+(?:,[a-z]+)*)\}\}/g, (_, spec) => {
      const collected = spec.split(',');
      for (const id of collected) spellOr(id);
      return accountRunesMarkup(collected, 'preview');
    })
    /* THE LOADER, compiled through ui/loader.ts's pure markup seam: the card
       and runtime share the die, wrapper, label and accessibility structure. */
    /* THE VERSUS LINE, from ui/reveal.ts itself. Both dial cards used to hand-
       write "Opponent NAME · RATING" — the single-line treatment the opponent
       study replaced — so the two cards that picture the reveal were the last
       place in the repo still showing the losing option. */
    .replace(/\{\{versus:([^}]+)\}\}/g, (_, spec) => {
      const sides = spec.split('|').map((s) => s.split(':'));
      if (sides.length !== 2) die(`versus needs two sides: {{versus:${spec}}}`);
      const av = sides.map((p) => avatarHtml(p.slice(2).join(':'), 44));
      let n = 0;
      return versus(...sides.map((p) => ({ name: p[0], rating: p[1] ? +p[1] : null })))
        .replace(/<span class="dav"><\/span>/g, () => `<span class="dav">${av[n++]}</span>`);
    })
    .replace(/\{\{loader(?::(\d+))?(?::([^}]+))?\}\}/g, (_, size, label) => {
      const px = size ? +size : 44;
      return loaderWaitMarkup(px, label ?? 'Loading');
    })
    .replace(/\{\{ico:([a-z]+)(?::(\d+))?\}\}/g, (_, id, size) => chromeIcon(id, size ? +size : 15))
    .replace(/\{\{score:(\w+):(-?\d+):(\w+):(-?\d+)\}\}/g, (_, la, a, lb, b) => scoreLine(la, +a, lb, +b))
    .replace(/\{\{dialnodes(?::([a-z]+))?\}\}/g, (_, found) => dialNodes(found))
    .replace(/\{\{(wsettled|wanswer):(mode|rune):([a-z]+)\}\}/g, (_, what, kind, id) => {
      const beat = kind === 'mode' ? dialBeat(modeById(id)) : dealBeat(spellOr(id));
      return what === 'wsettled' ? settledAnswer(beat) : answerLines(beat);
    })
    .replace(/\{\{runefelt:([a-z]+)(?::(up))?\}\}/g, (_, id, up) => {
      return runeFelt(spellOr(id), !!up);
    })
    /* The in-game rail wraps this shared anatomy with charge/ownership state.
       Studies may vary that wrapper while preserving the production card. */
    .replace(/\{\{runefaces:([a-z]+)\}\}/g, (_, id) => {
      return runeCardFaces(spellOr(id), 12, 21, false);
    })
    .replace(/\{\{library:(modes|spells)(?::([a-z]+))?\}\}/g,
      (_, roster, now) => libraryCards(roster === 'modes' ? MODE_LIB : SPELL_LIB, now))
    /* ONE entry, as the SHEET's body. {{library}} above deals a whole roster;
       the sheet ui/library openEntry() throws up holds exactly one entry, and
       a card picturing that sheet would otherwise re-type a rune's rule text —
       the fifth copy of the registry this file exists to prevent (card 27 held
       five copies of a rune that had already been retired). Both go through
       libraryBody(), so the sheet on a card and the sheet in the app are the
       same three lines. An id the roster does not carry fails the build, which
       is exactly what the runtime does with it: openEntry() returns false on an
       id LIBS does not hold. */
    .replace(/\{\{libentry:(modes|spells):([a-z_]+)\}\}/g, (_, roster, id) => {
      const spec = roster === 'modes' ? MODE_LIB : SPELL_LIB;
      const item = spec.items.find((entry) => entry.id === id);
      return item ? libraryBody(item) : die(`no such ${roster} library entry: ${id}`);
    })
    .replace(/\{\{picker:(modes|spells)(?::(-?\w+))?\}\}/g,
      (_, roster, now) => pickerButtons(roster === 'modes' ? MODE_PICKS : SPELL_PICKS, now ?? ''))
    .replace(/\{\{pickinfo:(modes|spells)(?::(-?\w+))?\}\}/g, (_, roster, now) => {
      const items = roster === 'modes' ? MODE_PICKS : SPELL_PICKS;
      return pickInfo(items, now);
    });

  const flows = links
    ? `<div class="flows">${links.split(',').map((l) => `<span class="fc">→ <b>${l.trim()}</b></span>`).join('')}</div>`
    : '';

  /* sizes="max" (a comma list of keys) lets a STUDY ship at one device size —
     eight alternatives × four sizes is a wall, not a comparison. Product
     screens keep all four; the default is unchanged. */
  const only = attr('sizes', '');
  const sizes = f.startsWith('00-') ? SIZES.filter((s) => s.key === 'md')
    : only ? SIZES.filter((s) => only.split(',').map((k) => k.trim()).includes(s.key))
    : SIZES;
  if (!sizes.length) die(f + `: sizes="${only}" names no known size (sm, md, max, tab)`);
  for (const s of sizes) {
    const sizeCss = `.stage{width:${s.stageW}px}.stage .scr{min-height:${s.minH}px}`;
    const outName = s.key === 'md' ? f : f.replace('.html', `--${s.key}.html`);
    const cardName = name + (sizes.length > 1 ? s.suffix : '');   // one size needs no size tag
    const cardW = f.startsWith('00-') ? width : s.stageW + 44;
    const cardH = f.startsWith('00-') ? height : Math.max(1, +height + s.dH);
    const out = `<!-- @dsCard group="${group}" name="${cardName}" subtitle="${subtitle}" width=${cardW} height=${cardH} -->
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cardName}</title>
<style>${css}\n${chrome}\n${sizeCss}</style></head>
<body id="kbroot">
${body}
${flows}
</body></html>`;
    writeFileSync(join(here, 'dist', outName), out);
    built.add(outName);
  }
  console.log('built', f, `(${group} · ${name} × ${sizes.length})`);
}
for (const f of readdirSync(join(here, 'dist'))) {
  if (f.endsWith('.html') && !built.has(f)) {
    rmSync(join(here, 'dist', f));
    console.log('pruned', f, '(no longer in classified design screens)');
  }
}
/* The Design System pane renders what _ds_manifest.json lists — emit it here
   so every sync carries a complete, correctly-ordered card index. */
const rank = { sm: 0, md: 1, max: 2, tab: 3 };
const cards = readdirSync(join(here, 'dist'))
  .filter((f) => f.endsWith('.html'))
  .map((f) => {
    const first = readFileSync(join(here, 'dist', f), 'utf8').split('\n', 1)[0];
    const a = (k) => first.match(new RegExp(k + '="([^"]*)"'))?.[1] ?? '';
    const size = f.match(/--(sm|max|tab)\.html$/)?.[1] ?? 'md';
    return { path: 'screens/' + f, group: a('group'), subtitle: a('subtitle'), name: a('name'),
             _base: f.replace(/--(sm|max|tab)\.html$/, '.html'), _r: rank[size] };
  })
  .sort((x, y) => x._base.localeCompare(y._base) || x._r - y._r)
  .map(({ _base, _r, ...card }) => card);
writeFileSync(join(here, 'dist', '_ds_manifest.json'), JSON.stringify({
  namespace: 'Knucklebones_e7cddf', components: [], startingPoints: [], cards,
  templates: [], hasThumbnailHtml: false, globalCssPaths: [], tokens: [],
  themes: [], fonts: [], brandFonts: [], source: 'spa',
}, null, 2));
console.log('manifest:', cards.length, 'cards');
console.log('design cards ready in design/dist/');
