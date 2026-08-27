// A MODAL LEFT STANDING IS THE PREVIOUS SCENARIO'S BUG, NOT THE NEXT ONE'S.
//
// Several browser trees run many scenarios against ONE page, because booting
// the app per scenario would cost more than the whole suite. That sharing has
// exactly one hazard, and it has now bitten four separate scenarios:
//
//   a scenario opens a sheet, returns without dismissing it, and PASSES —
//   the sheet covers inset:0, so the NEXT scenario's every click is caught by
//   a card it never opened. Playwright spends its full 30s timeout on a
//   perfectly good selector and then reports the interceptor:
//   `<div class="faceoff solo fofly"> intercepts pointer events`.
//
// Every part of that message points at the wrong scenario. The one that broke
// the rule is green and already forgotten; the one that gets the red is
// innocent, and the class it is told about belongs to a card that has nothing
// to do with it. Each instance so far was patched at the VICTIM — a wait added
// to whichever probe happened to die — which fixes one pairing and leaves the
// rule unenforced for the next.
//
// So the invariant lives here, between scenarios, and it says the cause out
// loud the way tests/support/rendering-font.mjs names a wrong-font host: the
// scenario that LEFT the modal is the thing named, as a problem against it.
//
// WHAT COUNTS AS "A MODAL IN THE ROOM". Not one CSS class. A settled sheet
// keeps `fofly` (only a drag takes it off) and a dismissing one already wears
// `foout`, whose `pointer-events:none` means it is NOT swallowing anything —
// so class names describe neither side of this rule. Two signals do:
//
//   1. THE APP'S OWN. `sheetOpen()` in src/ui/sheet.ts is the single `live`
//      sheet the whole game shares; test-hooks publishes it as
//      `__kb.sheet.open()`. When the app is reachable this is authoritative.
//   2. THE PAINT. src/ui/modal-background.ts is what MAKES a layer modal here:
//      it holds every sibling in the app root `inert`. Both modal owners in
//      src/ use it (ui/sheet.ts and ui/legal.ts), so "a full-room layer whose
//      siblings are all inert, which answers elementFromPoint at the centre of
//      the screen" is the class of thing rather than a list of selectors — and
//      it still catches a modal on a page where `__kb` was never installed.
//
// A sheet mid-exit trips signal 1 for ~190ms (`live` clears when the flight
// ends), so the read is allowed to settle before anything is called a leak.
// That is the only softening here: a dismissal in progress is a dismissal.

/** Read the room: what the app says, and what a finger at the centre hits. */
const probeRoom = () => {
  const hooks = /** @type {any} */ (window).__kb;
  const asks = typeof hooks?.sheet?.open === 'function';
  const signal = asks ? hooks.sheet.open() === true : null;

  const root = document.getElementById('kbroot');
  const width = window.innerWidth, height = window.innerHeight;
  const describe = (el) => el && ({
    id: el.id || null,
    cls: typeof el.className === 'string' ? el.className : null,
    dialog: el.querySelector?.('[role="dialog"]')?.getAttribute('aria-label') ?? null,
    heading: el.querySelector?.('.fh,.focard h2,.lbtitle')?.textContent?.trim() ?? null,
  });

  let blocker = null;
  if (root) {
    const hit = document.elementFromPoint(Math.round(width / 2), Math.round(height / 2));
    const layers = [...root.children].filter((el) => el instanceof HTMLElement);
    for (const el of layers) {
      const siblings = layers.filter((other) => other !== el);
      // THE MODAL CONTRACT (ui/modal-background): this layer, and only this
      // layer, is live. A plain paged screen never inerts its neighbours.
      if (!siblings.length || !siblings.every((other) => other.inert) || el.inert) continue;
      const style = getComputedStyle(el);
      if (style.pointerEvents === 'none' || style.display === 'none'
        || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < width * 0.9 || rect.height < height * 0.9) continue;
      // and it is what the finger actually reaches, not merely what is in the DOM
      if (!hit || !(hit === el || el.contains(hit))) continue;
      blocker = { ...describe(el), hitAtCentre: describe(hit) };
      break;
    }
  }
  return { signal, hooked: asks, blocker, rootFound: !!root };
};

/** True when something is still standing between the next click and the app. */
export const roomOccupied = (room) => !!room && (room.signal === true || !!room.blocker);

/** One read of the room. Returns null when the page is already gone. */
export async function readRoom(page) {
  try {
    return await page.evaluate(probeRoom);
  } catch {
    return null;   // navigated, closed, or torn down — nothing to guard
  }
}

/** Read, allowing an exit flight already under way to finish first. */
export async function settledRoom(page, settleMs = 1200) {
  const deadline = Date.now() + settleMs;
  let room = await readRoom(page);
  while (roomOccupied(room) && Date.now() < deadline) {
    await page.waitForTimeout(50);
    room = await readRoom(page);
  }
  return room;
}

