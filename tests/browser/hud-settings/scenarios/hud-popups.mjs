export async function runHudPopupScenarios(suite) {
  const { page, out, check } = suite;
  // start collecting every score popup as it appears
  await page.evaluate(() => {
    window.__pops = [];
    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList && n.classList.contains('pts')) {
          window.__pops.push({ text: n.textContent, board: n.closest('#topBoard') ? 'top' : 'bot' });
        }
      }
    }).observe(document.getElementById('tableEl'), { childList: true, subtree: true });
  });

  // ===== hud shape: no wordmark in-game, exactly settings + menu =====
  out.hud = await page.evaluate(() => ({
    brand: !!document.querySelector('.hud .brand'),
    icons: [...document.querySelectorAll('.hud .ico')].map(b => b.id),
    titleStillNamed: document.querySelector('#ovStart h1').textContent === 'KNUCKLEBONES',
  }));
  check(!out.hud.brand, 'wordmark still in the in-game hud', out.hud);
  check(out.hud.icons.join(',') === 'btnLeave', 'hud must hold ONLY the way out', out.hud);
  check(out.hud.titleStillNamed, 'title screen lost the name', out.hud);

  // ===== popups, deterministically via the tutorial (home strip button) =====
  // the tutorial now lives one level in, behind HOW TO PLAY
  await page.tap('#btnLearn'); await page.waitForTimeout(320);
  await page.tap('#btnLearnTut'); await page.waitForTimeout(500);
  await page.tap('#coach');
  async function waitChoose(maxMs = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const s = await page.evaluate(() => window.__kb.S.phase);
      if (s === 'choose' || s === 'over') return s;
      await page.waitForTimeout(100);
    }
    return 'timeout';
  }
  await waitChoose();
  await page.tap('#botBoard .col[data-col="0"]');   // first 4 → +4
  await waitChoose();
  await page.tap('#botBoard .col[data-col="0"]');   // second 4 → +12 (16-4), gold
  await waitChoose();
  await page.tap('#botBoard .col[data-col="1"]');   // 5 smashes CPU's 5 → +5 and −5
  await page.waitForTimeout(1500);
  out.pops = await page.evaluate(() => window.__pops);
  const texts = out.pops.map(p => p.text + '@' + p.board);
  check(texts.includes('+4@bot'), 'no +4 popup on first placement', texts);
  check(texts.includes('+12@bot'), 'multiplier popup not +12', texts);
  check(texts.includes('+5@bot'), 'no +5 popup on destruction turn', texts);
  check(texts.includes('−5@top'), 'no −5 popup on the destroyed column', texts);
  // CPU placements pop too
  check(out.pops.some(p => p.board === 'top' && p.text.startsWith('+')), 'CPU placements never pop', texts);
  // popups clean themselves up — wait until the game is idle so nothing is mid-flight
  await waitChoose();
  await page.waitForTimeout(1300);
  out.leftover = await page.evaluate(() => document.querySelectorAll('.pts').length);
  check(out.leftover === 0, 'popups leak into the DOM', out.leftover);

  // quit tutorial (via Settings — the sheet holds the quit button now),
  // popups must also fire in a NORMAL game (they are not tutorial-only)
  await page.tap('#btnLeave'); await page.waitForTimeout(300);
  await page.tap('#btnAskYes'); await page.waitForTimeout(400);
  await page.evaluate(() => { window.__pops = []; });
  await page.evaluate(() => window.__kb.openPractice());  // local controls live in the Practice overlay now
  await page.tap('#btnPlay'); await page.waitForTimeout(1500);
  if (await waitChoose() === 'choose') {
    const lg = await page.evaluate(() => window.__kb.S.boards[1].map((c, j) => c.length < 3 ? j : -1).filter(j => j >= 0));
    await page.tap(`#botBoard .col[data-col="${lg[0]}"]`);
    await page.waitForTimeout(1000);
  }
  out.normalPops = await page.evaluate(() => window.__pops.filter(p => p.board === 'bot').length);
  check(out.normalPops >= 1, 'no score popup in normal play', out.normalPops);
  // while strategy previews stay off
  out.normalPills = await page.evaluate(() => document.querySelectorAll('.chip .dl.show').length);
  check(out.normalPills === 0, 'previews leaked back into normal play', out.normalPills);

}
