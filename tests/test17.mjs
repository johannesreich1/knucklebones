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
        const fade = parseFloat(getComputedStyle(ov).getPropertyValue('--fade-top')) || 0;
        const before = head.getBoundingClientRect().y.toFixed(1);
        body.scrollTop = 600;                       // as far as this body goes
        await new Promise((r) => setTimeout(r, 60));
        const after = head.getBoundingClientRect().y.toFixed(1);
        const cs = getComputedStyle(body);
        /* EVERY scroller inside a titled page fades, not just the body: the
           ladder and the account panel scroll themselves, and a fade that
           only knew about .pbody left them cut off flat (user report). */
        const bare = [];
        for (const el of ov.querySelectorAll('*')) {
          const s = getComputedStyle(el);
          if (!/auto|scroll/.test(s.overflowY) && !/auto|scroll/.test(s.overflow)) continue;
          if (!/gradient/.test(s.maskImage || s.webkitMaskImage || '')) {
            bare.push(el.id || el.className || el.tagName);
          }
        }
        rows.push({ id: ov.id, stuck: before === after, scrolled: body.scrollTop,
          bodyScrolls: cs.overflowY === 'auto' || cs.overflowY === 'scroll',
          ovClips: getComputedStyle(ov).overflow === 'hidden',
          faded: /gradient/.test(cs.maskImage || cs.webkitMaskImage || ''),
          bareScrollers: bare,
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
      check(p.faded, `${p.id} cuts its content off flat instead of fading it: ` + label, p);
      check(p.clearAtRest, `${p.id} dims its first card at rest — the fade must cover empty space: ` + label, p);
      check(p.bareScrollers.length === 0,
        `a scroller inside ${p.id} cuts its content off flat: ` + label, p.bareScrollers);
    }
    await ctx.close();
  }
  console.log(JSON.stringify({ out, problems }, null, 2));
} finally { await browser.close(); }
process.exit(problems.length ? 1 : 0);
