// Chrome icons — the glyphs that belong to the FRAME rather than to any
// registry (modes have modeicons.ts, spells have spellicons.ts). Same stroke
// language as those: 24×24, stroke-based, on currentColor.
//
// Presentation only and pure, so the design cards render these through the app
// itself (design/build.mjs, the ico token) instead of carrying transcriptions —
// the HUD's button had already been copied into three cards by hand.
const PATHS: Record<string, string> = {
  /* A doorway with an arrow leaving it: the way OUT of the match. This was a
     sliders glyph while the button opened Settings, and it kept saying
     "adjust something" long after the button had become the one question the
     HUD can usefully ask — so the icon was promising a screen that no longer
     existed. A door promises the thing the button actually does. */
  leave: '<path d="M9.6 4.6H6.3A1.9 1.9 0 0 0 4.4 6.5v11a1.9 1.9 0 0 0 1.9 1.9h3.3"/>'
    + '<path d="M15.7 8.2 19.5 12l-3.8 3.8"/><path d="M19.5 12H9.9"/>',
};

export function chromeIcon(id: string, size = 15): string {
  const body = PATHS[id] ?? '';
  return `<svg class="cico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" `
    + `aria-hidden="true">${body}</svg>`;
}
