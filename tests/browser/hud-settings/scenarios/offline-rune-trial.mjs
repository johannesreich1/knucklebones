const CACHE_KEY = 'knucklebones.runes.v1';
const ACCOUNT = '11111111-2222-4333-8444-555555555555';

async function practiceSnapshot(page) {
  return page.evaluate(() => {
    const state = window.__kb.S;
    const buttons = (selector) => [...document.querySelectorAll(`${selector} button`)].map((button) => ({
      value: button.dataset.v,
      disabled: button.getAttribute('aria-disabled') === 'true',
      nativeDisabled: button.disabled,
      tabIndex: button.tabIndex,
      on: button.classList.contains('on'),
      label: button.getAttribute('aria-label'),
      reason: button.dataset.lockReason ?? '',
    }));
    return {
      playMode: state.mode,
      mode: state.localMode,
      spell: state.spell,
      stored: JSON.parse(JSON.stringify(state.localChoices)),
      modes: buttons('#modePick'),
      runes: buttons('#spellPick'),
      runeOverlay: !document.getElementById('spellPickLock').hidden,
      runeInfo: document.getElementById('spellPickInfo').textContent.trim(),
    };
  });
}

async function runeTrialIconSnapshot(page) {
  return page.$eval('#modePick button[data-v="-2"] svg', (svg) => {
    const border = svg.querySelector('path');
    const dots = [...svg.querySelectorAll('circle')];
    const matrix = border.getScreenCTM();
    const scale = Math.hypot(matrix.a, matrix.b);
    const toScreen = ({ x, y }) => ({
      x: matrix.a * x + matrix.c * y + matrix.e,
      y: matrix.b * x + matrix.d * y + matrix.f,
    });
    const perimeter = border.getTotalLength();
    const edge = Array.from({ length: 4097 }, (_, index) =>
      toScreen(border.getPointAtLength(perimeter * index / 4096)));
    const centers = dots.map((dot) => toScreen({
      x: dot.cx.baseVal.value,
      y: dot.cy.baseVal.value,
    }));
    const halfStroke = parseFloat(getComputedStyle(border).strokeWidth) * scale / 2;
    const paintGaps = dots.map((dot, index) => {
      const centre = centers[index];
      const toBorder = Math.min(...edge.map((point) => Math.hypot(
        centre.x - point.x, centre.y - point.y,
      )));
      return toBorder - halfStroke - dot.r.baseVal.value * scale;
    });
    const borderBox = border.getBBox();
    const borderCentre = toScreen({
      x: borderBox.x + borderBox.width / 2,
      y: borderBox.y + borderBox.height / 2,
    });
    const pipCentre = centers.reduce((sum, point) => ({
      x: sum.x + point.x / centers.length,
      y: sum.y + point.y / centers.length,
    }), { x: 0, y: 0 });
    return {
      size: svg.getBoundingClientRect().width,
      paintGaps,
      centreDelta: Math.hypot(pipCentre.x - borderCentre.x, pipCentre.y - borderCentre.y),
    };
  });
}

