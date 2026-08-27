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
import { settledAnswer, answerLines, versus } from '../src/ui/reveal.ts';
import { parseAvatar, AV_HUES } from '../src/ui/avatar.ts';
import { dieMarkup } from '../src/ui/die-markup.ts';
import { loaderWaitMarkup } from '../src/ui/loader.ts';
import { accountRunesMarkup } from '../src/online/screens/account-runes.ts';
import { spellById } from '../src/core/spells.ts';
import { modeById } from '../src/core/modes.ts';
import { libraryCards, pickerButtons, pickInfo, MODE_LIB, SPELL_LIB, MODE_PICKS, SPELL_PICKS } from '../src/ui/library.ts';
import { inlineCssGraph } from '../tools/css-graph.mjs';
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
const chrome = `
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
.flows .fc b{color:var(--cy);font-weight:800}
.dice-static .die{animation:none}
/* Product cards are compact stages rather than runtime .ov rooms. Start the
   same shared primary-button beat here so Home, results, auth, Offline, and
   question cards preview the shipped motion instead of freezing its base
   pseudo outside the app's topmost-overlay selector. */
.stage .btn.primary:enabled::after{animation:primaryGlint 5.2s ease-in-out infinite}
/* the app's gradient title is scoped .ov h1 (overlay); cards have no .ov,
   so the chrome provides the same look for bare card headings — reading the
   DUEL PAIR, not the raw hues: .ov h1 tracks --p1/--p2, so a chrome pinned to
   cyan-and-magenta would render every card's title in a palette the player
   may have moved away from in Settings. */
.scr h1,.scr h2{margin:0;font-size:23px;font-weight:900;text-align:center;letter-spacing:.22em;
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
  font-size:12px;font-weight:800;color:var(--c);font-variant-numeric:tabular-nums;position:relative;
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
