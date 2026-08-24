// Mode icons — the game's own visual language, not font glyphs. Stroke-based
// 24×24 SVGs on currentColor, so they take any mode hue and glow via CSS.
// Presentation only: the shared core registry (core/modes.ts) stays free of
// markup; this map keys off the registry's stable ids. Design source of
// truth: design/screens/product/05-mode-icons.html (synced to Claude Design).
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
  /* a column of pips, one of them struck — victimsOf takes the FIRST match,
     which is the die closest to the centre line, not the outermost one (the
     comment said outermost until 2026-08-22; core/rules.ts:136 is the truth) */
  singlestrike: '<circle class="f" cx="12" cy="6.2" r="1.5"/><circle class="f" cx="12" cy="12" r="1.5"/>'
    + '<circle class="f" cx="12" cy="17.8" r="1.5"/><path d="M8.6 2.8 15.4 9.6M15.4 2.8 8.6 9.6"/>',
  /* a coin carrying the banked BOUNTY mark */
  bounty: '<circle cx="12" cy="12" r="8.2"/>'
    + '<path class="f" fill="currentColor" stroke="none" d="M12 5.1C12.7 9.5 14.3 11.1 18.9 12C14.3 12.9 12.7 14.5 12 18.9C11.3 14.5 9.7 12.9 5.1 12C9.7 11.1 11.3 9.5 12 5.1Z"/>',
  /* a small stack of dice — the finite bag */
  limited: '<rect x="4.4" y="13" width="6.6" height="6.6" rx="1.8"/><rect x="13" y="13" width="6.6" height="6.6" rx="1.8"/>'
    + '<rect x="8.7" y="4.4" width="6.6" height="6.6" rx="1.8"/><circle class="f" cx="12" cy="7.7" r="1.2"/>',
  /* two arrows crossing — the dial will decide */
  random: '<path d="M3.4 7.6h3.9l9.3 8.8h3.9M3.4 16.4h3.9l9.3-8.8h3.9"/>'
    + '<path d="M18.1 4.6 20.9 7.6 18.1 10.6M18.1 13.4 20.9 16.4 18.1 19.4"/>',
};

/* per-mode hues — the mode's colour EVERYWHERE (wheel segments, match badge,
   the game-modes library): classic neutral, then the game's own palette,
   destruction orange for SINGLE STRIKE, money green for BOUNTY.
   RAW hue tokens, never --p1/--p2: a mode's identity does not change clothes
   when Settings trades or repaints the duel pair. */
const HUES: Record<string, string> = {
  classic: '#8ea3c0', rowswitch: 'var(--cy)', rowmult: 'var(--mg)',
  colshield: 'var(--gold)', singlestrike: 'var(--orange)', bounty: 'var(--green)',
  limited: 'var(--violet)',
  /* RANDOM wears no mode's colour, because it could become any of them */
  random: '#e9f1ff',
};
export function modeHue(id: string): string { return HUES[id] ?? HUES.classic; }
export function modeIconBody(id: string): string { return PATHS[id] ?? PATHS.classic; }

export function modeIcon(id: string, size = 14): string {
  const body = modeIconBody(id);
  return `<svg class="mico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" `
    + `aria-hidden="true">${body}</svg>`;
}
