// Spell icons — same deal as ui/modeicons: stroke-based 24×24 SVGs on
// currentColor, keyed off the registry's stable ids, so the shared core stays
// free of markup and a spell can be re-skinned without touching its rules.
const PATHS: Record<string, string> = {
  /* two columns trading places — one arrow each way between them. The stacks
     are kept narrow so the arrows own the middle: at 22px the gap is what
     reads, not the outlines. */
  swap: '<rect x="2.2" y="4.4" width="5.6" height="15.2" rx="1.9"/>'
      + '<rect x="16.2" y="4.4" width="5.6" height="15.2" rx="1.9"/>'
      + '<path d="M9 9.4h6M12.8 7.4l2.4 2-2.4 2"/>'
      + '<path d="M15 14.6H9M11.2 12.6l-2.4 2 2.4 2"/>',
};

/* one hue per spell: the rune's glow, its ring and its dragged ghost */
const HUES: Record<string, string> = { swap: '#b18cff' };

export function spellHue(id: string): string { return HUES[id] ?? '#b18cff'; }

export function spellIcon(id: string, size = 22): string {
  const body = PATHS[id] ?? PATHS.swap;
  return `<svg class="sico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" `
    + `aria-hidden="true">${body}</svg>`;
}
