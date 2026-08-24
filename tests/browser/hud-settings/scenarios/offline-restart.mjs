const LIMITED = 6;
const RANDOM_MODE = -1;
const RANDOM_SPELL = 'random';

const stableGameState = () => {
  const k = window.__kb;
  const S = k.S;
  return {
    gen: S.gen,
    scoring: S.scoring,
    localMode: S.localMode,
    spell: S.spell,
    starter: S.starter,
    turn: S.turn,
    phase: S.phase,
    die: S.die,
    boards: JSON.stringify(S.boards),
    pool: JSON.stringify(S.pool),
    bounty: JSON.stringify(S.bounty),
    charges: JSON.stringify(S.spellCharges),
    charm: JSON.stringify(S.charm),
    armed: S.spellArmed,
    committed: JSON.stringify(S.spellAimCommitted),
    record: JSON.stringify({
      wins: S.wins, losses: S.losses, draws: S.draws,
      p1: S.p1, p2: S.p2, ties: S.ties, best: S.best,
    }),
  };
};

const askShape = () => {
  const card = document.querySelector('#ovAsk .askcard');
  const visible = (element) => {
    if (!element || element.hidden) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0
      && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const buttonShape = (id) => {
    const element = document.getElementById(id);
    if (!visible(element)) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      id,
      text: element.textContent.trim(),
      height: rect.height,
      hit: hit === element || element.contains(hit),
      style: {
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        boxShadow: style.boxShadow,
        color: style.color,
        borderTopWidth: style.borderTopWidth,
        borderTopStyle: style.borderTopStyle,
        borderTopColor: style.borderTopColor,
        borderRadius: style.borderRadius,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
      },
    };
  };
  return {
    on: document.getElementById('ovAsk')?.classList.contains('on') ?? false,
    head: document.getElementById('askHead')?.textContent?.trim() ?? '',
    order: [...(card?.querySelectorAll(':scope > button') ?? [])]
      .filter(visible).map((button) => button.textContent.trim()),
    keep: buttonShape('btnAskNo'),
    restart: buttonShape('btnAskAlt'),
    quit: buttonShape('btnAskYes'),
  };
};

function checkAskLayout(check, label, shape) {
  check(shape.on && shape.head === 'Quit this duel?',
    `${label}: offline quit question copy is wrong`, shape);
  check(shape.order.join(' -> ') === 'Keep playing -> Restart duel -> Quit duel',
    `${label}: offline quit actions are missing or out of order`, shape);
  check(shape.restart?.hit === true && shape.quit?.hit === true,
    `${label}: Restart duel or Quit duel is not the painted hit target`, shape);
  check(!!shape.restart && !!shape.quit
    && Math.abs(shape.restart.height - shape.quit.height) < 0.5
    && JSON.stringify(shape.restart.style) === JSON.stringify(shape.quit.style),
  `${label}: Restart duel does not match Quit duel in height and computed style`, shape);
}