export async function runOfflineRuneTrialScenarios({ page, out, check, t }) {
  const storageBefore = await page.evaluate((runeKey) => ({
    stats: localStorage.getItem('knucklebones.v1'),
    runes: localStorage.getItem(runeKey),
  }), CACHE_KEY);
  await page.evaluate((key) => {
    localStorage.removeItem(key);
    localStorage.setItem('knucklebones.v1', JSON.stringify({
      played: true,
      reducedMotion: true,
      mode: 'cpu',
      localChoices: {
        cpu: { localMode: 0, spell: '' },
        duo: { localMode: 0, spell: '' },
      },
    }));
  }, CACHE_KEY);
  await page.reload(); await page.waitForTimeout(400);
  await page.tap('#btnVsCpu'); await page.waitForTimeout(150);
  out.runeLocksEmpty = await practiceSnapshot(page);
  out.runeTrialIcon = await runeTrialIconSnapshot(page);
  const iconGapSpread = Math.max(...out.runeTrialIcon.paintGaps)
    - Math.min(...out.runeTrialIcon.paintGaps);
  check(out.runeTrialIcon.size === 16
      && Math.min(...out.runeTrialIcon.paintGaps) >= 0.7
      && iconGapSpread <= 0.1
      && out.runeTrialIcon.centreDelta <= 0.05,
    'Rune Ritual pips are not evenly inset and centred inside their stone', out.runeTrialIcon);
  const emptyEnabled = out.runeLocksEmpty.runes.filter(({ disabled }) => !disabled).map(({ value }) => value);
  check(String(emptyEnabled) === '' && out.runeLocksEmpty.modes.find(({ value }) => value === '-2')?.disabled,
    'CPU practice without a verified collection did not fail closed to NONE/no Trial', out.runeLocksEmpty);
  const lockedFate = out.runeLocksEmpty.runes.find(({ value }) => value === 'fate');
  const lockedRandom = out.runeLocksEmpty.runes.find(({ value }) => value === 'random');
  check(lockedFate && !lockedFate.nativeDisabled && lockedFate.tabIndex >= 0
      && lockedRandom && !lockedRandom.nativeDisabled && lockedRandom.tabIndex >= 0,
    'locked rune choices are not focusable explanation controls', out.runeLocksEmpty);
  /* Playwright treats aria-disabled as an actionability veto even though the
     native button deliberately remains enabled so a real tap can explain the
     lock. Force only bypasses that semantic pre-check; the touch still lands
     on the rendered control and exercises the delegated tap handler. */
  await page.tap('#spellPick button[data-v="fate"]', { force: true });
  out.namedLockReason = await practiceSnapshot(page);
  check(out.namedLockReason.spell === ''
      && out.namedLockReason.runeInfo === t('game', 'runeTrial.lockReachIvory'),
    'tapping a locked named rune changed selection or hid its reason', out.namedLockReason);
  await page.tap('#spellPick button[data-v="random"]', { force: true });
  out.randomLockReason = await practiceSnapshot(page);
  check(out.randomLockReason.spell === ''
      && out.randomLockReason.runeInfo === t('game', 'runeTrial.lockCollectTwo'),
    'RANDOM did not consistently explain its two-collected-rune requirement', out.randomLockReason);
  out.lockTreatment = await page.$eval('#spellPick button[data-v="fate"]', (button) => ({
    opacity: getComputedStyle(button).opacity,
    lockBody: getComputedStyle(button, '::after').content,
    lockShackle: getComputedStyle(button, '::before').content,
  }));
  check(Number(out.lockTreatment.opacity) < 1
      && out.lockTreatment.lockBody !== 'none' && out.lockTreatment.lockBody !== 'normal'
      && out.lockTreatment.lockShackle !== 'none' && out.lockTreatment.lockShackle !== 'normal',
    'locked choices rely on hue alone instead of a visible lock treatment', out.lockTreatment);

  /* Startup account reconciliation deliberately clears an orphaned cache.
     Install this verified snapshot after that asynchronous boot check, then
     enter practice exactly as an offline player with a retained account does. */
  await page.reload(); await page.waitForTimeout(400);
  await page.evaluate(([key, account]) => {
    localStorage.setItem(key, JSON.stringify({
      version: 1,
      accountId: account,
      verifiedAt: 123,
      collected: ['fate', 'nudge', 'ward'],
      poolTier: 'ivory',
    }));
  }, [CACHE_KEY, ACCOUNT]);
  await page.tap('#btnVsCpu'); await page.waitForTimeout(150);
  out.runeLocksCollected = await practiceSnapshot(page);
  const cpuEnabled = new Set(out.runeLocksCollected.runes.filter(({ disabled }) => !disabled)
    .map(({ value }) => value));
  check(['', 'fate', 'nudge', 'ward', 'random', 'random2'].every((id) => cpuEnabled.has(id))
      && ['sunder', 'pilfer', 'anvil'].every((id) => !cpuEnabled.has(id))
      && !out.runeLocksCollected.modes.find(({ value }) => value === '-2')?.disabled,
    'CPU collection filtering/random thresholds are wrong', out.runeLocksCollected);

  await page.tap('#spellPick button[data-v="fate"]');
  await page.tap('#modePick button[data-v="0"]');
  await page.tap('#modeSeg button[data-m="duo"]');
  out.duoRunesUnlocked = await practiceSnapshot(page);
  check(out.duoRunesUnlocked.runes.every(({ disabled }) => !disabled)
      && !out.duoRunesUnlocked.runeOverlay
      && out.duoRunesUnlocked.modes.every(({ disabled }) => !disabled),
    'local multiplayer did not expose every rune and mode independent of collection',
    out.duoRunesUnlocked);
  await page.tap('#spellPick button[data-v="pilfer"]');
  await page.tap('#modePick button[data-v="-2"]');
  out.duoSetup = await practiceSnapshot(page);
  check(out.duoSetup.runes.every(({ disabled }) => disabled)
      && out.duoSetup.runeOverlay && out.duoSetup.spell === 'pilfer'
      && out.duoSetup.modes.every(({ disabled }) => !disabled),
    'manual duo Trial did not preserve and cover the unrestricted rune picker', out.duoSetup);
  await page.tap('#modeSeg button[data-m="cpu"]');
  out.cpuRestored = await practiceSnapshot(page);
  await page.tap('#modeSeg button[data-m="duo"]');
  out.duoRestored = await practiceSnapshot(page);
  check(out.cpuRestored.mode === 0 && out.cpuRestored.spell === 'fate'
      && out.duoRestored.mode === -2 && out.duoRestored.spell === 'pilfer',
    'CPU and duo setup selections overwrote one another', {
      cpu: out.cpuRestored, duo: out.duoRestored,
    });

  await page.tap('#seatSeg button[data-seat="face"]');
  await page.tap('#timerSeg button[data-t="0"]');
  await page.tap('#btnPlay');
  await page.waitForSelector('#ovTrialSelect.on.handoff');
  await page.tap('#trialSelectReady');
  await page.waitForSelector('#ovTrialSelect.on:not(.handoff) #trialSelectCards button');
  const first = await page.getAttribute('#trialSelectCards button', 'data-rune');
  await page.tap(`#trialSelectCards button[data-rune="${first}"]`);
  await page.waitForSelector('#ovTrialSelect.on.handoff');
  await page.tap('#trialSelectReady');
  await page.waitForSelector('#ovTrialSelect.on:not(.handoff) #trialSelectCards button');
  await page.tap(`#trialSelectCards button[data-rune="${first}"]`);
  await page.waitForFunction(() => document.getElementById('ovWheel')?.classList.contains('holding'));
  await page.tap('#ovWheel');
  await page.waitForFunction(() => !!window.__kb.S.localTrial && window.__kb.S.phase !== 'menu');
  out.localTrial = await page.evaluate(() => ({
    trial: JSON.parse(JSON.stringify(window.__kb.S.localTrial)),
    scoring: window.__kb.S.scoring,
    savedSpell: window.__kb.S.spell,
    badge: document.querySelector('#rec [data-id="rune_trial"]')?.textContent?.trim() ?? '',
  }));
  check(out.localTrial.trial.offer.length === 3
      && new Set(out.localTrial.trial.offer).size === 3
      && out.localTrial.trial.spells[0] === first && out.localTrial.trial.spells[1] === first
      && out.localTrial.scoring === 0 && out.localTrial.savedSpell === 'pilfer'
      && out.localTrial.badge.includes(t('game', 'modes.runeTrial.compact')),
    'local Trial did not keep a private same-offer choice on Classic rules', out.localTrial);

  await page.tap('#btnLeave'); await page.waitForSelector('#ovAsk.on');
  await page.tap('#btnAskAlt'); await page.waitForTimeout(100);
  out.trialRestart = await page.evaluate(() => ({
    trial: JSON.parse(JSON.stringify(window.__kb.S.localTrial)),
    hands: window.__kb.S.spellCharges.map((hand) => Object.keys(hand)),
  }));
  check(JSON.stringify(out.trialRestart.trial) === JSON.stringify(out.localTrial.trial)
      && out.trialRestart.hands[0][0] === first && out.trialRestart.hands[1][0] === first,
    'Restart redrew the Trial offer or resolved choices', out.trialRestart);

  await page.tap('#btnLeave'); await page.waitForSelector('#ovAsk.on');
  await page.tap('#btnAskYes'); await page.waitForSelector('#ovStart.on');
  out.tryoutBefore = await page.evaluate(() => {
    const S = window.__kb.S;
    const setup = { mode: S.mode, diff: S.diff, localMode: S.localMode, spell: S.spell, starter: S.starter };
    const stats = [S.wins, S.losses, S.draws, S.p1, S.p2, S.ties, S.best, S.played];
    window.__tryoutBack = false;
    return { setup, stats, started: window.__kb.startRuneTryout('ward', () => {
      window.__tryoutBack = true;
      window.__kb.goHome();
    }) };
  });
  await page.waitForTimeout(100);
  out.tryoutStarted = await page.evaluate(() => ({
    mode: window.__kb.S.mode,
    diff: window.__kb.S.diff,
    scoring: window.__kb.S.scoring,
    hands: window.__kb.S.spellCharges.map((hand) => Object.keys(hand)),
  }));
  check(out.tryoutBefore.started && out.tryoutStarted.mode === 'cpu' && out.tryoutStarted.diff === 'medium'
      && out.tryoutStarted.scoring === 0
      && out.tryoutStarted.hands.every((hand) => hand[0] === 'ward'),
    'TRY IT did not start a fresh Classic/Normal symmetric-rune AI duel', out.tryoutStarted);

  await page.evaluate(async () => {
    const k = window.__kb;
    k.S.gen++;
    k.S.boards[1] = [[6, 6, 6], [6, 6, 6], [6, 6]];
    k.S.boards[0] = [[1], [1], [1]];
    k.S.turn = 1; k.S.bottom = 1; k.S.phase = 'choose'; k.S.busy = false; k.S.die = 6;
    k.renderAll(false); k.applySides(); k.setStageDie(6, 1);
    await k.place(1, 2);
  });
  await page.waitForSelector('#ovEnd.on');
  out.tryoutResult = await page.evaluate(() => ({
    action: document.getElementById('btnAgain').textContent.trim(),
    quietHidden: document.getElementById('btnEndQuiet').hidden,
    stats: [
      window.__kb.S.wins, window.__kb.S.losses, window.__kb.S.draws,
      window.__kb.S.p1, window.__kb.S.p2, window.__kb.S.ties,
      window.__kb.S.best, window.__kb.S.played,
    ],
  }));
  check(out.tryoutResult.action === t('game', 'action.backToRanked') && out.tryoutResult.quietHidden
      && JSON.stringify(out.tryoutResult.stats) === JSON.stringify(out.tryoutBefore.stats),
    'TRY IT wrote local records or exposed the ordinary rematch/setup exits', out.tryoutResult);
  await page.tap('#btnAgain'); await page.waitForTimeout(100);
  out.tryoutBack = await page.evaluate(() => ({
    callback: window.__tryoutBack,
    setup: {
      mode: window.__kb.S.mode,
      diff: window.__kb.S.diff,
      localMode: window.__kb.S.localMode,
      spell: window.__kb.S.spell,
      starter: window.__kb.S.starter,
    },
  }));
  check(out.tryoutBack.callback
      && JSON.stringify(out.tryoutBack.setup) === JSON.stringify(out.tryoutBefore.setup),
    'BACK TO RANKED did not restore the borrowed local setup', out.tryoutBack);
  await page.evaluate(([cacheKey, before]) => {
    if (before.stats === null) localStorage.removeItem('knucklebones.v1');
    else localStorage.setItem('knucklebones.v1', before.stats);
    if (before.runes === null) localStorage.removeItem(cacheKey);
    else localStorage.setItem(cacheKey, before.runes);
  }, [CACHE_KEY, storageBefore]);
  await page.reload();
  await page.waitForTimeout(500);
}
