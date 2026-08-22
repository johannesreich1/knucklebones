// THE OFFLINE SHEET HOLDS STILL.
//
// A settings form that reflows while you read it is exhausting, and this one
// did: choosing 2 PLAYERS moved the Game mode and Spell cards 143px because
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
    const ctx = await browser.newContext({ viewport: { width, height } });
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
      const seatNote = $('#duoNote').textContent;
      const seatInsideCard = $('#duoNote').closest('.card')?.id ?? null;
      seg('cpu');
      return { modeSlots, spellSlots, cpu, duo, spill, seatNote, seatInsideCard };
    });
    out[label] = r;

    const swing = (a) => Math.max(...a) - Math.min(...a);
    check(swing(r.modeSlots) === 0, 'the game-mode description slot resizes: ' + label, r.modeSlots);
    check(swing(r.spellSlots) === 0, 'the spell description slot resizes: ' + label, r.spellSlots);
    check(r.cpu.mode === r.duo.mode, 'the Game mode card moves on cpu/duo: ' + label, [r.cpu.mode, r.duo.mode]);
    check(r.cpu.spell === r.duo.spell, 'the Spell card moves on cpu/duo: ' + label, [r.cpu.spell, r.duo.spell]);
    check(r.spill.length === 0, 'a note overflows its reserved lines: ' + label, r.spill);
    // the seating note belongs to the control it describes, not to the footer
    check(r.seatInsideCard === 'seatCard', 'the seating note drifted out of its card: ' + label, r.seatInsideCard);

    /* ---- EVERY titled page is the SAME page ----
       A view with a title and a back button pins its header and scrolls its
       body, so the ‹ never leaves the thumb — and the body's top edge fades
       rather than guillotining what scrolls past it. This was an opt-in class
       that three views (OFFLINE, HOW TO PLAY, SETTINGS) never opted into, so
       their headers scrolled away. Asserted over EVERY .ov.paged found, which
       is what stops the next one from being forgotten. */
    const paged = await page.evaluate(async () => {
      const rows = [];
      for (const ov of document.querySelectorAll('.ov.paged')) {
        const head = ov.querySelector('.shead'), body = ov.querySelector('.pbody');
        if (!head || !body) { rows.push({ id: ov.id, err: !head ? 'no .shead' : 'no .pbody' }); continue; }
        const was = ov.classList.contains('on');
        ov.classList.add('on');
        await new Promise((r) => setTimeout(r, 60));
        const bodyTop = body.getBoundingClientRect().top;
        const first = body.firstElementChild?.getBoundingClientRect();
        const fade = parseFloat(getComputedStyle(ov).getPropertyValue('--band')) || 0;
        const before = head.getBoundingClientRect().y.toFixed(1);
        body.scrollTop = 600;                       // as far as this body goes
        await new Promise((r) => setTimeout(r, 60));
        const after = head.getBoundingClientRect().y.toFixed(1);
        const cs = getComputedStyle(body);
        /* ONE PAGE, ONE SCROLLER. The blur band hangs off the header, so it
           can only cover the page's own top edge — a list that scrolls
           separately would slide rows out from under a band that cannot
           reach them. (The ladder did exactly that as a mask-era scroller.)
           A bounded list inside a card is fine: it sits mid-page and never
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
        const bandCs = getComputedStyle(head, '::after');
        rows.push({ id: ov.id, stuck: before === after, scrolled: body.scrollTop,
          bodyScrolls: cs.overflowY === 'auto' || cs.overflowY === 'scroll',
          ovClips: getComputedStyle(ov).overflow === 'hidden',
          band: /blur/.test(bandCs.backdropFilter || bandCs.webkitBackdropFilter || ''),
          bandH: bandCs.height,
          extraScrollers: extra,
          clearAtRest: first ? first.top - bodyTop >= fade - 0.5 : true });
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
      check(p.band, `${p.id} cuts its content off flat — no blur band under the header: ` + label, p);
      check(p.clearAtRest, `${p.id} blurs its first card at rest — the band must cover empty space: ` + label, p);
      check(p.extraScrollers.length === 0,
        `a second page-filling scroller in ${p.id} — the band cannot reach it: ` + label, p.extraScrollers);
    }
    await ctx.close();
  }
  console.log(JSON.stringify({ out, problems }, null, 2));
} finally { await browser.close(); }
process.exit(problems.length ? 1 : 0);