export async function runOfflineRestartScenarios(suite) {
  const { page, out, check } = suite;
  const originalViewport = page.viewportSize();

  /* Selectors still promise RANDOM, but the active duel has already resolved
     to LIMITED + WARD. Restart must preserve those answers and the opener; it
     must not walk back through either reveal or consult the setup selectors. */
  await page.evaluate(([mode, spell]) => {
    const k = window.__kb;
    k.S.mode = 'cpu';
    k.S.timer = 0;
    k.S.seat = 'face';
    k.S.localMode = -1;
    k.S.spell = 'random';
    k.S.starter = 1;
    k.newGame({ scoring: mode, spell });
  }, [LIMITED, 'ward']);
  await page.waitForFunction(() => {
    const S = window.__kb.S;
    return S.phase === 'choose' && S.turn === 1 && !S.busy && S.die > 0;
  }, null, { timeout: 15000 });
  const opener = await page.evaluate(() => window.__kb.S.turn);

  /* Make this visibly an in-progress duel and wait for the CPU reply to
     settle. Its matching roll may strike our first die away, so the durable
     proof of the reply is a die on the CPU board plus our next live choice —
     not an assumption that both opening dice survived. */
  await page.tap('#botBoard .col[data-col="0"]');
  await page.waitForFunction(() => {
    const S = window.__kb.S;
    return S.phase === 'choose' && S.turn === 1 && !S.busy && S.die > 0
      && S.boards[0].flat().length > 0;
  }, null, { timeout: 20000 });
  await page.evaluate(() => {
    const S = window.__kb.S;
    // Dirty the restart-owned spell/effect state as though WARD were spent.
    S.spellCharges[1].ward = 0;
    S.charm.wards[1][0] = 1;
    S.spellArmed = 'ward';
    S.spellAimCommitted = { id: 'ward', who: 1 };
    S.bounty = [7, 8];
  });
  const beforeKeep = await page.evaluate(stableGameState);

  await page.setViewportSize({ width: originalViewport?.width ?? 390, height: 844 });
  await page.waitForTimeout(120);
  await page.tap('#btnLeave');
  await page.waitForSelector('#ovAsk.on');
  out.offlineAskRegular = await page.evaluate(askShape);
  checkAskLayout(check, 'regular phone', out.offlineAskRegular);

  /* The shared question remains live while language changes. Only its text
     nodes repaint: focus, the modal/buttons, and their already-bound actions
     must survive. Wait out tap()'s native-click guard before pressing the
     hidden Settings arrow from code. */
  await page.waitForTimeout(700);
  out.askLocaleRepaint = await page.evaluate(() => {
    const ids = ['ovAsk', 'askHead', 'askBody', 'btnAskNo', 'btnAskAlt', 'btnAskYes'];
    const nodes = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
    window.__askLocaleNodes = nodes;
    nodes.btnAskAlt.focus();
    const before = {
      head: nodes.askHead.textContent.trim(),
      body: nodes.askBody.textContent.trim(),
      focus: document.activeElement?.id,
    };
    document.getElementById('languageNext').click();
    const card = document.querySelector('#ovAsk .askcard');
    const visible = [...card.querySelectorAll(':scope > button')]
      .filter((button) => !button.hidden).map((button) => button.textContent.trim());
    return {
      before,
      locale: window.__kb.S.localeOverride,
      head: nodes.askHead.textContent.trim(),
      body: nodes.askBody.textContent.trim(),
      order: visible,
      focus: document.activeElement?.id,
      sameNodes: ids.every((id) => document.getElementById(id) === window.__askLocaleNodes[id]),
    };
  });
  check(out.askLocaleRepaint.locale === 'de'
    && out.askLocaleRepaint.head === 'Dieses Duell beenden?'
    && out.askLocaleRepaint.body !== out.askLocaleRepaint.before.body
    && out.askLocaleRepaint.order.join(' -> ')
      === 'Weiterspielen -> Duell neu starten -> Duell beenden',
  'visible ask-card did not repaint all copy in German', out.askLocaleRepaint);
  check(out.askLocaleRepaint.sameNodes && out.askLocaleRepaint.focus === 'btnAskAlt',
    'ask-card locale repaint replaced a node or lost focus', out.askLocaleRepaint);

  out.askLocaleRestored = await page.evaluate(() => {
    document.getElementById('languagePrevious').click();
    const sameNodes = Object.entries(window.__askLocaleNodes)
      .every(([id, node]) => document.getElementById(id) === node);
    /* Restore the automatic preference expected by the selector scenarios;
       the effective language is already English again. */
    window.__kb.S.localeOverride = null;
    const key = 'knucklebones.v1';
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    saved.localeOverride = null;
    localStorage.setItem(key, JSON.stringify(saved));
    return {
      head: document.getElementById('askHead').textContent.trim(),
      focus: document.activeElement?.id,
      sameNodes,
    };
  });
  check(out.askLocaleRestored.head === 'Quit this duel?'
    && out.askLocaleRestored.focus === 'btnAskAlt' && out.askLocaleRestored.sameNodes,
  'ask-card did not repaint back to English in place', out.askLocaleRestored);

  await page.setViewportSize({ width: originalViewport?.width ?? 390, height: 620 });
  await page.waitForTimeout(120);
  out.offlineAskShort = await page.evaluate(askShape);
  checkAskLayout(check, 'short phone', out.offlineAskShort);
  if (originalViewport) await page.setViewportSize(originalViewport);
  await page.waitForTimeout(120);

  // The encouraged way back is a true cancel: not one byte of duel state moves.
  await page.tap('#btnAskNo');
  await page.waitForTimeout(120);
  const afterKeep = await page.evaluate(stableGameState);
  out.keepPlaying = {
    before: beforeKeep,
    after: afterKeep,
    askGone: await page.locator('#ovAsk').evaluate((node) => !node.classList.contains('on')),
  };
  check(out.keepPlaying.askGone
    && JSON.stringify(out.keepPlaying.before) === JSON.stringify(out.keepPlaying.after),
  'Keep playing changed the in-progress duel', out.keepPlaying);

  /* Record even a transient reveal: checking only the final class would miss a
     flash that disappeared before the fresh opening roll reached CHOOSE. */
  await page.evaluate(() => {
    window.__restartRevealSeen = !!document.querySelector('#ovWheel.on');
    window.__restartRevealObserver = new MutationObserver(() => {
      if (document.querySelector('#ovWheel.on')) window.__restartRevealSeen = true;
    });
    window.__restartRevealObserver.observe(document.getElementById('kbroot'), {
      subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
    });
  });
  await page.tap('#btnLeave');
  await page.waitForSelector('#ovAsk.on');
  await page.tap('#btnAskAlt');
  await page.waitForFunction(([generation, expectedOpener]) => {
    const S = window.__kb.S;
    return S.gen === generation + 1 && S.phase === 'choose'
      && S.turn === expectedOpener && !S.busy && S.die > 0;
  }, [beforeKeep.gen, opener], { timeout: 15000 });

  out.restarted = await page.evaluate(([mode, randomMode, randomSpell, expectedOpener]) => {
    const S = window.__kb.S;
    window.__restartRevealObserver?.disconnect();
    const supply = [...(S.pool ?? []), S.die];
    const faceCounts = Array.from({ length: 6 }, (_, index) =>
      supply.filter((face) => face === index + 1).length);
    const state = {
      gen: S.gen,
      scoring: S.scoring,
      localMode: S.localMode,
      spell: S.spell,
      starter: S.starter,
      turn: S.turn,
      phase: S.phase,
      die: S.die,
      boards: JSON.stringify(S.boards),
      pool: JSON.stringify(S.pool),
      bounty: JSON.stringify(S.bounty),
      charges: JSON.stringify(S.spellCharges),
      charm: JSON.stringify(S.charm),
      armed: S.spellArmed,
      committed: JSON.stringify(S.spellAimCommitted),
      record: JSON.stringify({
        wins: S.wins, losses: S.losses, draws: S.draws,
        p1: S.p1, p2: S.p2, ties: S.ties, best: S.best,
      }),
    };
    return {
      state,
      expected: { mode, randomMode, randomSpell, expectedOpener },
      boardsEmpty: S.boards.every((board) => board.every((column) => column.length === 0)),
      dealt: S.spellCharges.map((charges) => Object.keys(charges)),
      charges: S.spellCharges.map((charges) => charges.ward),
      effectsFresh: S.bounty.every((value) => value === 0)
        && S.charm.wards.every((side) => side.every((value) => value === 0))
        && S.charm.sunder.every((value) => value === false)
        && S.spellArmed === null && S.spellAimCommitted === null,
      bag: { left: S.pool?.length ?? null, faceCounts },
      askGone: !document.getElementById('ovAsk').classList.contains('on'),
      revealOn: document.querySelector('#ovWheel.on') !== null,
      revealSeen: window.__restartRevealSeen,
    };
  }, [LIMITED, RANDOM_MODE, RANDOM_SPELL, opener]);

  const restarted = out.restarted;
  check(restarted.state.gen === beforeKeep.gen + 1,
    'Restart duel did not advance exactly one generation', restarted);
  check(restarted.state.scoring === LIMITED
    && restarted.state.localMode === RANDOM_MODE && restarted.state.spell === RANDOM_SPELL,
  'Restart duel redrew a resolved RANDOM mode/rune or changed the setup selectors', restarted);
  check(restarted.state.turn === opener && restarted.state.starter === beforeKeep.starter,
    'Restart duel changed the opening player or advanced opener rotation', restarted);
  check(restarted.boardsEmpty && restarted.dealt.every((keys) => keys.join() === 'ward')
    && restarted.charges.every((uses) => uses === 1) && restarted.effectsFresh,
  'Restart duel did not replace boards, WARD charges, and effects with fresh state', restarted);
  check(restarted.bag.left === 23 && restarted.bag.faceCounts.every((count) => count === 4),
    'Restart duel did not replace LIMITED with a fresh 24-die supply', restarted);
  check(restarted.state.record === beforeKeep.record,
    'Restart duel recorded the abandoned duel as a result', restarted);
  check(restarted.askGone && !restarted.revealOn && !restarted.revealSeen,
    'Restart duel opened a RANDOM reveal or left the ask-card on screen', restarted);

  /* The optional action is rebuilt state, not sticky DOM. Open the same shared
     ask-card from a tutorial after the three-action card and prove it returns
     to its ordinary two answers. */
  await page.evaluate(() => {
    window.__kb.S.starter = 1;
    window.__kb.newGame({ tutorial: true });
  });
  await page.waitForSelector('#coach:not([hidden])');
  await page.tap('#coach');
  await page.waitForFunction(() => window.__kb.S.phase === 'choose', null, { timeout: 10000 });
  await page.tap('#btnLeave');
  await page.waitForSelector('#ovAsk.on');
  out.tutorialAsk = await page.evaluate(askShape);
  check(out.tutorialAsk.order.join(' -> ') === 'Keep playing -> Quit tutorial'
    && out.tutorialAsk.restart === null,
  'the tutorial ask-card does not name its tutorial exit or leaked restart', out.tutorialAsk);
  await page.tap('#btnAskYes');
  await page.waitForTimeout(300);
}
