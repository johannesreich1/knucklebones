// A BOT'S OPENING TURN IS PERFORMED, NOT ALREADY THERE.
//
// Reported from a device 2026-08-30: "When ai opens, at least In rune ritual
// it's instantly played."
//
// Mid-game the machine's reply is a turn the player watches: the seat changes
// hands, their die is rolled in the open, the countdown runs in their colour and
// the think is drawn at random (play-motion.ts openOpponentTurn). An OPENING got
// none of that, for a reason that has nothing to do with the opening itself:
//
//   1. The server bakes it in before the client ever reads the board — the start
//      RPC writes the opening move for ordinary ranked, and the Trial's opener is
//      committed inside the same request that reveals the runes. So the first
//      read finds it already in the log.
//   2. That first read is the ONE read that refuses to animate. initial-sync
//      calls sync(TRUE), and both replays gate on `!fullRedraw` — so the rows
//      were dropped on the floor and the projection painted them in one frame.
//
// The missing thing was never the animation; it was the CLAIM. `botBeatDue` is
// what buys the beat mid-game, and it was hard-coded false at entry because the
// join payload carried no "a bot moved inside this request" field — even though
// the server already builds exactly that array. It now says so, and the flag,
// not the redraw mode, decides whether a batch is performed.
//
// A REJOIN MUST STAY SILENT, which is what the second half of this pins: the
// flag rides only on the response that committed the opener, so reconnecting
// into a match in progress still projects without replaying a whole game.

/* The projector always starts at ME(1), so seat 1 opens. Seating the viewer at 0
   is therefore the only way a match can open with the OPPONENT moving. */
const OPENER = [{ who: 1, col: 0, nextDie: 5 }];

/* RECORDED FROM INSIDE THE PAGE, FROM BEFORE IT LOADS. `door: 'match'` waits for
   `phase === 'choose' && !busy` — the whole entry, beat included — so anything
   the probe measures afterwards has already happened. The first attempt timed
   from the probe and read 2ms with the fix IN, which says nothing about the fix
   and everything about when the clock started.

   Watch S.boards, never the DOM: a column previews a die before one is placed,
   and this suite has been fooled by exactly that before. */
const RECORDER = () => {
  const w = window;
  w.__kbOpening = { enteredAt: null, dieAt: null, clockWhileEmpty: false };
  const tick = () => {
    const kb = w.__kb, online = w.__kbOnline?.();
    if (kb && online) {
      const now = performance.now();
      w.__kbOpening.enteredAt ??= now;
      const theirs = kb.S.boards[1 - online.you].reduce((n, c) => n + c.length, 0);
      if (theirs > 0) w.__kbOpening.dieAt ??= now;
      /* Their countdown, running while their half of the board is still bare:
         the half of the beat the player says never happens. */
      else if (document.getElementById('timerWrap')?.classList.contains('on')) {
        w.__kbOpening.clockWhileEmpty = true;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function enterAndWatch(visit, trialMatch) {
  return visit({
    named: true, skipStandardProbes: true, door: 'match', trialMatch,
    initScript: RECORDER,
    probe: (page) => page.evaluate(() => {
      const r = window.__kbOpening;
      return {
        ...r,
        /* The whole point of the measurement: how long after this client first
           had a match did the opponent's die reach the board. */
        beatMs: r.enteredAt !== null && r.dieAt !== null
          ? Math.round(r.dieAt - r.enteredAt) : null,
        dice: (() => {
          const online = window.__kbOnline();
          return window.__kb.S.boards[1 - online.you].reduce((n, c) => n + c.length, 0);
        })(),
      };
    }),
  });
}

export async function runBotOpeningBeatScenarios({ visit, out, check }) {
  /* ---- the bot opened THIS match: the turn is performed ---- */
  const opened = (await enterAndWatch(visit, {
    you: 0, seedPlacements: OPENER, botOpened: true,
  })).probeResult;
  out.botOpeningBeat = opened;

  check(!!opened && opened.dice === 1,
    'the opening die never reached the board, so nothing below is measuring it', opened);
  /* THE assertion. openOpponentTurn pauses 260ms, reveals the die, pauses 340ms
     and then thinks for at least another 260 — so a performed opening cannot be
     on the board in the first frames. Generous on purpose: this separates
     "performed" from "already there", and must not become a timing budget. */
  check(!!opened && opened.beatMs !== null && opened.beatMs >= 400,
    'THE BOT\'S OPENING WAS ALREADY ON THE BOARD — it is painted by the entry '
    + 'projection instead of being played, so the player never sees the turn '
    + 'that produced it', opened);
  check(!!opened && opened.clockWhileEmpty,
    'the opponent\'s countdown never ran while their half of the board was still '
    + 'bare, so whatever landed was not a performed turn', opened);

  /* ---- a REJOIN of the same log stays silent ---- */
  const rejoined = (await enterAndWatch(visit, {
    you: 0, seedPlacements: OPENER, botOpened: false,
  })).probeResult;
  out.botOpeningRejoin = rejoined;

  check(!!rejoined && rejoined.dice === 1,
    'the rejoin probe never projected the existing board', rejoined);
  /* Reconnecting into a match in progress must not replay it. The row is the
     same row; only the CLAIM differs, which is the whole point of carrying it
     on the response that committed the opener rather than inferring it. */
  check(!!rejoined && rejoined.beatMs !== null && rejoined.beatMs < 400,
    'A REJOIN REPLAYED THE OPPONENT\'S TURN — entry animates a log this client '
    + 'has simply never seen, which would make reconnecting into a long match '
    + 'sit through every move of it', rejoined);
}
