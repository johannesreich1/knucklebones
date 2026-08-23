import { shot } from '../../../shot.mjs';

export async function runInputAccessibilityScenarios(suite) {
  const { browser, devices, F, errs, out, check, markExperienced } = suite;
  // ================= RESUME =================
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
  await markExperienced(ctx);   // an experienced player: the first-run tutorial offer is test19's subject
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('RESUME: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await p.goto(F); await p.waitForTimeout(400);
  await p.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
  await p.tap('#btnPlay'); await p.waitForTimeout(2000);
  for (let i = 0; i < 3; i++) {
    const s = await p.evaluate(() => ({ ph: window.__kb.S.phase, t: window.__kb.S.turn, b: window.__kb.S.boards[1] }));
    if (s.ph === 'choose' && s.t === 1) {
      const lg = s.b.map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0);
      await p.tap(`#botBoard .col[data-col="${lg[0]}"]`);
    }
    await p.waitForTimeout(1500);
  }
  // ================= PLACE ON RELEASE =================
  const g = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
  await markExperienced(g);   // an experienced player: the first-run tutorial offer is test19's subject
  // Paint a real cached profile avatar on Home without pulling the online
  // chunk into this offline presentation suite.
  await g.addInitScript(() => localStorage.setItem('knucklebones.online.profile', JSON.stringify({
    nickname: 'PipKeeper', avatar: 'die:4:gold', rating: 1234,
  })));
  const gp = await g.newPage();
  gp.on('pageerror', e => errs.push('INPUT: ' + e.message));
  await gp.goto(F); await gp.waitForTimeout(400);
  // numerals is a HOME setting now — the in-game gear became the quit modal (test11)
  await gp.tap('#btnSettingsHome'); await gp.waitForTimeout(400);
  await gp.tap('#faceSeg button[data-f="nums"]'); await gp.waitForTimeout(250);
  await gp.tap('#btnSettingsBack'); await gp.waitForTimeout(400);
  const settingsClosed = await gp.evaluate(() => !document.getElementById('ovSettings').classList.contains('on'));
  // Numbers are a live-duel presentation, not a global rewrite of the die as
  // a brand/profile component. Read the visible pixels on Home before play.
  out.fixedPipFaces = await gp.evaluate(() => {
    const read = (selector) => [...document.querySelectorAll(selector)].map((die) => {
      const pip = die.querySelector('.pip.on');
      const rect = pip?.getBoundingClientRect();
      return {
        value: Number(die.dataset.v),
        pipDisplay: pip ? getComputedStyle(pip).display : null,
        pipOpacity: pip ? +getComputedStyle(pip).opacity : 0,
        pipWidth: rect?.width ?? 0,
        numDisplay: getComputedStyle(die.querySelector('.num')).display,
      };
    });
    return {
      numerals: document.getElementById('kbroot').classList.contains('numerals'),
      logo: read('#homeDuel .die'),
      profile: read('#homeChip .pav .die'),
    };
  });
  const fixedPipsVisible = (faces) => faces.every((face) =>
    face.pipDisplay !== 'none' && face.pipOpacity > .9 && face.pipWidth > 0 && face.numDisplay === 'none');
  check(out.fixedPipFaces.numerals
        && out.fixedPipFaces.logo.map((face) => face.value).join(',') === '5,3'
        && out.fixedPipFaces.profile.map((face) => face.value).join(',') === '4'
        && fixedPipsVisible(out.fixedPipFaces.logo)
        && fixedPipsVisible(out.fixedPipFaces.profile),
        'the in-game numeral setting rewrote a Home logo/profile die', out.fixedPipFaces);
  await gp.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
  await gp.tap('#btnPlay'); await gp.waitForTimeout(2200);
  for (let i = 0; i < 40; i++) {
    const s = await gp.evaluate(() => ({ ph: window.__kb.S.phase, t: window.__kb.S.turn }));
    if (s.ph === 'choose' && s.t === 1) break;
    await gp.waitForTimeout(150);
  }
  const n0 = await gp.evaluate(() => window.__kb.S.boards[1].flat().length);
  // press on column 0, slide onto the HUD, release: must NOT place
  const box0 = await gp.locator('#botBoard .col[data-col="0"]').boundingBox();
  const away = await gp.locator('.hud').boundingBox();
  await gp.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
  await gp.mouse.down();
  await gp.waitForTimeout(80);
  await gp.mouse.move(away.x + away.width / 2, away.y + away.height / 2, { steps: 6 });
  await gp.mouse.up();
  await gp.waitForTimeout(700);
  const nCancel = await gp.evaluate(() => window.__kb.S.boards[1].flat().length);
  check(nCancel === n0, 'sliding off the column still placed a die', { n0, nCancel });
  // now a clean press+release on the same column: must place exactly one
  await gp.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
  await gp.mouse.down(); await gp.waitForTimeout(60); await gp.mouse.up();
  await gp.waitForTimeout(1200);
  const nPlaced = await gp.evaluate(() => window.__kb.S.boards[1].flat().length);
  check(nPlaced === n0 + 1, 'clean press did not place exactly one die', { n0, nCancel, nPlaced });
  out.input = { n0, nCancel, nPlaced };

  // ================= ACCESSIBILITY =================
  out.a11y = await gp.evaluate(() => ({
    colLabels: [...document.querySelectorAll('.col')].map(c => c.getAttribute('aria-label')).filter(Boolean).length,
    sampleCol: document.querySelector('#botBoard .col').getAttribute('aria-label'),
    diceLabelled: [...document.querySelectorAll('.board .die')].every(d => d.getAttribute('aria-label')),
    sampleDie: document.querySelector('.board .die') ? document.querySelector('.board .die').getAttribute('aria-label') : null,
    statusLive: document.getElementById('status').getAttribute('aria-live'),
    buttonsLabelled: [...document.querySelectorAll('.ico')].every(b => b.getAttribute('aria-label')),
  }));
  check(out.a11y.colLabels === 6, 'columns not all labelled', out.a11y);
  check(out.a11y.diceLabelled, 'dice missing labels', out.a11y);
  check(out.a11y.statusLive === 'polite', 'status not a live region', out.a11y);
  check(out.a11y.buttonsLabelled, 'icon buttons unlabelled', out.a11y);

  // numerals: toggled from home before the game — here we check the board obeys
  out.numerals = await gp.evaluate(() => {
    const d = document.querySelector('.board .die');
    return { on: document.getElementById('kbroot').classList.contains('numerals'),
             numShown: d ? getComputedStyle(d.querySelector('.num')).display : null,
             pipHidden: d ? getComputedStyle(d.querySelector('.pip')).display : null };
  });
  out.numerals.settingsClosed = settingsClosed;
  check(out.numerals.on && out.numerals.numShown === 'flex' && out.numerals.pipHidden === 'none' && out.numerals.settingsClosed, 'numerals toggle broken', out.numerals);
  // the LOADING die is exempt: it tells time in pips whatever the face setting
  // says. Keep the computed-paint guard beside the other fixed pip surfaces.
  out.loaderNumerals = await gp.evaluate(() => {
    const d = window.__kb.loaderDie(24);
    window.__ldprobe = d;
    // loaderDie returns a component; every application component is mounted
    // below the canonical root, including this focused probe.
    document.getElementById('kbroot').appendChild(d);
    const pip = d.querySelector('.pip');
    return { pipDisplay: getComputedStyle(pip).display, pipOpacity: +getComputedStyle(pip).opacity,
             pipWidth: pip.getBoundingClientRect().width,
             numDisplay: getComputedStyle(d.querySelector('.num')).display,
             // read at insertion: the grace (ldreveal) must be holding it invisible
             graceOpacity: +getComputedStyle(d).opacity };
  });
  // past the grace and the fade (200ms + 250ms), a real wait must be fully lit
  await gp.waitForTimeout(700);
  out.loaderNumerals.shownOpacity = await gp.evaluate(() => {
    const o = +getComputedStyle(window.__ldprobe).opacity;
    window.__ldprobe.remove(); delete window.__ldprobe;
    return o;
  });
  check(out.loaderNumerals.pipDisplay !== 'none' && out.loaderNumerals.pipOpacity > 0.1
        && out.loaderNumerals.pipWidth > 0 && out.loaderNumerals.numDisplay === 'none',
        'the loading die obeys the numerals setting', out.loaderNumerals);
  check(out.loaderNumerals.graceOpacity < 0.05 && out.loaderNumerals.shownOpacity > 0.95,
        'the loader grace is broken: it must be invisible at insertion and lit after it', out.loaderNumerals);
  await shot(gp, 'v2-numerals');

}
