// THE RUNE YOU CARRY, IN THE SEAT THAT GATES IT.
//
// The equipped rune shipped (20260828210000) with nothing able to watch it. The
// client reads it with a THIRD query against `profiles` — `select=equipped_rune`
// — and the harness told its profile reads apart with a single
// `url.includes('ranked_pool_tier')`. So the equipped read fell through to the
// account-profile branch and was answered with `{id, nickname, rating,
// named_at}`: a row with no equipped_rune in it. The seat could only ever paint
// empty, and every suite agreed with it. Nothing was red; nothing was covered.
//
// So this pins the read END TO END — the stub's column reaches the cache, the
// cache reaches the seat, and the seat paints — rather than any one hop.
//
// The gate is `SEAT_LIVE_GROUPS` in account-runes.ts: an equipped rune is only
// LIVE from SILVER up, and below that the seat says it is waiting. Both sides
// are covered, because a threshold tested from one side is not tested.

const SEAT = () => {
  const seat = document.getElementById('accSeat');
  if (!seat) return null;
  const rect = seat.getBoundingClientRect();
  const icon = seat.querySelector('svg');
  const iconRect = icon?.getBoundingClientRect() ?? null;
  /* --rh is the rune's own hue, and it is set inline per rune. Resolve it the
     only way that proves a colour reached the screen. */
  const probe = document.createElement('span');
  probe.style.color = 'var(--rh)';
  probe.style.display = 'none';
  seat.appendChild(probe);
  const hue = getComputedStyle(probe).color;
  probe.remove();
  return {
    hidden: seat.hidden,
    none: seat.classList.contains('none'),
    waiting: seat.classList.contains('waiting'),
    label: seat.getAttribute('aria-label') ?? '',
    hue,
    painted: rect.width > 0 && rect.height > 0,
    hasIcon: !!icon && !!iconRect && iconRect.width > 0 && iconRect.height > 0,
    /* AN EMPTY SEAT DRAWS SOMETHING TOO. It wears a dashed socket now, so
       "there is an icon" no longer means "a rune is seated" — that distinction
       is what the auto-equip guard below actually rests on, and reading it off
       the mere presence of an icon would have quietly stopped guarding. */
    hasRune: !!icon && !!iconRect && iconRect.width > 0 && iconRect.height > 0
      && !icon.classList.contains('seatnone'),
    hasSocket: !!seat.querySelector('.seatnone'),
  };
};

/* The default door is the home chip, which IS the door to the profile, so the
   panel is already open by the time a probe runs. Wait for the grid the seat
   sits beside rather than a timer. */
const readSeat = async (page) => {
  await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
  return page.evaluate(SEAT);
};

