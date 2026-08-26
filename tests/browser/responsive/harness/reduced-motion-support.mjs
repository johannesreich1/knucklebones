export async function beginReducedRollProbe(page) {
  await page.evaluate(() => {
    const stage = document.getElementById('dieStage');
    const values = [];
    const capture = () => {
      const value = Number(stage.querySelector(':scope > .die')?.dataset.v ?? 0);
      if (value > 0 && values.at(-1) !== value) values.push(value);
    };
    const observer = new MutationObserver(capture);
    observer.observe(stage, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-v'] });
    window.__kbReducedRollProbe = { values, observer };
  });
  return Date.now();
}

export async function readReducedRollProbe(page, started) {
  return page.evaluate((start) => ({
    elapsed: Date.now() - start,
    phase: window.__kb.S.phase,
    value: Number(document.querySelector('#dieStage > .die')?.dataset.v ?? 0),
    rolling: document.getElementById('dieStage').classList.contains('rolling'),
    activeAnimations: document.getElementById('dieStage').getAnimations({ subtree: true })
      .filter((animation) => animation.playState === 'running').length,
    values: (() => {
      const probe = window.__kbReducedRollProbe;
      probe?.observer.disconnect();
      return [...(probe?.values ?? [])];
    })(),
  }), started);
}

export async function reloadReducedMotionWithKeeper(context, page, url) {
  const keeper = await context.newPage();
  try {
    await keeper.goto(url);
    await keeper.evaluate(() => localStorage.length);
    await page.reload();
    await page.waitForFunction(() => window.__kb?.S?.reducedMotion === true
      && window.__kb.reduced
      && document.getElementById('kbroot').classList.contains('reduce-motion'),
    null, { timeout: 8000 }).catch(() => { /* the caller's check names the failure */ });
    return page.evaluate(() => ({
      state: window.__kb.S.reducedMotion,
      jsFlag: window.__kb.reduced,
      rootClass: document.getElementById('kbroot').classList.contains('reduce-motion'),
      raw: localStorage.getItem('knucklebones.v1'),
    }));
  } finally {
    await keeper.close();
  }
}