/**
 * Put the room back the way the app itself would. The next scenario must start
 * from a state the app could actually be in, so the doors are tried in the
 * order a player has them; tearing the node out is a last resort and is
 * reported as one, never done silently.
 */
export async function clearRoom(page) {
  const doors = [];
  try {
    const closed = await page.evaluate(() => {
      const close = /** @type {any} */ (window).__kb?.sheet?.close;
      // the app's own `closeOpenSheet` — the same call ui/firstrun.ts makes
      return typeof close === 'function' ? close(false) : null;
    });
    doors.push(`__kb.sheet.close()=${closed}`);
  } catch {
    doors.push('__kb.sheet.close() unavailable');
  }
  if (!roomOccupied(await settledRoom(page, 800))) return { cleared: true, doors };

  // the door every modal in this app answers, sheet or legal page
  try {
    await page.keyboard.press('Escape');
    doors.push('Escape');
  } catch {
    doors.push('Escape unavailable');
  }
  if (!roomOccupied(await settledRoom(page, 800))) return { cleared: true, doors };

  /* Neither of the app's own doors answered — a finding in its own right. Take
     the layer off anyway so ONE leak cannot turn into a run of unrelated red
     scenarios, and say plainly that this is what happened. */
  try {
    const removed = await page.evaluate(() => {
      const root = document.getElementById('kbroot');
      const layers = [...(root?.children ?? [])].filter((el) => el instanceof HTMLElement);
      const stuck = layers.filter((el) => !el.inert
        && layers.some((other) => other !== el && other.inert));
      for (const el of stuck) { el.remove(); }
      for (const el of layers) { el.inert = false; }
      return stuck.map((el) => el.id || el.className || el.tagName);
    });
    doors.push(`forced removal of ${JSON.stringify(removed)}`);
  } catch {
    doors.push('forced removal failed');
  }
  return { cleared: false, doors };
}

const detailOf = (room, cleanup) => JSON.stringify({
  signal: room?.signal ?? null,
  hooked: room?.hooked ?? null,
  blocker: room?.blocker ?? null,
  cleanup,
});

/**
 * THE INVARIANT, stated against whoever broke it.
 *
 * `who` names the scenario that has just finished — it is the subject of the
 * sentence on purpose. `endsWithModal` is the ONE way to opt out, and it is a
 * declaration rather than a loosening: a scenario that claims it and leaves
 * the room clean fails too, so the flag cannot quietly become a blanket
 * exemption for a scenario that later stops leaving a modal open.
 *
 * Returns `{ leaked, problem, room, cleanup }`; `problem` is null when the
 * scenario kept its promise.
 */
export async function inspectRoomAfter(page, who, options = {}) {
  const declared = options.endsWithModal === true;
  const room = await settledRoom(page, options.settleMs ?? 1200);
  if (room === null) return { leaked: false, problem: null, room: null, cleanup: null };

  const occupied = roomOccupied(room);
  if (!occupied) {
    return {
      leaked: false,
      room,
      cleanup: null,
      problem: declared
        ? `${who} declares endsWithModal, but it left the room empty. Drop the `
          + 'declaration: an unused exemption is a guard that has stopped '
          + `guarding this scenario. :: ${detailOf(room, null)}`
        : null,
    };
  }

  // clean whether or not it was declared — the next scenario starts fresh either way
  const cleanup = await clearRoom(page);
  if (declared) return { leaked: false, problem: null, room, cleanup };

  const named = room.blocker
    ? `${room.blocker.dialog ?? room.blocker.heading ?? room.blocker.id ?? 'a card'}`
      + ` (${room.blocker.id ? '#' + room.blocker.id + ' ' : ''}${room.blocker.cls ?? '?'})`
    : 'a sheet the app still reports as open';
  const forced = cleanup.cleared
    ? ''
    : ' Worse: neither the sheet\'s own close() nor Escape dismissed it, so the harness '
      + 'had to tear the layer out to keep the rest of the run meaningful.';

  return {
    leaked: true,
    room,
    cleanup,
    problem: `${who} LEFT A MODAL STANDING on the shared page — ${named}. It covers `
      + 'the room and still answers the hit test at the centre of the screen, so every '
      + 'click the scenarios after it make would have landed on this card instead of on '
      + 'the app. Read this line, not the next scenario\'s timeout: without this guard the '
      + 'failure surfaces 30s later somewhere innocent, as "intercepts pointer events" '
      + 'naming a card that scenario never opened. Dismiss it before returning — the '
      + `sheet's own doors are the grabber, the backdrop and Escape.${forced} `
      + `:: ${detailOf(room, cleanup)}`,
  };
}

/**
 * Runner-facing form: check the room after `who`, push any problem into the
 * suite's own `problems` array, and leave the page clean for the next scenario.
 */
export async function guardRoomAfter(page, who, problems, options = {}) {
  const report = await inspectRoomAfter(page, who, options);
  if (report.problem) problems.push(report.problem);
  return report;
}
