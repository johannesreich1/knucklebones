/* WHAT THE BOARD LOOKS LIKE, separate from how the endpoints answer about it.
   Kept apart because these are the numbers a test reasons about — a population,
   a rank, a season depth — while routes.mjs is the cursor arithmetic that
   serves them. */

/** The ladder as the RPC returns it, including the dense `pos` and the
    population added by 20260827203007. A mock that omits a field a migration
    added keeps a broken client green, and `pos` is load-bearing: the client
    places a page by it. */
export function ladderBoardFixture(spec) {
  if (!spec) return null;
  const { population, myRank } = spec === true ? { population: 151, myRank: 145 } : spec;
  return Array.from({ length: population }, (_, index) => {
      const rank = index + 1;
      const points = 610 - rank;
      const mine = rank === myRank;
      return {
        nickname: mine ? 'TestGuest001' : `Player${String(rank).padStart(3, '0')}`,
        points,
        wins: mine ? 42 : rank % 17,
        losses: mine ? 61 : rank % 13,
        games: mine ? 103 : rank % 17 + rank % 13,
        rank,
        /* The dense ordinal and the board size, exactly as the deployed RPC
           answers since 20260827203007. A mock that omits a new field keeps a
           broken client green, and this one is load-bearing: the client reads
           pos to place a page and would otherwise silently fall back to
           counting from a cursor. */
        pos: rank,
        population,
        apex: rank === 1,
        avatar: mine ? 'die:5:cy' : null,
        peak: mine ? 700 : points + 20,
      };
    })
}

/** A season of finished matches in (finished_at desc, id desc) order — the
    order 20260823132602_history_index_order gives, and the order the compound
    cursor walks. The first three rows are byte-identical to the fixed page this
    stub used to serve, so the profile's RECENT strip and every localization
    probe keep asserting exactly what they always did. */
export function historySeasonFixture(historyDepth) {
  const HEAD = [
      { id: '00000000-0000-4000-8000-000000000003', finished_at: '2026-08-21T12:00:00Z',
        opponent: 'NovaComet992', mode: 'classic', mine: 47, theirs: 31, delta: 21, result: 'win' },
      { id: '00000000-0000-4000-8000-000000000002', finished_at: '2026-08-20T12:00:00Z',
        opponent: 'ZestyPixel950', mode: 'classic', mine: 22, theirs: 38, delta: -14, result: 'loss' },
      { id: '00000000-0000-4000-8000-000000000001', finished_at: '2026-08-19T12:00:00Z',
        opponent: 'BoldRaven393', mode: 'classic', mine: 29, theirs: 29, delta: 12, result: 'draw' },
    ];
  const season = [...HEAD, ...Array.from({ length: historyDepth }, (_, index) => {
      const n = index + 4;
      const day = String(18 - (index % 17)).padStart(2, '0');
      return {
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        finished_at: `2026-08-${day}T${String(23 - (index % 24)).padStart(2, '0')}:00:00Z`,
        opponent: `Rival${String(n).padStart(3, '0')}`,
        mode: 'classic',
        mine: 20 + (n % 30), theirs: 15 + (n % 25), delta: (n % 7) - 3,
        result: n % 3 === 0 ? 'win' : n % 3 === 1 ? 'loss' : 'draw',
      };
    })];
    /* finished_at desc, id desc — the order 20260823132602_history_index_order
       gives, and the order the compound cursor walks. */
    const key = (row) => `${row.finished_at}|${row.id}`;
  season.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
  return season;
}
