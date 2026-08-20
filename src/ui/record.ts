// A player's record, in ONE shape.
//
// Three screens state the same fact — the HUD badge, the account card, and
// every leaderboard row — and they had drifted into three phrasings: the
// ladder said "42W/103", wins over games, so a LOSS never appeared on it at
// all. One string now, and the caller's CSS decides how loud it is: the HUD
// tints .n1 cyan and .n2 magenta, and the same markup renders plain wherever
// that rule does not reach.
//
// Pure and DOM-free, so it is offline-reachable and the design cards can
// render it through the app itself.

/* Two labelled numbers, the game's own way of putting a score side by side.
   The numbers carry .n1/.n2 rather than leaning on bare <b>/<i>: the HUD used
   to tint them with `.rec b` / `.rec i`, which meant the same markup rendered
   ITALIC anywhere that rule did not reach — and the ladder is exactly such a
   place. The classes make the shape travel with the string; colour stays the
   landing site's business. */
export const scoreLine = (aLabel: string, a: number, bLabel: string, b: number): string =>
  `${aLabel} <b class="n1">${a}</b> · ${bLabel} <i class="n2">${b}</i>`;

export const recordHtml = (wins: number, losses: number): string =>
  scoreLine('W', wins, 'L', losses);
