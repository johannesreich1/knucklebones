// THE OFFLINE SHEET HOLDS STILL.
//
// A settings form that reflows while you read it is exhausting, and this one
// did: choosing 2 PLAYERS moved the Game mode and Rune cards 143px because
// .pbody was vertically centred, and trying a different game mode moved every
// card below it by a line because the description slot resized. Both were
// invisible to state-and-DOM assertions — the markup was always "correct".
//
// So this measures what the player's eye actually tracks: the top of each card,
// in pixels, before and after. Four device sizes, because the descriptions wrap
// differently on each (five of seven modes take two lines at 360 and one at
// 430) and a reservation that only fits the phone in hand is not a fix.
import pkg from 'playwright';
const { webkit } = pkg;
const F = 'file://' + process.cwd() + '/knucklebones-neon.html';
const SIZES = [[360, 780, 'sm 360'], [390, 844, 'md 390'], [430, 932, 'max 430'], [768, 1024, 'tab 768']];

const problems = [], out = {};
const check = (c, m, x) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };
const browser = await webkit.launch();
try {
  for (const [width, height, label] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push('PAGEERROR ' + label + ': ' + e.message));
    await page.goto(F);
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__kb.openPractice());
    await page.waitForTimeout(120);

    const r = await page.evaluate(() => {
      const $ = (s) => document.querySelector(s);
      const top = (s) => Math.round($(s).closest('.card').getBoundingClientRect().top);
      const seg = (m) => document.querySelector(`#modeSeg button[data-m="${m}"]`).click();
      const shot = () => ({ mode: top('#modePick'), spell: top('#spellPick') });

      // every description, measured in its slot
      const slot = (strip, info) => [...document.querySelectorAll(strip + ' button')].map((b) => {
        b.click();
        return Math.round($(info).getBoundingClientRect().height);
      });
      const modeSlots = slot('#modePick', '#modePickInfo');
      const spellSlots = slot('#spellPick', '#spellPickInfo');

      seg('cpu'); const cpu = shot();
      seg('duo'); const duo = shot();
      // the notes must fit the two lines reserved for them, not spill out
      const spill = [...document.querySelectorAll('#ovPractice .note')]
        .filter((e) => !e.closest('[hidden]'))
        .filter((e) => e.scrollHeight > e.clientHeight + 1).map((e) => e.id);
      seg('cpu');
      /* Mobile WebKit must paint the selected segment itself. Its native
         button bevel plus a transparent border produced a bright bar down the
         left edge on-device. Read the rendered edge, not just the class. */
      const selected = document.querySelector('#modeSeg button.on');
      const selectedStyle = getComputedStyle(selected);
      const root = document.getElementById('kbroot');
      const colourProbe = document.createElement('i');
      colourProbe.style.color = 'var(--p1)';
      root.append(colourProbe);
      const segmentEdge = {
        appearance: selectedStyle.appearance,
        webkitAppearance: selectedStyle.webkitAppearance,
        borderLeft: selectedStyle.borderLeftColor,
        p1: getComputedStyle(colourProbe).color,
      };
      colourProbe.remove();

      /* The prose contract is semantic and live: both ordinary <b> copy and
         the rules' special .k highlight follow --p2 when the chosen opponent
         hue changes. This covers every .rules surface, not Privacy alone. */
      const privacyBold = document.querySelector('#ovPrivacy .rules b');
      const rulesKeyword = document.querySelector('#ovRules .rules .k');
      const proseBefore = {
        bold: getComputedStyle(privacyBold).color,
        keyword: getComputedStyle(rulesKeyword).color,
      };
      root.style.setProperty('--p2', '#00ff66');
      const proseAfter = {
        bold: getComputedStyle(privacyBold).color,
        keyword: getComputedStyle(rulesKeyword).color,
      };
      root.style.removeProperty('--p2');
      return { modeSlots, spellSlots, cpu, duo, spill, segmentEdge, proseBefore, proseAfter };
    });
    out[label] = r;

    const swing = (a) => Math.max(...a) - Math.min(...a);
    check(swing(r.modeSlots) === 0, 'the game-mode description slot resizes: ' + label, r.modeSlots);
    check(swing(r.spellSlots) === 0, 'the spell description slot resizes: ' + label, r.spellSlots);
    check(r.cpu.mode === r.duo.mode, 'the Game mode card moves on cpu/duo: ' + label, [r.cpu.mode, r.duo.mode]);
    check(r.cpu.spell === r.duo.spell, 'the Rune card moves on cpu/duo: ' + label, [r.cpu.spell, r.duo.spell]);
    check(r.spill.length === 0, 'a note overflows its reserved lines: ' + label, r.spill);
    check(r.segmentEdge.appearance === 'none',
      'a selected segment still wears the native WebKit button bevel: ' + label, r.segmentEdge);
    check(r.segmentEdge.borderLeft === r.segmentEdge.p1,
      'a selected segment leaves its bright left edge unpainted: ' + label, r.segmentEdge);
    check(r.proseBefore.bold === r.proseBefore.keyword,
      'informational highlights disagree before an opponent-colour change: ' + label, r.proseBefore);
    check(r.proseAfter.bold === 'rgb(0, 255, 102)' && r.proseAfter.keyword === 'rgb(0, 255, 102)',
      'informational highlights do not follow the opponent colour: ' + label, r.proseAfter);

    /* ---- EVERY titled page is the SAME page ----
       A view with a title and a back button pins its header and scrolls its
       body, so the ‹ never leaves the thumb — and the body's top edge fades
       rather than guillotining what scrolls past it. This was an opt-in class
       that three views (OFFLINE, HOW TO PLAY, SETTINGS) never opted into, so
       their headers scrolled away. Asserted over EVERY .ov.paged found, which
       is what stops the next one from being forgotten. */
    const paged = await page.evaluate(async () => {
      /* WAIT FOR A FRAME, NOT FOR THE CLOCK. --sc is authored from a scroll
         handler, and WebKit runs scroll steps INSIDE the rendering update,
         immediately before the rAF callbacks — never on a plain task turn. A
         setTimeout settles the glass only if a frame happened to be produced
         inside it, which a headless Linux runner with no GPU does not promise:
         on CI every glass reading came back 0 and this suite reported that the
         frost never arrives, on views where it demonstrably does.
         CAPPED, deliberately. page.evaluate carries no Playwright timeout, so
         an unbounded rAF wait on a runner that has genuinely stopped painting
         turns a red row into a six-minute hang that run-all SIGKILLs — killing
         the JSON report this suite exists to print. With the cap it still
         samples, still fails, and still says what it saw. */
      const frame = () => Promise.race([
        new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        new Promise((r) => setTimeout(r, 400)),
      ]);
      /* Programmatic scrollTop writes do not consistently enqueue a scroll
         event in headless WebKit on Linux. Dispatch the same event a real
         scroll produces so this suite tests the shared capture handler, not
         the runner's decision about synthesising browser input. */
      const scrollTo = async (body, y) => {
        body.scrollTop = y;
        body.dispatchEvent(new Event('scroll'));
        await frame();
      };
      const rows = [];
      for (const ov of document.querySelectorAll('.ov.paged')) {
        const head = ov.querySelector('.shead'), body = ov.querySelector('.pbody');
        if (!head || !body) { rows.push({ id: ov.id, err: !head ? 'no .shead' : 'no .pbody' }); continue; }
        const was = ov.classList.contains('on');
        ov.classList.add('on');
        await frame();
        const bodyTop = body.getBoundingClientRect().top;
        const first = body.firstElementChild?.getBoundingClientRect();
        const before = head.getBoundingClientRect().y.toFixed(1);
        /* HOW FAR THE GLASS ACTUALLY REACHES, read off the pseudo-element
           rather than guessed from a var name. It used to read --band, which
           stopped governing the glass the day the falloff got its own length —
           the assertion kept passing while measuring something else entirely.
           A custom property holding a calc() comes back out of
           getComputedStyle as TEXT, so no var can be trusted for a number;
           `bottom` on an absolutely positioned box resolves to real pixels. */
        const glassBottom = head.getBoundingClientRect().bottom
                          - parseFloat(getComputedStyle(head, '::before').bottom || '0');
        /* AT REST THE GLASS IS NOT THERE. An unscrolled page has nothing
           passing under the bar, so frosting it only dims the aurora for
           nothing (user call). Appending rows fires no scroll event, so a
           lazily-grown list sitting at the top must stay clear too.
           NOTE this view was opened by hand above, never through ui/dom show(),
           and assigning a body's scrollTop the 0 it already holds fires NO
           scroll event — so nothing has ever authored --sc here. That is the
           point: "unscrolled means no glass" has to hold with no JavaScript in
           the story, which is what the `var(--sc, 0)` fallback buys. Without
           the fallback the declaration is invalid at computed-value time and
           opacity falls back to its initial 1. */
        await scrollTo(body, 0);
        const glassAtRest = +getComputedStyle(head, '::before').opacity;
        /* IT ARRIVES WITH THE CONTENT, not on the first pixel. A frost that
           snapped to full the instant anything moved read as a slab dropping in
           (user report, from the ladder). Sampled PART-WAY through the ramp:
           the value there must be strictly between nothing and everything, and
           must keep growing. A boolean implementation passes every other
           assertion in this file and fails only these two.
           THE SAMPLES ARE FRACTIONS OF THE RAMP, not two fixed pixel counts.
           10px and 26px were thirds of the 40px reserve the paged views used to
           carry; at the 12px every bar carries now (2026-08-22) that same 10px
           lands 83% of the way up, and "0.84 is less than 1" is a fade
           assertion in name only. Read the ramp the way ui/dom.ts reads it —
           --band + --headgap, as two plain lengths, because a custom property
           holding a calc() comes back out of getComputedStyle as text. */
        const ramp = (() => {
          const s = getComputedStyle(ov);
          const px = (n) => parseFloat(s.getPropertyValue(n));
          const sum = px('--band') + px('--headgap');
          return sum > 0 ? sum : 40;                // ui/dom.ts's own fallback
        })();
        await scrollTo(body, Math.max(1, Math.round(ramp * 0.3)));
        const glassPart = +getComputedStyle(head, '::before').opacity;
        await scrollTo(body, Math.round(ramp * 0.7));
        const glassMore = +getComputedStyle(head, '::before').opacity;
        await scrollTo(body, 600);                  // as far as this body goes
        const glassScrolled = +getComputedStyle(head, '::before').opacity;
        const after = head.getBoundingClientRect().y.toFixed(1);
        const cs = getComputedStyle(body);
        /* ONE PAGE, ONE SCROLLER. The glass is the bar's own backdrop, so it
           can only frost what passes behind THAT bar — a list scrolling
           separately would slide rows out from under glass that cannot reach
           them. (The ladder did exactly that as a mask-era scroller.) A
           bounded list inside a card is fine: it sits mid-page and never
           passes the header, so it is only counted when it fills the page. */
        const extra = [];
        for (const el of ov.querySelectorAll('*')) {
          const s = getComputedStyle(el);
          if (!/auto|scroll/.test(s.overflowY) && !/auto|scroll/.test(s.overflow)) continue;
          if (el === body) continue;
          const r = el.getBoundingClientRect();
          if (r.height > ov.getBoundingClientRect().height * 0.6) {   // page-filling
            extra.push(el.id || el.className || el.tagName);
          }
        }
        /* THE BAR IS THE GLASS: a gradient layer BEHIND the bar's own content
           (::before, so masking it never fades the title), reaching the screen's
           top edge and falling away past the bar's bottom. Content scrolls
           BEHIND the bar — the body starts at the bar's top, not below it —
           which is the whole point and the thing a regression would undo.
           Note: headless WebKit renders no backdrop-filter, so this asserts the
           DECLARATION, not the pixels; judge the pixels in Chromium. */
        const glass = getComputedStyle(head, '::before');
        const headBox = head.getBoundingClientRect();
        rows.push({ id: ov.id, stuck: before === after, scrolled: body.scrollTop,
          bodyScrolls: cs.overflowY === 'auto' || cs.overflowY === 'scroll',
          ovClips: getComputedStyle(ov).overflow === 'hidden',
          glass: /blur/.test(glass.backdropFilter || glass.webkitBackdropFilter || ''),
          glassAtRest, glassPart, glassMore, glassScrolled, ramp,
          scrollable: body.scrollHeight > body.clientHeight + 2,
          /* HOW FAR THIS PAGE CAN ACTUALLY TRAVEL. The ramp is sampled at
             three tenths and seven tenths of itself, so a body with less slack
             than the ramp cannot demonstrate a fade — it pins at one value and
             reads as "the glass snaps". That is not a regression, it is a page
             that nearly fits: Impressum became one the day its bottom button
             left (2026-08-22). Scrollable enough to bring the glass in at all
             is a weaker claim than scrollable enough to show it arriving, and
             the two assertions want different thresholds. */
          travel: body.scrollHeight - body.clientHeight,
          /* the mask must actually REACH nothing, not merely be some gradient:
             the old test matched the substring "gradient", which is equally
             true of a mask that ends on a hard edge pointing the wrong way */
          glassFades: /transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/
            .test(glass.maskImage || glass.webkitMaskImage || ''),
          barAtTop: headBox.top <= 0.5,
          behindBar: bodyTop <= headBox.top + 0.5,
          extraScrollers: extra,
          /* resting content must clear the glass's REAL reach, not --band's */
          clearAtRest: first ? first.top >= glassBottom - 0.5 : true,
          /* EVERY PAGED VIEW GOES BACK: one ‹ on the left, labelled Back, and
             no header ✕. The edge-swipe handler presses this very control, so
             a view wearing a second glyph teaches the wrong exit twice. Asserted
             over every paged view for the same reason the header rules are:
             Impressum and Privacy sat in sheet clothes for months (they are
             Home destinations, fixed 2026-08-22) exactly as Settings did
             before them, and nothing was watching either time. */
          nav: (() => {
            const buttons = head.querySelectorAll('button');
            const icos = head.querySelectorAll('.ico'), ico = icos[0];
            return { n: buttons.length, icons: icos.length,
                     glyph: ico ? ico.textContent.trim() : '',
                     label: ico?.getAttribute('aria-label') ?? '',
                     side: !ico ? 'none' : head.firstElementChild === ico ? 'left'
                         : head.lastElementChild === ico ? 'right' : 'middle',
                     hasX: head.textContent.includes('✕') };
          })() });
        body.scrollTop = 0;
        if (!was) ov.classList.remove('on');
      }
      return rows;
    });
    out['paged ' + label] = paged;
    check(paged.length >= 5, 'the paged views vanished from the page: ' + label, paged.length);
    for (const p of paged) {
      check(!p.err, `${p.id} is not built as a paged view (${p.err}): ` + label, p);
      if (p.err) continue;
      check(p.ovClips && p.bodyScrolls, `${p.id} scrolls its whole self, so its header leaves: ` + label, p);
      check(p.stuck, `THE HEADER SCROLLS AWAY IN ${p.id}: ` + label, p);
      check(p.glass, `${p.id} cuts its content off flat — the bar carries no glass: ` + label, p);
      check(p.glassAtRest === 0, `${p.id} FROSTS ITS BAR AT REST — it must dim the aurora only once scrolled: ` + label, p);
      if (p.scrollable) {
        check(p.glassScrolled > 0, `${p.id} never brings the glass in when scrolled: ` + label, p);
      }
      if (p.travel >= p.ramp) {                  // enough slack to sample a ramp
        check(p.glassPart > 0 && p.glassPart < p.glassScrolled,
          `${p.id}'s glass SNAPS instead of fading in with the scroll: ` + label, p);
        check(p.glassMore > p.glassPart,
          `${p.id}'s glass does not keep coming in as more is scrolled: ` + label, p);
      }
      check(p.glassFades, `${p.id}'s glass ends on a hard edge instead of falling away: ` + label, p);
      check(p.barAtTop, `${p.id}'s bar starts below the screen edge — the glass will read as beginning mid-bar: ` + label, p);
      check(p.behindBar, `CONTENT DOES NOT SCROLL BEHIND THE BAR IN ${p.id}: ` + label, p);
      check(p.clearAtRest, `${p.id} frosts its first card at rest — the glass must cover empty space: ` + label, p);
      check(p.extraScrollers.length === 0,
        `a second page-filling scroller in ${p.id} — the glass cannot reach it: ` + label, p.extraScrollers);
      check(p.nav.n === 1 && p.nav.icons === 1,
        `${p.id} must carry exactly ONE header button: ` + label, p.nav);
      check(p.nav.side === 'left' && p.nav.glyph === '\u2039' && p.nav.label === 'Back',
        `${p.id} does not wear one labelled ‹ Back on the left: ` + label, p.nav);
      check(!p.nav.hasX, `${p.id} still carries a header ✕: ` + label, p.nav);
    }
    await ctx.close();
  }
  console.log(JSON.stringify({ out, problems }, null, 2));
} finally { await browser.close(); }
process.exit(problems.length ? 1 : 0);
