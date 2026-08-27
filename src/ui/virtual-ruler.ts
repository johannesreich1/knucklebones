/* THE RULER: where every row of a list sits, including the ones nobody has
   looked at yet.
   A windowed list keeps a handful of rows mounted but has to describe the whole
   board — the scrollbar spans the season, not the window — so something has to
   answer "how far down is row 4,000?" for a row that has never had a box. This
   does, by remembering the height of every slot it has been TOLD about and
   estimating the rest from the average of those.
   It is deliberately free of the DOM: heights arrive as numbers from whoever
   measured them, which is what makes the arithmetic testable in Node and keeps
   the one hard part of a virtual list out of the part that touches elements. */

export interface Ruler {
  /** How many slots the list believes in. */
  readonly count: number;
  /** The height used for a slot nobody has measured — the mean of those we have. */
  readonly unit: number;
  /** How many slots carry a real measurement. */
  readonly measured: number;
  /** Record a slot's measured BOX height, excluding the gap after it. */
  measure(index: number, height: number): void;
  /** Content y of slot k's top edge, for k in [0, count]. */
  top(index: number): number;
  /** Modelled height of the whole list: count boxes and count-1 gaps. */
  readonly total: number;
  /** The slot whose box contains content y. Clamped into range. */
  at(y: number): number;
  /** The population changed. Heights are keyed by POSITION, and the positions
      moved, so they are dropped — but the average row height is a property of
      the design rather than of any row, so that survives as the new estimate. */
  resize(count: number): void;
  /** Every height is suspect: the viewport width changed, or the locale did.
      Keeps the count, drops the measurements, keeps the running average. */
  forget(): void;
}

export function createRuler(count: number, gap: number, seed: number): Ruler {
  let n = Math.max(0, count | 0);
  let height = new Float64Array(n);
  let known = new Uint8Array(n);
  /* Sum and tally of the measured heights, so the estimate is O(1) rather than
     a scan. They are the ONLY things resize/forget carry across. */
  let sum = 0;
  let tally = 0;
  /* Prefix sums over [0, k): measured height, and how many were measured. One
     O(n) rebuild per invalidation makes top() O(1), which matters because the
     frame loop calls it for both pads and for at() on every scroll.
     A Fenwick tree would make the rebuild O(log n) and is the documented
     escape hatch if a season ever reaches six figures; at a few thousand rows
     this pass is microseconds and has no update path to drift. */
  let prefixHeight = new Float64Array(n + 1);
  let prefixKnown = new Int32Array(n + 1);
  let stale = true;

  const unit = (): number => (tally > 0 ? sum / tally : seed);

  const rebuild = (): void => {
    let runningHeight = 0;
    let runningKnown = 0;
    prefixHeight[0] = 0;
    prefixKnown[0] = 0;
    for (let i = 0; i < n; i++) {
      if (known[i]) {
        runningHeight += height[i];
        runningKnown += 1;
      }
      prefixHeight[i + 1] = runningHeight;
      prefixKnown[i + 1] = runningKnown;
    }
    stale = false;
  };

  const top = (index: number): number => {
    const k = index < 0 ? 0 : index > n ? n : index;
    if (stale) rebuild();
    /* measured slots contribute their real height, the rest the estimate, and
       every slot above k contributes one gap */
    return prefixHeight[k] + unit() * (k - prefixKnown[k]) + gap * k;
  };

  /* resize and forget are the same act with a different count: drop every
     position-keyed height, and carry the LEARNED row height forward as the new
     estimate. Keeping them one function is what stopped resize() from silently
     reverting to the construction seed and re-estimating a measured board with
     a number nobody had believed since the first frame. */
  const reset = (next: number): void => {
    seed = unit();
    n = Math.max(0, next | 0);
    height = new Float64Array(n);
    known = new Uint8Array(n);
    prefixHeight = new Float64Array(n + 1);
    prefixKnown = new Int32Array(n + 1);
    sum = 0;
    tally = 0;
    stale = true;
  };

  return {
    get count() { return n; },
    get unit() { return unit(); },
    get measured() { return tally; },

    measure(index: number, boxHeight: number): void {
      if (index < 0 || index >= n) return;
      /* An element that has not been laid out measures 0, and a hidden panel
         measures 0 for everything in it. Recording that would poison both the
         estimate and every pad derived from it, so a zero is never a
         measurement — it is the absence of one. */
      if (!(boxHeight > 0)) return;
      if (known[index] && Math.abs(height[index] - boxHeight) < 0.5) return;
      sum += boxHeight - (known[index] ? height[index] : 0);
      if (!known[index]) {
        known[index] = 1;
        tally += 1;
      }
      height[index] = boxHeight;
      stale = true;
    },

    top,

    get total() {
      /* count boxes but only count-1 gaps: the last row has nothing after it */
      return n === 0 ? 0 : top(n) - gap;
    },

    at(y: number): number {
      if (n === 0) return 0;
      if (y <= 0) return 0;
      if (stale) rebuild();
      /* top() is monotone, so bisect for the last slot whose top edge is at or
         above y. Answers "the thumb was dropped here — which row is that?" */
      let low = 0;
      let high = n - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (top(middle) <= y) low = middle;
        else high = middle - 1;
      }
      return low;
    },

    resize(next: number): void {
      if ((next | 0) === n) return;
      reset(next);
    },

    forget(): void {
      reset(n);
    },
  };
}
