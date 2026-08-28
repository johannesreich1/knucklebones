// THE RUNE RAIL CHANGES HANDS IN RANKED TOO.
//
// Offline, the two cards beside the die trade depth on every turn change: the
// incoming seat's card comes forward while the outgoing one falls back, over
// the .25s tween on `.rune` (src/styles/game/spells.css). Ranked painted the
// board and the die for the opponent's turn but never the rail, so against a
// bot — which is who the ladder serves after 7s in queue — the cards sat
// frozen for the whole match and the player saw no handoff at all.
//
// This measures WHAT THE PLAYER SEES rather than which function ran: computed
// transforms sampled every frame across the boundary, plus the transition
// events the browser itself reports. A tween passes through intermediate
// matrices; an instant jump — or a rail nobody repainted — does not.
// The offline half of the same behaviour is pinned by
// tests/browser/spells/scenarios/turn-handoff.mjs.

/* Installed in the page before the tap: transition events on both seat cards,
   plus a per-frame sample of the computed transform, the classes, the root's
   opponent-turn state and each card's node identity. */
const INSTALL_RAIL_PROBE = () => {
  const bar = document.getElementById('spellBar');
  const root = document.getElementById('kbroot');
  const clockWrap = document.getElementById('timerWrap');
  const clockBar = document.getElementById('timerBar');
  const probe = { events: [], frames: [], running: true };
  window.__railProbe = probe;
  for (const type of ['transitionrun', 'transitionstart', 'transitionend', 'transitioncancel']) {
    bar.addEventListener(type, (event) => {
      const card = event.target;
      if (!(card instanceof HTMLElement) || !card.classList.contains('rune')) return;
      probe.events.push({ type, property: event.propertyName,
        seat: card.dataset.seat, at: Math.round(performance.now()) });
    }, true);
  }
  /* A replaced node cannot transition. Stamp both buttons so a swap that only
     LOOKS right because the rail was rebuilt is caught as a different card. */
  for (const card of bar.querySelectorAll('.rune')) {
    card.dataset.railProbe = `seat-${card.dataset.seat}`;
  }
  const read = (card) => {
    const style = getComputedStyle(card);
    const matrix = style.transform === 'none'
      ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
    return {
      scale: Number(Math.hypot(matrix.a, matrix.b).toFixed(4)),
      active: card.classList.contains('hand-active'),
      standby: card.classList.contains('hand-standby'),
      identity: card.dataset.railProbe ?? null,
      display: style.display,
    };
  };
  /* The countdown is the other half of "a turn was taken": it lights only
     while somebody is on the clock, and it wears the mover's own colour. */
  const clock = () => ({
    on: clockWrap.classList.contains('on'),
    base: clockWrap.style.getPropertyValue('--tcbase').trim(),
    width: Math.round(parseFloat(clockBar.style.width) || 0),
  });
  const sample = () => {
    const cards = [...bar.querySelectorAll('.rune:not([hidden])')]
      .filter((card) => !!card.offsetParent);
    probe.frames.push({
      at: Math.round(performance.now()),
      turn: window.__kb.S.turn,
      opponentTurn: root.classList.contains('opponent-turn'),
      bar: bar.className,
      count: cards.length,
      clock: clock(),
      seats: Object.fromEntries(cards.map((card) => [card.dataset.seat, read(card)])),
    });
    if (probe.running) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

/* Condense in the page: a raw frame log is hundreds of objects, and what the
   assertions (and a failure report) need is the PATH each value walked. */
const READ_RAIL_PROBE = () => {
  const probe = window.__railProbe;
  probe.running = false;
  const frames = probe.frames;
  const runs = (values) => values.filter((value, index) =>
    index === 0 || JSON.stringify(value) !== JSON.stringify(values[index - 1]));
  const seatPath = (seat) => {
    const read = frames.map((frame) => frame.seats[seat]).filter(Boolean);
    const scales = read.map((entry) => entry.scale);
    return {
      samples: read.length,
      scalePath: runs(scales),
      distinctScales: [...new Set(scales)].length,
      /* Mid-tween evidence: a frame strictly between the two resting scales
         this seat is asked to travel between. */
      intermediate: scales.filter((value) => value > 0.83 && value < 0.945).length,
      minScale: Math.min(...scales),
      maxScale: Math.max(...scales),
      activePath: runs(read.map((entry) => entry.active)),
      identities: [...new Set(read.map((entry) => entry.identity))],
      displays: [...new Set(read.map((entry) => entry.display))],
    };
  };
  const transform = probe.events.filter((event) => event.property === 'transform');
  /* The opponent's beat, in wall clock and in pixels: how long the table
     actually held their turn, and whether their countdown ran while it did. */
  const you = window.__kbOnline()?.you ?? 1;
  const theirs = frames.filter((frame) => frame.turn !== you);
  const theirClock = theirs.filter((frame) => frame.clock.on);
  const clockWidths = runs(theirClock.map((frame) => frame.clock.width));
  return {
    frames: frames.length,
    opponentTurnMs: theirs.length ? theirs[theirs.length - 1].at - theirs[0].at : 0,
    clockOnFrames: theirClock.length,
    clockBases: [...new Set(theirClock.map((frame) => frame.clock.base))],
    myClockBases: [...new Set(frames
      .filter((frame) => frame.turn === you && frame.clock.on)
      .map((frame) => frame.clock.base))],
    clockWidths,
    clockDrained: clockWidths.length > 2
      && clockWidths.every((value, index) => index === 0 || value < clockWidths[index - 1]),
    turnPath: runs(frames.map((frame) => frame.turn)),
    opponentTurnPath: runs(frames.map((frame) => frame.opponentTurn)),
    barClasses: [...new Set(frames.map((frame) => frame.bar))],
    cardCounts: [...new Set(frames.map((frame) => frame.count))],
    seat0: seatPath('0'),
    seat1: seatPath('1'),
    transformEvents: transform.length,
    transformSeats: [...new Set(transform.map((event) => event.seat))].sort(),
    transformTypes: [...new Set(transform.map((event) => event.type))].sort(),
    events: probe.events.slice(0, 24),
  };
};

async function railHandoffProbe(page) {
  await page.evaluate(INSTALL_RAIL_PROBE);
  const opening = await page.evaluate(() => ({
    turn: window.__kb.S.turn,
    you: window.__kbOnline().you,
    charges: JSON.stringify(window.__kb.S.spellCharges),
    bar: document.getElementById('spellBar').className,
  }));
  /* One real tap on a real column. Everything after this is the app's own
     ranked path: pvp-action commits the player's placement AND the bot's
     reply, then the client replays both rows out of one sync. */
  await page.tap('#botBoard .col[data-col="1"]');
  await page.waitForFunction(() => (window.__kbOnline()?.applied ?? 0) >= 2,
    null, { timeout: 15000 });
  // let the return leg of the tween finish before the sampler is stopped
  await page.waitForTimeout(500);
  const swap = await page.evaluate(READ_RAIL_PROBE);
  const settled = await page.evaluate(() => ({
    turn: window.__kb.S.turn,
    phase: window.__kb.S.phase,
    opponentTurn: document.getElementById('kbroot').classList.contains('opponent-turn'),
  }));
  return { opening, swap, settled };
}

export async function runRuneTrialRailScenarios({ visit, out, check }) {
  const seen = await visit({
    door: 'match',
    named: true,
    runes: ['pilfer'],
    trialMatch: true,
    skipStandardProbes: true,
    probe: railHandoffProbe,
  });
  out.rankedRuneRail = seen.probeResult;
  const result = seen.probeResult;
  const swap = result?.swap;

  check(result?.opening?.turn === 1 && result.opening.you === 1
      && result.opening.bar.includes('paired') && result.opening.bar.includes('live'),
  'the ranked Trial table did not open with both dealt hands on the rail and the player to move',
  result?.opening);

  /* The premise: the game really does spend time on the opponent's turn. If it
     never did, a frozen rail would be correct rather than a bug. */
  check(!!swap && swap.turnPath.includes(0) && swap.turnPath[0] === 1
      && swap.turnPath[swap.turnPath.length - 1] === 1,
  'the ranked replay never held the opponent’s turn, so there was no handoff to paint',
  swap?.turnPath);

  check(!!swap && swap.opponentTurnPath.includes(true)
      && swap.opponentTurnPath[swap.opponentTurnPath.length - 1] === false,
  'the board never took the opponent-turn presentation while the opponent was playing',
  swap?.opponentTurnPath);

  /* THE BUG, IN PIXELS. Frozen cards produce exactly one scale value each and
     no transition events at all. */
  check(!!swap && swap.seat1.distinctScales > 2 && swap.seat0.distinctScales > 2
      && swap.seat1.intermediate > 0 && swap.seat0.intermediate > 0,
  'the two rune cards held one fixed scale instead of tweening across the ranked turn change',
  { seat0: swap?.seat0, seat1: swap?.seat1 });

  check(!!swap && swap.transformEvents > 0
      && swap.transformSeats.join(',') === '0,1',
  'no CSS transform transition ran on the ranked rune cards during the turn change',
  { events: swap?.transformEvents, seats: swap?.transformSeats, log: swap?.events });

  /* Depth actually traded: the opponent's card came forward far enough to read
     as the live hand, the player's fell back, and both returned. */
  check(!!swap && swap.seat0.maxScale >= 0.90 && swap.seat1.minScale <= 0.90
      && swap.seat0.activePath.includes(true) && swap.seat1.activePath.includes(false)
      && swap.seat1.activePath[swap.seat1.activePath.length - 1] === true,
  'the opponent card never came forward, or the player card never got the hand back',
  { seat0: swap?.seat0, seat1: swap?.seat1 });

  /* Neither card was replaced, hidden or dropped mid-swap — a transition
     cannot run on a node that was rebuilt or on display:none. */
  check(!!swap && swap.cardCounts.join(',') === '2'
      && swap.seat0.identities.join(',') === 'seat-0'
      && swap.seat1.identities.join(',') === 'seat-1'
      && swap.seat0.displays.every((value) => value !== 'none')
      && swap.seat1.displays.every((value) => value !== 'none')
      && swap.barClasses.every((value) => value.includes('paired')),
  'a rune card was rebuilt, hidden, or lost its paired rail during the ranked handoff',
  { counts: swap?.cardCounts, bar: swap?.barClasses,
    identities: [swap?.seat0.identities, swap?.seat1.identities] });

  /* THE BOT TAKES A TURN INSTEAD OF ANSWERING IN THE PLAYER'S OWN FRAME. Its
     reply is committed inside the player's action command, so replayed raw it
     lands with no handoff to see at all — which is what 478de18 shipped. The
     floor here is 260+340+260ms of guaranteed beat; measured, not asserted
     against a stub. */
  check(!!swap && swap.opponentTurnMs >= 700,
  'the ranked Trial bot answered instantly instead of taking a visible turn',
  { opponentTurnMs: swap?.opponentTurnMs, frames: swap?.frames });

  /* The countdown ran for them, in THEIR colour — the same clock a human
     opponent gets, not a dark strip. */
  check(!!swap && swap.clockOnFrames > 0 && swap.clockBases.length === 1
      && swap.myClockBases.length === 1
      && swap.clockBases[0] !== swap.myClockBases[0],
  'the turn clock never lit in the opponent’s colour while the bot was thinking',
  { theirs: swap?.clockBases, mine: swap?.myClockBases, on: swap?.clockOnFrames });

  check(!!swap && swap.clockDrained,
  'the opponent’s countdown bar never drained across their turn',
  swap?.clockWidths);

  check(result?.settled?.turn === 1 && result.settled.phase === 'choose'
      && result.settled.opponentTurn === false,
  'the ranked table did not settle back on the player’s own turn', result?.settled);

  check(seen.errs.length === 0, 'page errors during the ranked rune rail handoff', seen.errs);
}
