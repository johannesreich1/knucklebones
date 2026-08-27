// The gate that keeps an iOS fling alive. Every branch here corresponds to a
// way a programmatic scrollTop write can be felt by the reader as a jolt, so
// each one is exercised against a fake clock rather than waited out.
import { watchScrollSettled } from '../src/ui/scroll-settled.ts';

const problems: string[] = [];
const errs: string[] = [];
const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(`${what} :: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
};

/* A scroller with just enough surface for the gate: listeners, and the three
   numbers that decide elastic overscroll. */
function fakeScroller(scrollHeight = 5000, clientHeight = 800) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    scrollTop: 0,
    scrollHeight,
    clientHeight,
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
    fire(type: string) { for (const fn of [...(listeners.get(type) ?? [])]) fn(); },
    count(type: string) { return listeners.get(type)?.size ?? 0; },
  };
}

let clock = 10_000;
const now = () => clock;
const stand = (scrollHeight?: number, clientHeight?: number) => {
  const el = fakeScroller(scrollHeight, clientHeight);
  let wakes = 0;
  const gate = watchScrollSettled(el as unknown as HTMLElement, () => { wakes++; }, now);
  return { el, gate, wakes: () => wakes };
};

/* ---- at rest, a write is free ------------------------------------------ */
{
  const { gate } = stand();
  eq([gate.settled(), gate.touchDriven(), gate.elastic()], [true, false, false],
     'an untouched, still scroller must allow a write immediately');
  gate.destroy();
}

/* ---- a finger owns the scroller ---------------------------------------- */
{
  const { el, gate } = stand();
  el.fire('touchstart');
  eq([gate.settled(), gate.touchDriven()], [false, true],
     'no write may land while a finger is down');
  el.fire('touchend');
  eq(gate.settled(), false, 'the gesture keeps its tail after touchend');
  clock += 149;
  eq(gate.settled(), false, '149ms is still inside the rest window');
  clock += 2;
  eq(gate.settled(), true, 'past the rest window a write is allowed again');
  gate.destroy();
}

/* ---- momentum is silence, not an event --------------------------------- */
/* scrollend is Safari 26.2+, so on most of the installed iOS base THIS is the
   path that runs. It gets the same coverage as the event path for that reason. */
{
  const { el, gate } = stand();
  el.fire('scroll');
  eq(gate.settled(), false, 'a scroll that just fired means the list is moving');
  clock += 149;
  eq(gate.settled(), false, 'still moving one frame short of the quiet window');
  clock += 2;
  eq(gate.settled(), true, 'a quiet scroller has stopped');
  gate.destroy();
}

/* ---- multi-touch: the rest window starts at the LAST finger ------------- */
{
  const { el, gate } = stand();
  el.fire('touchstart');
  el.fire('touchstart');
  el.fire('touchend');
  clock += 500;
  eq(gate.settled(), false, 'one finger lifting does not end a two-finger gesture');
  el.fire('touchend');
  clock += 151;
  eq(gate.settled(), true, 'the rest window runs from the last finger up');
  gate.destroy();
}

/* ---- elastic overscroll is a hard veto --------------------------------- */
{
  const { el, gate } = stand(5000, 800);          // maximum scrollTop is 4200
  clock += 1000;
  el.scrollTop = -5;
  eq([gate.elastic(), gate.settled()], [true, false],
     'the top rubber band must veto a write');
  el.scrollTop = 4300;
  eq([gate.elastic(), gate.settled()], [true, false],
     'the bottom rubber band must veto a write');
  /* THE ASSERTION THAT MATTERS AT THE END OF A LIST. scrollHeight and
     clientHeight are integer-rounded while scrollTop is subpixel, so a settled
     bottom legitimately reads a fraction past the computed maximum. Judged at
     half a pixel this reports "never settled" and the write that squares the
     last pad never fires. */
  el.scrollTop = 4201;
  eq([gate.elastic(), gate.settled()], [false, true],
     'a subpixel overshoot at the bottom is rounding, not a rubber band');
  el.scrollTop = 0;
  eq(gate.settled(), true, 'back inside the range a write is allowed');
  gate.destroy();
}

/* ---- the caller is woken, so it never has to poll ---------------------- */
{
  const { el, gate, wakes } = stand();
  el.fire('scroll');
  eq(wakes() >= 1, true, 'a scroll wakes the caller to retry a refused write');
  gate.destroy();
}

/* ---- destroy really detaches ------------------------------------------- */
{
  const { el, gate } = stand();
  const before = ['touchstart', 'touchend', 'touchcancel', 'scroll']
    .map((type) => el.count(type));
  gate.destroy();
  const after = ['touchstart', 'touchend', 'touchcancel', 'scroll']
    .map((type) => el.count(type));
  eq([before, after], [[1, 1, 1, 1], [0, 0, 0, 0]],
     'destroy must remove every listener it added');
}

/* ---- scrollend, where the engine offers it ----------------------------- */
{
  const saved = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = { onscrollend: null };
  const { el, gate } = stand();
  el.fire('scroll');
  eq(gate.settled(), false, 'still moving');
  el.fire('scrollend');
  eq(gate.settled(), true, 'scrollend settles immediately, without waiting out the timer');
  gate.destroy();
  if (saved === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = saved;
}

console.log(JSON.stringify({ problems, errs }, null, 2));
