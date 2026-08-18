// Mode icons — the game's own visual language, not font glyphs. Stroke-based
// 24×24 SVGs on currentColor, so they take any mode hue and glow via CSS.
// Presentation only: the shared core registry (core/modes.ts) stays free of
// markup; this map keys off the registry's stable ids. Design source of
// truth: design/screens/05-mode-icons.html (synced to Claude Design).
const PATHS: Record<string, string> = {
  /* a die seen on its point — the pure game */
  classic: '<path d="M12 3.2 20.8 12 12 20.8 3.2 12Z"/><circle class="f" cx="12" cy="12" r="1.7"/>',
  /* three rows */
  rowswitch: '<path d="M4.5 6.5h15M4.5 12h15M4.5 17.5h15"/>',
  /* rows, plus more */
  rowmult: '<path d="M4.5 6.5h9M4.5 12h9M4.5 17.5h9M18.7 9v6M15.7 12h6"/>',
  /* a shield guarding a column of pips */
  colshield: '<path d="M12 3 19 5.8V12c0 4.6-4.4 7.6-7 8.9C9.4 19.6 5 16.6 5 12V5.8Z"/>'
    + '<circle class="f" cx="12" cy="8.4" r="1.3"/><circle class="f" cx="12" cy="12.2" r="1.3"/><circle class="f" cx="12" cy="16" r="1.3"/>',
  /* a column of pips, only the outermost struck */
  singlestrike: '<circle class="f" cx="12" cy="6.2" r="1.5"/><circle class="f" cx="12" cy="12" r="1.5"/>'
    + '<circle class="f" cx="12" cy="17.8" r="1.5"/><path d="M8.6 2.8 15.4 9.6M15.4 2.8 8.6 9.6"/>',
  /* a coin banking its +1 */
  bounty: '<circle cx="12" cy="12" r="8.2"/><path d="M12 8.6v6.8M8.6 12h6.8"/>',
  /* a small stack of dice — the finite bag */
  limited: '<rect x="4.4" y="13" width="6.6" height="6.6" rx="1.8"/><rect x="13" y="13" width="6.6" height="6.6" rx="1.8"/>'
    + '<rect x="8.7" y="4.4" width="6.6" height="6.6" rx="1.8"/><circle class="f" cx="12" cy="7.7" r="1.2"/>',
};

/* per-mode hues — the mode's colour EVERYWHERE (wheel segments, match badge,
   the game-modes library): classic neutral, then the game's own palette,
   destruction orange for SINGLE STRIKE, money green for BOUNTY */
const HUES: Record<string, string> = {
  classic: '#8ea3c0', rowswitch: '#28e8ff', rowmult: '#ff2fa0',
  colshield: '#ffd166', singlestrike: '#ff8a3d', bounty: '#7ee787',
  limited: '#b18cff',
};
export function modeHue(id: string): string { return HUES[id] ?? HUES.classic; }

export function modeIcon(id: string, size = 14): string {
  const body = PATHS[id] ?? PATHS.classic;
  return `<svg class="mico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" `
    + `aria-hidden="true">${body}</svg>`;
}
