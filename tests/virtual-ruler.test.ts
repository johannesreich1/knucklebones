// The ruler's arithmetic, pinned. A virtual list is only as honest as this: the
// pads it writes, the scrollbar it spans and the row a dropped thumb lands on
// are all differences of top(). Everything here is pure, so it runs in Node and
// fails loudly long before a browser is involved.
import { createRuler } from '../src/ui/virtual-ruler.ts';

const problems: string[] = [];
const errs: string[] = [];
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(`${what} :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};
const near = (got: number, want: number, what: string, tol = 1e-9) => {
  if (!(Math.abs(got - want) <= tol)) {
    problems.push(`${what} :: got ${got}, want ${want}`);
  }
};

/* ---- an empty board is not a special case ------------------------------ */
const empty = createRuler(0, 5, 49);
eq([empty.count, empty.total, empty.top(0), empty.at(0), empty.at(999)],
   [0, 0, 0, 0, 0], 'an empty ruler must answer without a special case');

/* ---- nothing measured: every slot is the seed -------------------------- */
/* COUNT boxes but COUNT-1 gaps. Getting this wrong is a whole gap of drift at
   the bottom of the board, which is exactly where a clamp is asserted. */
const cold = createRuler(10, 5, 49);
near(cold.total, 10 * 49 + 9 * 5, 'a cold ruler must span its boxes and the gaps BETWEEN them');
near(cold.top(0), 0, 'slot 0 starts at the origin');
near(cold.top(1), 49 + 5, 'the next slot starts one box and one gap down');
near(cold.top(10), 10 * 49 + 10 * 5, 'top(count) is past the last gap');
eq(cold.measured, 0, 'a cold ruler has measured nothing');
near(cold.unit, 49, 'a cold ruler estimates with its seed');

/* ---- measuring changes only what it should ----------------------------- */
const warm = createRuler(5, 5, 40);
warm.measure(0, 60);
warm.measure(1, 60);
warm.measure(2, 60);
warm.measure(3, 60);
warm.measure(4, 60);
eq(warm.measured, 5, 'five measurements were recorded');
near(warm.unit, 60, 'the estimate is the mean of what has been measured');
near(warm.total, 5 * 60 + 4 * 5, 'a fully measured ruler spans exactly its rows');
/* the property the pads rest on: consecutive tops differ by box + gap */
for (let i = 0; i < 5; i++) {
  near(warm.top(i + 1) - warm.top(i), 65, `slot ${i} advances by its box and one gap`);
}

/* ---- a zero is the ABSENCE of a measurement, never a measurement -------- */
/* An unmounted element and a hidden panel both measure 0. Recording that would
   poison the estimate and every pad derived from it. */
const guarded = createRuler(3, 5, 44);
guarded.measure(0, 0);
guarded.measure(1, -12);
guarded.measure(2, Number.NaN);
eq([guarded.measured, guarded.unit], [0, 44],
   'zero, negative and NaN heights must not be recorded as measurements');

/* ---- mixed: measured rows are exact, the rest are estimated ------------- */
const mixed = createRuler(6, 5, 50);
mixed.measure(2, 100);
near(mixed.unit, 100, 'one measurement becomes the estimate for the rest');
near(mixed.top(3) - mixed.top(2), 105, 'the measured slot contributes its real height');
near(mixed.total, 6 * 100 + 5 * 5, 'the estimate fills in for every unmeasured slot');

/* ---- at() is the inverse of top(), which is what a thumb drag needs ----- */
const board = createRuler(200, 5, 46);
for (let i = 0; i < 200; i += 3) board.measure(i, 40 + (i % 7) * 4);
let roundTrips = 0;
for (let k = 0; k < 200; k++) {
  if (board.at(board.top(k)) === k) roundTrips++;
}
eq(roundTrips, 200, 'every slot must be found at its own top edge');
eq(board.at(board.top(7) + 0.5), 7, 'a point inside a slot resolves to that slot');
eq(board.at(-50), 0, 'above the board resolves to the first slot');
eq(board.at(board.total + 5000), 199, 'below the board resolves to the last slot');
let monotone = true;
for (let k = 1; k <= 200; k++) if (board.top(k) < board.top(k - 1)) monotone = false;
eq(monotone, true, 'top() must never go backwards');

/* ---- the population changed under us ----------------------------------- */
/* The bot cutoff in ladder_read_boundaries flips globally when the 100th human
   settles a match: the board collapses mid-session and every position moves.
   Heights are keyed by POSITION so they have to go — but the average row height
   belongs to the design, not to any row, so it is kept as the new estimate. */
const shifting = createRuler(153, 5, 46);
for (let i = 0; i < 153; i++) shifting.measure(i, 52);
near(shifting.unit, 52, 'the ruler learned the real row height');
shifting.resize(12);
eq([shifting.count, shifting.measured], [12, 0],
   'a population change drops position-keyed heights');
near(shifting.unit, 52, 'a population change KEEPS the learned row height as the estimate');
near(shifting.total, 12 * 52 + 11 * 5, 'the resized board is spanned with the learned unit');

/* ---- the width or the locale changed ----------------------------------- */
const rerendered = createRuler(20, 5, 46);
for (let i = 0; i < 20; i++) rerendered.measure(i, 58);
rerendered.forget();
eq([rerendered.count, rerendered.measured], [20, 0], 'forget() drops every measurement');
near(rerendered.unit, 58, 'forget() keeps the learned row height');

/* ---- out of range is a no-op, not a crash ------------------------------ */
const edges = createRuler(4, 5, 44);
edges.measure(-1, 90);
edges.measure(4, 90);
edges.measure(9999, 90);
eq(edges.measured, 0, 'measurements outside the board are ignored');
near(edges.top(-3), 0, 'top() clamps below the board');
near(edges.top(99), edges.top(4), 'top() clamps above the board');

console.log(JSON.stringify({ problems, errs }, null, 2));
