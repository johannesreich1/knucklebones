// YOUR SIDE IS YOUR COLOUR, FROM EITHER SEAT.
//
// `--p1` is what means "you" everywhere else in the app — the away plate, the
// scoreline and the active row all resolve it for the player's own moment. The
// board was the one place that disagreed.
//
// Ranked seats are not symmetrical: pvp-join seats the LOWER-rated participant
// as p1 (supabase/functions/pvp-join/matchmaking.ts), so the higher-rated
// player is handed seat 0. The board coloured itself straight off that seat, so
// that player's own half of the table was painted in the OPPONENT's colour —
// deterministically, in every match they were favoured to win, on a screen only
// they were looking at. Reported from a device 2026-08-28: "I am the standard
// blue and opponent standard pink but in the game I am pink".
//
// This asserts the fact as it was reported: a RESOLVED COLOUR read off the
// painted side. Asserting the seat, the dataset, or which token was named would
// only re-test the half that was already right — the seat was correct all
// along, and the colour was still wrong.
//
// Both seats are covered, because the bug survived for as long as it existed by
// never varying the one thing that mattered: offline play only ever seats the
// player at 1, which is the seat that happened to look correct.

/* Runs in the page. A var() chain can be valid, inherited, and still be the
   wrong colour, so paint each token onto a throwaway node and read the computed
   value back — that is the only thing that settles what the player saw. */
const seatColourProbe = () => {
  const resolve = (selector, property) => {
    const host = document.querySelector(selector);
    if (!host) return null;
    const probe = document.createElement('span');
    probe.style.color = `var(${property})`;
    probe.style.display = 'none';
    host.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  };
  const seat = (you) => {
    window.__kbSeat(you);
    return {
      you,
      botOwner: document.getElementById('sideBot').dataset.owner,
      topOwner: document.getElementById('sideTop').dataset.owner,
      // --c is what a side hands to everything painted inside it
      mine: resolve('#sideBot', '--c'),
      theirs: resolve('#sideTop', '--c'),
    };
  };
  const chosen = { p1: resolve('#kbroot', '--p1'), p2: resolve('#kbroot', '--p2') };
  const asP1 = seat(1);
  const asP2 = seat(0);
  return { chosen, asP1, asP2 };
};

export async function runSeatColourScenarios({ visit, out, check }) {
  const seated = await visit({
    named: true,
    skipStandardProbes: true,
    probe: (page) => page.evaluate(seatColourProbe),
  });
  const result = seated.probeResult;
  out.seatColours = result;
  if (!result) {
    check(false, 'the seat-colour probe returned nothing — the board never painted', seated);
    return;
  }
  const { chosen, asP1, asP2 } = result;

  check(!!chosen.p1 && !!chosen.p2 && chosen.p1 !== chosen.p2,
    'the two player colours resolve to the same thing — this probe cannot tell them apart', chosen);

  /* The protocol seat must survive untouched: ownerOf() places dice by it, and
     the HUD chips and spell cards carry the same index. */
  check(asP1.botOwner === '1' && asP1.topOwner === '0',
    'seat 1 did not keep the protocol seat on the board', asP1);
  check(asP2.botOwner === '0' && asP2.topOwner === '1',
    'seat 0 did not keep the protocol seat on the board', asP2);

  /* THE assertion, from both seats: my side wears my colour. */
  check(asP1.mine === chosen.p1,
    'seated as p1, the player\'s own side is not the player\'s own colour', { asP1, chosen });
  check(asP2.mine === chosen.p1,
    'SEATED AS P2, THE PLAYER\'S OWN SIDE IS PAINTED IN THE OPPONENT\'S COLOUR', { asP2, chosen });

  /* ...and the opponent still reads as the other one, so the fix cannot be a
     blanket repaint that leaves both halves of the table the same. */
  check(asP1.theirs === chosen.p2 && asP2.theirs === chosen.p2,
    'the opponent\'s side is not the opponent\'s colour', { asP1, asP2, chosen });
  check(asP1.mine !== asP1.theirs && asP2.mine !== asP2.theirs,
    'the two sides of the table resolve to the same colour', { asP1, asP2 });
}
