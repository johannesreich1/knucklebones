/* WHAT THE LIST KNOWS, AND HOW IT ASKS FOR MORE.
   Every row ever fetched is kept, keyed by its position in the sequence, so
   crawling back over ground already covered is pure DOM work at zero network
   cost. That is not an optimisation: it is what lets the window be trimmed at
   all, because re-entering a trimmed region has to be instant or the reader
   feels the list stall where it used to be solid.

   Pages are written HERE and never to the DOM. The window is rebuilt from
   (cache, viewport) every frame, so a page that lands after the reader has
   moved on is simply free cache rather than a race to guard against — the
   whole class of "a fetch resolved into a view that no longer exists" bug is
   designed out rather than handled.

   The cache stores DATA, never rendered nodes. A pool of detached elements
   would strand pre-languagechange copy: crawl away, switch language, crawl
   back, and the German reader gets English rows. Re-rendering from data is
   always current. */

export interface VirtualPage<T> {
  rows: readonly T[];
  /** Position of rows[0]. The SOURCE owns this number: only it knows whether
      the backend hands out positions or they must be counted from a cursor.
      Inferring it here is how a tie block silently shears. */
  position: number;
}

export interface VirtualAnchor<T> { item: T; position: number }

/** Which directions this sequence can travel. A source that omits `before`
    grows only at the tail; one that omits `seek` cannot be jumped into, which
    is the honest behaviour for a list with no random access. */
export interface VirtualSource<T> {
  after(anchor: VirtualAnchor<T> | null, count: number): Promise<VirtualPage<T>>;
  before?(anchor: VirtualAnchor<T>, count: number): Promise<VirtualPage<T>>;
  seek?(position: number, count: number): Promise<VirtualPage<T>>;
}

export interface VirtualCache<T> {
  get(position: number): T | undefined;
  positionOf(key: string): number | undefined;
  /** Ask for whatever covers this position, by the cheapest route that exists. */
  request(position: number): void;
  /** How many rows the sequence is believed to hold. */
  count(): number;
  setTotal(total: number | null): void;
  destroy(): void;
}

export interface VirtualCacheSpec<T> {
  source: VirtualSource<T>;
  key(item: T): string;
  page: number;
  total?: number | null;
  /** Positions whose data just arrived, so their boxes need re-measuring. */
  changed(positions: readonly number[]): void;
}

export function createVirtualCache<T>(spec: VirtualCacheSpec<T>): VirtualCache<T> {
  const { source, page: PAGE } = spec;
  const rows = new Map<number, T>();
  const at = new Map<string, number>();
  const claimed = new Set<number>();
  const inFlight = new Map<string, Promise<void>>();
  let furthest = -1;
  let end: number | null = null;
  let declared: number | null = spec.total ?? null;
  let dead = false;

  const remember = (result: VirtualPage<T>): void => {
    const touched: number[] = [];
    result.rows.forEach((item, offset) => {
      const position = result.position + offset;
      const key = spec.key(item);
      const had = at.get(key);
      /* A key turning up at a NEW position means the board moved under us — the
         bot cutoff in the ladder flips globally the moment the 100th human
         settles a match. The newer sighting wins and the stale slot reverts to
         unknown, so a seam shows neither a duplicate nor a hole. */
      if (had !== undefined && had !== position) {
        rows.delete(had);
        touched.push(had);
      }
      rows.set(position, item);
      at.set(key, position);
      if (position > furthest) furthest = position;
      touched.push(position);
    });
    /* A short page is how the end of a sequence announces itself. It is the
       only authority: `total` is a hint and can be stale or absent. */
    if (result.rows.length < PAGE) {
      const reached = result.position + result.rows.length;
      if (end === null || reached > end) end = reached;
    }
    if (touched.length) spec.changed(touched);
  };

  const fetch = (kind: string, from: number, run: () => Promise<VirtualPage<T>>): void => {
    const id = `${kind}:${from}`;
    /* Identical requests share one promise, and the range they will fill is
       claimed, so a second frame does not re-ask for rows already on the way.
       Because writes are idempotent by position, an overlap that slips through
       costs a request and can never corrupt. */
    if (inFlight.has(id)) return;
    for (let i = from; i < from + PAGE; i++) claimed.add(i);
    const job = run()
      .then((result) => { if (!dead) remember(result); })
      .catch(() => { /* the slot stays a tombstone; a later frame retries */ })
      .finally(() => {
        inFlight.delete(id);
        for (let i = from; i < from + PAGE; i++) claimed.delete(i);
        if (!dead) spec.changed([]);
      });
    inFlight.set(id, job);
  };

  return {
    get: (position) => rows.get(position),
    positionOf: (key) => at.get(key),

    request(position: number): void {
      if (dead || rows.has(position) || claimed.has(position)) return;
      const above = rows.get(position - 1);
      if (above !== undefined) {
        fetch('after', position, () => source.after({ item: above, position: position - 1 }, PAGE));
        return;
      }
      const below = rows.get(position + 1);
      if (below !== undefined && source.before) {
        fetch('before', position, () =>
          source.before!({ item: below, position: position + 1 }, PAGE));
        return;
      }
      if (source.seek) {
        /* Land with the target in the middle of the page, so a thumb drop has
           rows on both sides of where it aimed rather than starting at it. */
        const from = Math.max(0, position - (PAGE >> 1));
        fetch('seek', from, () => source.seek!(from, PAGE));
        return;
      }
      /* Forward-only, and nothing adjacent is held: the only legal move is to
         start again from the beginning of the sequence. */
      if (position === 0) fetch('after', 0, () => source.after(null, PAGE));
    },

    count(): number {
      if (end !== null) return end;
      if (declared !== null) return declared;
      /* Nothing has told us where this ends, so believe in one page beyond the
         furthest row held. The board grows as the reader travels. */
      return furthest + 1 + PAGE;
    },

    setTotal(total: number | null): void { declared = total; },
    destroy(): void { dead = true; },
  };
}
