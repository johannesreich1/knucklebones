// THE DIE THAT FLIES TO ITS SLOT MUST WEAR THE COLOUR IT LANDS IN.
//
// Reported from a device 2026-08-29, immediately after the seat-colour fix:
// "the color of me and opponent is now fixed and always the selected color. But
// the dice that flies when placed is in the opposite color still".
//
// Both halves of that are one mechanism. A die resolves its own colour from the
// pair it INHERITS (`:where(#kbroot) .die.p1{--dc:var(--p1)}`), and a ranked
// table swaps that pair onto #tableEl when the server seated the viewer as p2,
// so `--p1` keeps meaning "you". But a die in flight is not on the table: it is
// a copy pinned into the fx root, which is the APP ROOT — outside the swap, and
// therefore wearing the player's stored pair unswapped. So the traveller left in
// the opponent's colour and landed in the player's own.
//
// It could only ever show from seat 0, which is the seat offline play never
// hands out — the same blind spot that hid the original seat-colour bug. It has
// nothing to do with who moves first: BOTH travellers are wrong in such a
// match, exactly swapped with each other, because the unswapped pair is what
// they all inherit. So both are measured here — asserting only the player's own
// would pass on a blanket repaint that painted the whole table one colour.
//
// ASSERT THE RESOLVED COLOUR, not which token was named: a var() chain can be
// valid, inherited, and still the wrong colour. The ghost is caught by a
// MutationObserver rather than by polling, because it lives for 300ms and a
// missed frame would silently turn this into a test that asserts nothing —
// hence `sawGhost`, checked before anything is concluded from it.

/* Seat 1 opens (projectRankedActions always starts at ME), so one committed
   placement is what hands the turn to a viewer seated at 0. */
const SEED = [{ who: 1, col: 0, nextDie: 5 }];

export async function runFlyingDieColourScenarios({ visit, out, check }) {
  const seen = await visit({
    named: true, skipStandardProbes: true, door: 'match',
    trialMatch: { you: 0, seedPlacements: SEED },
    probe: async (page) => {
      await page.waitForSelector('#botBoard .col[data-col="1"]', { timeout: 15000 });
      await page.evaluate(() => {
        /* Paint a throwaway node with the token and read it back — the only
           thing that settles what the player actually saw. */
        window.__kbResolve = (host, property) => {
          if (!host) return null;
          const probe = document.createElement('span');
          probe.style.color = `var(${property})`;
          probe.style.display = 'none';
          host.appendChild(probe);
          const value = getComputedStyle(probe).color;
          probe.remove();
          return value;
        };
        window.__kbGhosts = [];
        const table = document.getElementById('tableEl');
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (!(node instanceof HTMLElement) || !node.classList.contains('die')) continue;
              if (table?.contains(node)) continue;      // a die landing IN the table
              window.__kbGhosts.push({
                /* --dc is what a die hands to its own faces. */
                colour: window.__kbResolve(node, '--dc'),
                /* The CLASS follows the protocol seat and must keep doing so —
                   only the inherited pair is what this fix moves. */
                seatClass: node.classList.contains('p1') ? 'p1' : 'p2',
              });
            }
          }
        }).observe(document.getElementById('kbroot'), { childList: true, subtree: true });
      });
      await page.tap('#botBoard .col[data-col="1"]');
      /* Two travellers: mine at tap time, then the bot's after its full turn
         beat (a random think of up to ~2.8s sits inside that). */
      await page.waitForFunction(() => window.__kbGhosts.length >= 2, null, { timeout: 20000 })
        .catch(() => undefined);
      return page.evaluate(() => ({
        ghosts: window.__kbGhosts,
        you: window.__kbOnline?.()?.you ?? null,
        mine: window.__kbResolve(document.getElementById('sideBot'), '--c'),
        theirs: window.__kbResolve(document.getElementById('sideTop'), '--c'),
      }));
    },
  });
  out.flyingDieColour = seen.probeResult;
  const r = seen.probeResult;

  check(!!r && r.you === 0,
    'the probe did not reach a match seated at 0, which is the only seat that shows this', r);
  check(!!r && !!r.mine && !!r.theirs && r.mine !== r.theirs,
    'the two sides of the table resolve to the same colour — this probe cannot tell them apart', r);
  /* Seated at 0, MY die carries the p2 class and the OPPONENT'S carries p1 —
     the protocol seat, untouched. Finding both by class rather than by arrival
     order also proves the fix did not quietly renumber the seats. */
  const mineGhost = r?.ghosts?.find((g) => g.seatClass === 'p2') ?? null;
  const theirGhost = r?.ghosts?.find((g) => g.seatClass === 'p1') ?? null;
  check(!!mineGhost && !!theirGhost,
    'both dice were never seen in flight, so nothing below is measuring them', r);
  /* THE assertion, as the player reported it. */
  check(!!mineGhost && mineGhost.colour === r.mine,
    'MY FLYING DIE WEARS THE OPPONENT\'S COLOUR — it leaves in one colour and '
    + 'lands in the other, because the fx root sits outside the table that '
    + 'swapped the pair for this viewer', r);
  check(!!theirGhost && theirGhost.colour === r.theirs,
    'THE OPPONENT\'S FLYING DIE WEARS MY COLOUR — the same swap, the other way '
    + 'round; both travellers are wrong in a seat-0 match, not just mine', r);
}