export async function runEquippedSeatScenarios({ visit, out, check }) {
  const collected = ['fate', 'ward', 'pilfer'];

  /* BONE (465 points) carries a rune but may not use it yet. */
  const waiting = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward',
    probe: readSeat,
  });
  out.equippedSeatWaiting = waiting.probeResult;
  const w = waiting.probeResult;
  check(!!w && !w.hidden && w.painted,
    'a player holding runes has no equipped seat on screen at all', w);
  check(!!w && !w.none && w.hasRune,
    'THE EQUIPPED RUNE NEVER REACHED THE SEAT — it painted as empty', w);
  check(!!w && w.waiting,
    'below SILVER the seat did not say the carried rune is still waiting', w);
  check(!!w && /WARD/i.test(w.label),
    'the seat does not name the rune it is holding', w);

  /* SILVER and above: the same rune, now in play. */
  const live = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: 'ward', standingPoints: 1400,
    probe: readSeat,
  });
  out.equippedSeatLive = live.probeResult;
  const l = live.probeResult;
  check(!!l && !l.none && l.hasRune && !l.waiting,
    'from SILVER up the carried rune is still shown as waiting', l);
  check(!!l && /WARD/i.test(l.label),
    'the live seat does not name the rune it is holding', l);
  /* The hue is the rune's, not the panel's — the same rune from both sides of
     the threshold, so a seat that lost its colour cannot pass as gated. */
  check(!!w && !!l && w.hue === l.hue && !!l.hue,
    'the seat changed the rune\'s colour across the SILVER threshold', { w, l });

  /* Nothing equipped: the seat is present but empty, and says so. */
  const empty = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: null,
    probe: readSeat,
  });
  out.equippedSeatEmpty = empty.probeResult;
  const e = empty.probeResult;
  check(!!e && !e.hidden && e.none && !e.hasRune && e.hasSocket,
    'with nothing equipped the seat still painted a rune', e);
  check(!!e && e.label.length > 0 && !/WARD/i.test(e.label),
    'the empty seat is unlabelled or still names the last rune', e);

  /* ONE RUNE, EMPTY SEAT — the exact condition the removed auto-equip fired on
     (`collected.length === 1 && equipped === null`). Winning a first rune used
     to seat it without asking; that was removed 2026-08-28 by owner call, to be
     solved differently. A player holding their first rune is therefore expected
     to sit at 'none' until they choose, and a refresh must not quietly fill the
     seat behind them — which is what the old convenience write did. */
  const firstRune = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: ['ward'], equippedRune: null,
    probe: readSeat,
  });
  out.equippedSeatFirstRune = firstRune.probeResult;
  const f = firstRune.probeResult;
  check(!!f && !f.hidden && f.none && !f.hasRune && f.hasSocket,
    'A FIRST RUNE SEATED ITSELF — the removed auto-equip is back', f);

  /* ---- THE SEAT IS A DOOR YOU CAN CHOOSE THROUGH ---- */
  const picked = await visit({
    named: true, member: true, skipStandardProbes: true,
    runes: collected, equippedRune: null,
    probe: async (page) => {
      await page.waitForSelector('#accRuneGrid', { timeout: 10000 });
      const before = await page.evaluate(SEAT);
      await page.click('#accSeat');
      /* Tolerated on purpose: with no picker this simply never appears, and a
         bare timeout would fail the suite as "THREW" and name nothing. Let the
         assertions below describe the missing door instead. */
      await page.waitForSelector('.faceoff .accrune', { timeout: 8000 })
        .catch(() => undefined);
      const offered = await page.evaluate(() => ({
        /* Only what the account HOLDS is offered: the database would refuse
           anything else, so showing it would be a door onto a refusal. */
        runes: [...document.querySelectorAll('.faceoff .accrune')]
          .map((button) => button.dataset.rune),
        detail: (document.querySelector('.faceoff .mcdetail')?.textContent ?? '').trim(),
      }));
      /* Same reason as the wait above: a missing button must reach the checks
         as a described absence, not as an unexplained throw. */
      await page.click('.faceoff .accrune[data-rune="pilfer"]', { timeout: 4000 })
        .catch(() => undefined);
      await page.waitForTimeout(700);
      return { before, offered, after: await page.evaluate(SEAT) };
    },
  });
  out.equippedSeatPicker = picked.probeResult;
  const p = picked.probeResult;

  check(!!p && !p.before.hasRune && p.before.hasSocket,
    'the picker probe did not start from an empty seat', p);
  check(!!p && p.offered.runes.length > 0,
    'TAPPING THE SEAT OFFERS NO RUNES AT ALL — it opens with nothing to choose, '
    + 'which is the dead end this replaced', p);
  check(!!p && String(p.offered.runes) === String(collected),
    'the seat offered something other than the runes this account holds', p);
  /* THE assertion: the seat is where you CHOOSE, not just where you look. */
  check(!!p && p.after.hasRune && !p.after.none,
    'TAPPING THE SEAT DOES NOT LET YOU CARRY A RUNE — it explains itself and '
    + 'sends you elsewhere, so the one thing the seat is for cannot be done '
    + 'from it', p);
  /* ...and the words match what it now does, rather than pointing at the grid. */
  check(!!p && p.offered.detail.length > 0 && !/collected and carry it/i.test(p.offered.detail),
    'the seat still explains itself with the old copy that sent the player away', p);
}
