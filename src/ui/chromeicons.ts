// Chrome icons — the glyphs that belong to the FRAME rather than to any
// registry (modes have modeicons.ts, spells have spellicons.ts). Same stroke
// language as those: 24×24, stroke-based, on currentColor.
//
// Presentation only and pure, so the design cards render these through the app
// itself (design/build.mjs, the ico token) instead of carrying transcriptions —
// the HUD's button had already been copied into three cards by hand.
const PATHS: Record<string, string> = {
  /* The selected play mark (design option 01): one canted die with three
     pips. Unlike a generic triangle, it belongs to this game's language and
     still reads as dice at the 25px size used by primary actions. */
  play: '<g transform="rotate(-8 12 12)"><rect x="4.5" y="4.5" width="15" height="15" rx="3.4"/>'
    + '<circle cx="8.5" cy="8.5" r="1.25" fill="currentColor" stroke="none"/>'
    + '<circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/>'
    + '<circle cx="15.5" cy="15.5" r="1.25" fill="currentColor" stroke="none"/></g>',
  /* A doorway with an arrow leaving it: the way OUT of the match. This was a
     sliders glyph while the button opened Settings, and it kept saying
     "adjust something" long after the button had become the one question the
     HUD can usefully ask — so the icon was promising a screen that no longer
     existed. A door promises the thing the button actually does. */
  leave: '<path d="M9.6 4.6H6.3A1.9 1.9 0 0 0 4.4 6.5v11a1.9 1.9 0 0 0 1.9 1.9h3.3"/>'
    + '<path d="M15.7 8.2 19.5 12l-3.8 3.8"/><path d="M19.5 12H9.9"/>',
  /* The triangle every platform uses for "this did not happen", drawn in the
     same stroke language as the rest. It rides currentColor, so the surface
     that shows it — today the account screen's warning sheet — supplies the
     amber rather than the glyph baking a second orange into source. */
  warn: '<path d="M12 4.3 2.9 19.4h18.2Z"/><path d="M12 10v4.2"/><path d="M12 17.4h.01"/>',
  /* Time running out, for the away card. It replaced an ⏳ emoji, which wore
     whichever hourglass the platform happened to ship — a colour and a weight
     the app never chose, beside glyphs that are all one stroke. The waist
     pinches at the centre so the shape still reads at 26px, and the sand is
     the same stroke rather than a fill, so it inherits the player's colour
     with everything else on the card. */
  hourglass: '<path d="M7.2 4.2h9.6"/><path d="M7.2 19.8h9.6"/>'
    + '<path d="M8.4 4.2v2.7c0 1.5 1.1 2.5 2.5 3.7L12 12l-1.1 1.4c-1.4 1.2-2.5 2.2-2.5 3.7v2.7"/>'
    + '<path d="M15.6 4.2v2.7c0 1.5-1.1 2.5-2.5 3.7L12 12l1.1 1.4c1.4 1.2 2.5 2.2 2.5 3.7v2.7"/>'
    + '<path d="M10.3 17.6h3.4"/>',
};

export function chromeIcon(id: string, size = 15): string {
  const body = PATHS[id] ?? '';
  return `<svg class="cico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" `
    + `aria-hidden="true">${body}</svg>`;
}
