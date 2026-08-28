/* WHAT A WINDOWED LIST BELIEVES ABOUT ITS OWN LENGTH, and which fetch it
   reaches for. Both answers are pure functions of the pages that have landed,
   so they belong in Node: the frame loop clamps its window to count(), which
   makes a wrong count invisible in the DOM — the rows simply are not there and
   are never asked for again.
   The shipped bug this pins: a page shorter than PAGE was read as the end of
   the sequence in EITHER direction. A `before` page is short exactly when it
   reaches rank 1, so a gentle pull up a 153-row ladder announced "the board
   ends at 19" and everything below vanished for good (user report, on device:
   "past 40 I see nothing anymore and it doesn't load anything"). */
import { createVirtualCache, type VirtualAnchor, type VirtualPage } from '../src/ui/virtual-cache.ts';

const problems: string[] = [];
const errs: string[] = [];
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(`${what} :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};

/** Every fetch this cache has in flight has settled. */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

interface Row { nickname: string; rank: number; pos: number }

/* A board with dense ranks and the dense `pos` the RPC has carried since
   20260827203007 — the ladder places a page BY pos, so a fixture without it
   would exercise a fallback no deployment uses. */
const makeBoard = (population: number): Row[] =>
  Array.from({ length: population }, (_, index) => ({
    nickname: `P${String(index + 1).padStart(3, '0')}`, rank: index + 1, pos: index + 1,
  }));

const positioned = (rows: Row[], fallback: number): VirtualPage<Row> =>
  ({ rows, position: rows[0]?.pos !== undefined ? rows[0].pos - 1 : fallback });

/* The ladder's three cursors, with the SQL's own arithmetic: `leaderboard`
   forward and by from_pos, `leaderboard_before` backward. The log is what makes
   every assertion below non-vacuous — a claim about the `before` route means
   nothing unless the route was actually taken. */
function ladderSource(board: Row[], log: string[]) {
  return {
    after: async (anchor: VirtualAnchor<Row> | null, count: number) => {
      log.push(anchor ? `after@${anchor.position}` : 'after@head');
      return positioned(
        anchor ? board.filter((row) => row.rank > anchor.item.rank).slice(0, count)
          : board.slice(0, count),
        anchor ? anchor.position + 1 : 0,
      );
    },
    before: async (anchor: VirtualAnchor<Row>, count: number) => {
      log.push(`before@${anchor.position}`);
      const rows = board.filter((row) => row.rank < anchor.item.rank).slice(-count);
      return positioned(rows, Math.max(0, anchor.position - rows.length));
    },
    seek: async (position: number, count: number) => {
      log.push(`seek@${position}`);
      return positioned(board.filter((row) => row.pos >= position + 1).slice(0, count), position);
    },
  };
}

const held = (cache: { get(position: number): Row | undefined }, from: number): number => {
  let lowest = from;
  while (lowest > 0 && cache.get(lowest - 1) !== undefined) lowest -= 1;
  return lowest;
};

const PAGE = 25;
const OPEN_PAGE = 100;                       // ladder-screen's opening page

try {
  /* ---- THE BUG: pulling up to the top must not shorten the board --------
     153 rows, the reader opening on rank 145 — production's shape on the day
     this was reported. The opening seek lands at 94, so every step upward is a
     `before` page, and the fourth one runs out of board after 19 rows. */
  {
    const board = makeBoard(153);
    const log: string[] = [];
    const source = ladderSource(board, log);
    const opening = await source.seek(94, OPEN_PAGE);
    const cache = createVirtualCache<Row>({
      source,
      key: (row) => row.nickname,
      page: PAGE,
      total: 153,
      seed: { ...opening, asked: OPEN_PAGE },
      changed: () => {},
    });
    eq(opening.rows.length, 59, 'the opening seek must land 59 rows, or the crawl below is not the reported one');
    eq(cache.count(), 153, 'the seeded board spans the whole season');

    const counts: number[] = [];
    let lowest = held(cache, 94);
    for (let pull = 0; pull < 6 && lowest > 0; pull += 1) {
      cache.request(lowest - 1);
      await settle();
      lowest = held(cache, lowest);
      counts.push(cache.count());
    }
    eq(lowest, 0, 'the crawl must reach the top of the board, or nothing below is being measured');
    eq(log.filter((call) => call.startsWith('before')).length, 4,
       'the crawl must travel by the BACKWARD route — this is the route that carried the bug');
    eq(counts.every((count) => count === 153), true,
       'A SHORT `before` PAGE MUST NOT END THE BOARD. It has run out of sequence at the '
       + `START, not at the end; reading it as the end collapsed 153 rows to 19. Saw ${JSON.stringify(counts)}`);
    eq(cache.get(152)?.rank, 153, 'the last row is still held after the crawl');
  }

  /* ---- forward is still allowed to end the sequence --------------------- */
  {
    const board = makeBoard(60);
    const log: string[] = [];
    const source = ladderSource(board, log);
    const opening = await source.after(null, PAGE);
    const cache = createVirtualCache<Row>({
      source, key: (row) => row.nickname, page: PAGE, total: null,
      seed: { ...opening, asked: PAGE }, changed: () => {},
    });
    cache.request(25);
    await settle();
    cache.request(50);
    await settle();
    eq(log.filter((call) => call.startsWith('after')).length, 3,
       'the walk down must use the forward route');
    eq(cache.count(), 60,
       'a short FORWARD page is still how the end of a sequence announces itself');
  }

  /* ---- a page is short against ITS OWN ASK, not against PAGE ------------
     The opening page asks for 100 and PAGE is 25, so measuring it against PAGE
     reads a final page of 59 rows as a full one and leaves the reader with a
     band of tombstones under the last real row. */
  {
    const board = makeBoard(153);
    const source = ladderSource(board, []);
    const opening = await source.seek(94, OPEN_PAGE);
    const cache = createVirtualCache<Row>({
      source, key: (row) => row.nickname, page: PAGE, total: null,
      seed: { ...opening, asked: OPEN_PAGE }, changed: () => {},
    });
    eq(cache.count(), 153,
       'a seed shorter than its ask ends the board, with no `total` to lean on');
  }
  {
    const board = makeBoard(153);
    const source = ladderSource(board, []);
    const opening = await source.seek(0, PAGE);
    const cache = createVirtualCache<Row>({
      source, key: (row) => row.nickname, page: PAGE, total: null,
      seed: { ...opening, asked: PAGE }, changed: () => {},
    });
    eq(cache.count(), 50,
       'a seed exactly as long as its ask ends nothing: believe in one page beyond it');
  }

  /* ---- the count can never be smaller than the rows in hand ------------- */
  {
    const board = makeBoard(153);
    const source = ladderSource(board, []);
    const opening = await source.seek(94, 59);
    const cache = createVirtualCache<Row>({
      source, key: (row) => row.nickname, page: PAGE,
      /* A stale hint. `population` is read from a row that may be minutes old,
         and a count below what is held unmounts rows the reader is looking at
         and then never asks for them again. */
      total: 19,
      seed: { ...opening, asked: 59 }, changed: () => {},
    });
    eq(cache.count(), 153, 'a stale `total` cannot be smaller than the rows already held');
    cache.setTotal(4);
    eq(cache.count(), 153, 'nor can a later one');
  }

  /* ---- the cheapest route, and the span a page claims -------------------
     `before` anchored at p+1 delivers [p+1-PAGE, p] — it ENDS where the request
     began. Claiming the wrong span left every row the page was already bringing
     unclaimed, so the next frame asked for them all over again. */
  {
    const board = makeBoard(153);
    const log: string[] = [];
    const source = ladderSource(board, log);
    const opening = await source.seek(94, OPEN_PAGE);
    const cache = createVirtualCache<Row>({
      source, key: (row) => row.nickname, page: PAGE, total: 153,
      seed: { ...opening, asked: OPEN_PAGE }, changed: () => {},
    });
    cache.request(93);
    for (let position = 92; position >= 69; position -= 1) cache.request(position);
    eq(log, ['seek@94', 'before@94'],
       'one backward page covers the whole span it will fill; the rows it is already '
       + 'bringing must not be asked for a second time');
    await settle();

    cache.request(200);
    await settle();
    eq(log[log.length - 1], 'seek@188',
       'a position with nothing adjacent is entered by seek, centred on the target');

    cache.request(153);
    await settle();
    eq(log[log.length - 1], 'after@152',
       'a position whose row above is held is reached by the forward cursor');
  }
} catch (error) {
  errs.push(String(error));
}

console.log(JSON.stringify({ problems, errs }, null, 2));
