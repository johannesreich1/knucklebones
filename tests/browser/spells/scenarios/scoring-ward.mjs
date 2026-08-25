/* Scoring-WARD crosses three visible owners at once: the running-score plate,
   hostile PILFER presentation, and COLUMN SHIELD's permanent guard. These
   scenarios pin the composed player-facing result rather than repeating the
   pure arithmetic already covered by spells.test.ts. */
export async function runScoringWardScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, guard, sidePage } = suite;

  /* A dealt WARD and BOUNTY reserve opposite sides of the running total. The
     far player reads a physically mirrored stack, while both totals continue
     to belong to the player identity mapped into that half. */
  await newGame({ spell: 'ward', mode: 5 });
  check(await waitChoose(), 'game never reached choose (scoring-WARD HUD)');
  await table([[1, 6], [2, 2], []], [[3, 5], [4, 4], []], 6);
  out.scoringWardHud = await page.evaluate(async () => {
    const k = window.__kb;
    k.S.spellCharges = [{ ward: 0 }, { ward: 0 }];
    k.S.charm.wards = [[0, 0, 0], [0, 0, 0]];
    k.S.bounty = [0, 0];
    k.renderAll(false); k.spells.render();
    await new Promise((resolve) => setTimeout(resolve, 420));

    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height,
        cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
    };
    const geometry = () => ({
      topCluster: rect('#plateTop .pright'), botCluster: rect('#plateBot .pright'),
      topTotal: rect('#totTop'), botTotal: rect('#totBot'), rail: rect('#spellBar'),
    });
    const reading = () => {
      const wardTop = document.getElementById('wptTop');
      const wardBot = document.getElementById('wptBot');
      const bountyTop = document.getElementById('btyTop');
      const bountyBot = document.getElementById('btyBot');
      return {
        top: {
          ward: wardTop.querySelector('b')?.textContent,
          total: document.getElementById('totTop').textContent,
          bounty: bountyTop.textContent,
          wardVisibility: getComputedStyle(wardTop).visibility,
          bountyVisibility: getComputedStyle(bountyTop).visibility,
          wardY: rect('#wptTop').cy, totalY: rect('#totTop').cy, bountyY: rect('#btyTop').cy,
        },
        bot: {
          ward: wardBot.querySelector('b')?.textContent,
          total: document.getElementById('totBot').textContent,
          bounty: bountyBot.textContent,
          wardVisibility: getComputedStyle(wardBot).visibility,
          bountyVisibility: getComputedStyle(bountyBot).visibility,
          wardY: rect('#wptBot').cy, totalY: rect('#totBot').cy, bountyY: rect('#btyBot').cy,
        },
      };
    };

    const baseline = { geometry: geometry(), reading: reading() };
    k.S.charm.wards = [[1, 0, 0], [1, 0, 0]];
    k.S.bounty = [2, 3];
    k.renderAll(false); k.spells.render();
    // Running totals celebrate for 190ms; sample the settled layout, not its
    // intentional scale beat.
    await new Promise((resolve) => setTimeout(resolve, 420));
    const active = { geometry: geometry(), reading: reading() };

    k.S.charm.wards = [[0, 0, 0], [0, 0, 0]];
    k.S.bounty = [0, 0];
    k.renderAll(false); k.spells.render();
    await new Promise((resolve) => setTimeout(resolve, 420));
    const returned = { geometry: geometry(), reading: reading() };
    return { baseline, active, returned };
  });
  const hud = out.scoringWardHud;
  check(hud.active.reading.bot.ward === '+7' && hud.active.reading.bot.bounty === '✦3'
      && hud.active.reading.bot.total === '25'
      && hud.active.reading.top.ward === '+8' && hud.active.reading.top.bounty === '✦2'
      && hud.active.reading.top.total === '34',
    'the running total does not include the WARD bonus and BOUNTY for its mapped player', hud.active.reading);
  check(hud.active.reading.bot.wardVisibility === 'visible'
      && hud.active.reading.bot.bountyVisibility === 'visible'
      && hud.active.reading.bot.wardY < hud.active.reading.bot.totalY
      && hud.active.reading.bot.totalY < hud.active.reading.bot.bountyY,
    'the near score does not place WARD above and BOUNTY below its total', hud.active.reading.bot);
  check(hud.active.reading.top.wardVisibility === 'visible'
      && hud.active.reading.top.bountyVisibility === 'visible'
      && hud.active.reading.top.bountyY < hud.active.reading.top.totalY
      && hud.active.reading.top.totalY < hud.active.reading.top.wardY,
    'the far score is not the physical mirror of the near WARD/total/BOUNTY stack', hud.active.reading.top);
  const geometryDelta = (left, right) => Math.max(...Object.keys(left).flatMap((key) =>
    ['x', 'y', 'width', 'height'].map((field) => Math.abs(left[key][field] - right[key][field]))));
  check(geometryDelta(hud.baseline.geometry, hud.active.geometry) <= .75
      && geometryDelta(hud.baseline.geometry, hud.returned.geometry) <= .75,
    'WARD or BOUNTY moved the score cluster/card rail when its value appeared or disappeared', hud);

  /* A full receiving column is an important policy edge: WARD answers PILFER
     before it asks for a destination. The enemy die may strain against the
     clasp, but neither board transfers a die and PI5 must never construct its
     crossing ghost or empty-room cue. */
  await newGame({ spell: 'pilfer' });
  check(await waitChoose(), 'game never reached choose (WARD answers PILFER)');
  await table([[6, 5, 4], [], []], [[1, 2, 3], [], []], 4);
  await page.evaluate(() => {
    const k = window.__kb;
    k.S.spellCharges = [{ ward: 0 }, { pilfer: 1 }];
    k.S.charm.wards = [[1, 0, 0], [0, 0, 0]];
    k.renderAll(false); k.spells.render();
  });
  out.wardPilfer = await page.evaluate(async () => {
    const k = window.__kb;
    const before = {
      boards: JSON.stringify(k.S.boards),
      ward: k.S.charm.wards[0][0],
      score: document.getElementById('totTop').textContent,
      bonus: document.querySelector('#wptTop b')?.textContent,
    };
    let sawGhost = false, sawRoom = false, sawSnap = false, sawChallenge = false;
    let boardsChanged = false, finished = false;
    const sample = () => {
      sawGhost ||= !!document.querySelector('.pilfer-ghost');
      sawRoom ||= !!document.querySelector('.pilfer-room');
      sawSnap ||= !!document.querySelector('.sealsnap');
      sawChallenge ||= !!document.querySelector('.pilfer-ward-challenge');
      boardsChanged ||= JSON.stringify(k.S.boards) !== before.boards;
    };
    const observer = new MutationObserver(sample);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class'] });
    const cast = Promise.resolve(k.spells.cast('pilfer', 0));
    cast.finally(() => { finished = true; });
    for (let tick = 0; tick < 240 && !finished; tick++) {
      sample(); await new Promise((resolve) => setTimeout(resolve, 8));
    }
    const result = await cast;
    sample(); observer.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 240));
    const ward = document.getElementById('wptTop');
    return {
      before, result, sawGhost, sawRoom, sawSnap, sawChallenge, boardsChanged,
      boards: JSON.stringify(k.S.boards), wards: JSON.stringify(k.S.charm.wards),
      charges: JSON.stringify(k.S.spellCharges), score: document.getElementById('totTop').textContent,
      bonus: ward.querySelector('b')?.textContent, bonusVisibility: getComputedStyle(ward).visibility,
      warded: document.querySelector('#topBoard .col[data-col="0"]').classList.contains('warded'),
      challenge: document.querySelectorAll('.pilfer-ward-challenge').length,
      hiddenDice: [...document.querySelectorAll('#topBoard .die,#botBoard .die')]
        .filter((die) => getComputedStyle(die).visibility === 'hidden').length,
    };
  });
  const pilfer = out.wardPilfer;
  check(pilfer.before.boards === '[[[1,2,3],[],[]],[[6,5,4],[],[]]]'
      && pilfer.boards === pilfer.before.boards && !pilfer.boardsChanged,
    'WARD-intercepted PILFER transferred a die despite the full receiver', pilfer);
  check(!pilfer.sawGhost && !pilfer.sawRoom,
    'WARD-intercepted PILFER emitted PI5 crossing/destination language', pilfer);
  check(pilfer.sawSnap && pilfer.sawChallenge && pilfer.wards === '[[0,0,0],[0,0,0]]'
      && !pilfer.warded && pilfer.challenge === 0 && pilfer.hiddenDice === 0,
    'PILFER did not visibly break WARD or clean its challenge state', pilfer);
  check(pilfer.before.score === '12' && pilfer.before.bonus === '+6'
      && pilfer.score === '6' && pilfer.bonus === '+0' && pilfer.bonusVisibility === 'hidden',
    'PILFER broke WARD without removing its points from the current score', pilfer);

  const reduced = await sidePage({
    name: 'scoring-WARD PILFER reduced motion', w: 390, h: 844,
    opts: { reducedMotion: 'reduce' },
  });
  try {
    await newGame({ spell: 'pilfer' }, reduced.page);
    check(await waitChoose(reduced.page), 'game never reached choose (WARD/PILFER reduced)');
    await table([[6, 5, 4], [], []], [[1, 2, 3], [], []], 4, reduced.page);
    out.wardPilferReduced = await reduced.page.evaluate(async () => {
      const k = window.__kb;
      k.S.spellCharges = [{ ward: 0 }, { pilfer: 1 }];
      k.S.charm.wards = [[1, 0, 0], [0, 0, 0]];
      k.renderAll(false); k.spells.render();
      const before = JSON.stringify(k.S.boards);
      await k.spells.cast('pilfer', 0);
      await new Promise((resolve) => setTimeout(resolve, 90));
      const ward = document.getElementById('wptTop');
      return {
        reduced: k.reduced, before, after: JSON.stringify(k.S.boards),
        wards: JSON.stringify(k.S.charm.wards), score: document.getElementById('totTop').textContent,
        bonus: ward.querySelector('b')?.textContent, bonusVisibility: getComputedStyle(ward).visibility,
        transients: document.querySelectorAll(
          '.pilferpreview,.pilfer-ghost,.pilfer-straining,.pilfer-blocker,'
          + '.pilfer-soft-settle,.pilfer-room,.pilfer-ward-challenge,.sealsnap').length,
        hiddenDice: [...document.querySelectorAll('#topBoard .die,#botBoard .die')]
          .filter((die) => getComputedStyle(die).visibility === 'hidden').length,
        particles: document.querySelectorAll('#fx .particle').length,
      };
    });
    const rp = out.wardPilferReduced;
    check(rp.reduced && rp.before === rp.after && rp.wards === '[[0,0,0],[0,0,0]]'
        && rp.score === '6' && rp.bonus === '+0' && rp.bonusVisibility === 'hidden'
        && rp.transients === 0 && rp.hiddenDice === 0 && rp.particles === 0,
      'reduced-motion WARD/PILFER did not resolve to one clean, score-correct still', rp);
  } finally { await reduced.ctx.close(); }

  /* A full all-distinct COLUMN SHIELD column may carry scoring-WARD. A matching
     placement reaches and burns that WARD, but the permanent shield keeps every
     die and the zero-victim answer cannot mint BOUNTY. */
  await newGame({ spell: 'ward', mode: 3 });
  check(await waitChoose(), 'game never reached choose (shielded scoring-WARD)');
  await table([[], [], []], [[4, 5, 6], [], []], 4);
  await guard(0, 0);
  out.shieldedScoringWard = await page.evaluate(async () => {
    const k = window.__kb;
    const before = {
      target: JSON.stringify(k.S.boards[0][0]), bounty: JSON.stringify(k.S.bounty),
      total: document.getElementById('totTop').textContent,
      bonus: document.querySelector('#wptTop b')?.textContent,
    };
    let finished = false, sawSnap = false, sawWardGhost = false, sawBountyMint = false;
    let targetChanged = false, shieldLost = false;
    const move = k.place(1, 0);
    move.finally(() => { finished = true; });
    for (let tick = 0; tick < 360 && !finished; tick++) {
      const target = document.querySelector('#topBoard .col[data-col="0"]');
      sawSnap ||= target.classList.contains('sealsnap');
      sawWardGhost ||= !!document.querySelector('.ward-strike-ghost');
      sawBountyMint ||= !!document.querySelector('.bounty-mint,.bounty-mint-slot');
      targetChanged ||= JSON.stringify(k.S.boards[0][0]) !== before.target;
      shieldLost ||= !target.classList.contains('shielded');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await move;
    // WARD's snap deliberately outlives contact; inspect the honest resting
    // shield after its one-shot class and score bump have both settled.
    await new Promise((resolve) => setTimeout(resolve, 760));
    const target = document.querySelector('#topBoard .col[data-col="0"]');
    const shield = document.querySelectorAll('#topCols .chip')[0].querySelector('.sh');
    const ward = document.getElementById('wptTop');
    const painted = (selector) => {
      const node = target.querySelector(selector);
      if (!node) return false;
      let current = node;
      while (current && current !== target) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity <= .05) return false;
        current = current.parentElement;
      }
      return true;
    };
    return {
      before, sawSnap, sawWardGhost, sawBountyMint, targetChanged, shieldLost,
      target: JSON.stringify(k.S.boards[0][0]), mine: JSON.stringify(k.S.boards[1][0]),
      wards: JSON.stringify(k.S.charm.wards), bounty: JSON.stringify(k.S.bounty),
      total: document.getElementById('totTop').textContent,
      bonus: ward.querySelector('b')?.textContent, bonusVisibility: getComputedStyle(ward).visibility,
      shielded: target.classList.contains('shielded'), warded: target.classList.contains('warded'),
      snap: target.classList.contains('sealsnap'), shieldChip: !!shield.firstElementChild,
      goldPainted: painted('.sgold .sl'), mintPainted: painted('.smint .sv'),
      wardGhosts: document.querySelectorAll('.ward-strike-ghost').length,
      bountyMarks: document.querySelectorAll('.bounty-mint,.bounty-mint-slot').length,
      bountyFeedback: [...document.querySelectorAll('.pts')]
        .filter((node) => node.textContent.includes('✦')).length,
    };
  });
  const shielded = out.shieldedScoringWard;
  check(shielded.sawSnap && shielded.sawWardGhost && !shielded.targetChanged && !shielded.shieldLost
      && shielded.target === '[4,5,6]' && shielded.mine === '[4]'
      && shielded.wards === '[[0,0,0],[0,0,0]]',
    'the full distinct shield did not burn WARD while preserving all zero-victim dice', shielded);
  check(!shielded.sawBountyMint && shielded.before.bounty === '[0,0]' && shielded.bounty === '[0,0]'
      && shielded.bountyMarks === 0 && shielded.bountyFeedback === 0,
    'the zero-victim shield/WARD answer minted or banked BOUNTY', shielded);
  check(shielded.before.total === '30' && shielded.before.bonus === '+15'
      && shielded.total === '15' && shielded.bonus === '+0' && shielded.bonusVisibility === 'hidden'
      && shielded.shielded && !shielded.warded && !shielded.snap && shielded.shieldChip
      && shielded.goldPainted && !shielded.mintPainted && shielded.wardGhosts === 0,
    'the settled shield/WARD hit did not leave one permanent shield and the corrected score', shielded);
}
