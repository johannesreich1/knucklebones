// Spell icons — same deal as ui/modeicons: stroke-based 24×24 SVGs on
// currentColor, keyed off the registry's stable ids, so the shared core stays
// free of markup and a spell can be re-skinned without touching its rules.
import { modeIcon, modeHue } from './modeicons.ts';
import { RANDOM_DUAL_SPELL, RANDOM_SPELL } from '../core/spells.ts';
const PATHS: Record<string, string> = {
  /* NONE: the picker's first slice — no rune at all */
  none: '<circle cx="12" cy="12" r="8.4"/><path d="M6.1 6.1 17.9 17.9"/>',
  /* FATE: a die tossed back — one face leaving on a return arrow */
  fate: '<rect x="7.6" y="7.6" width="8.8" height="8.8" rx="2.2"/>'
      + '<circle cx="12" cy="12" r=".4" fill="currentColor"/>'
      + '<path d="M19.6 8.2A8.5 8.5 0 0 0 5 6.9M4.4 15.8A8.5 8.5 0 0 0 19 17.1"/>'
      + '<path d="M5.6 3.4 5 6.9l3.5.6M18.4 20.6l.6-3.5-3.5-.6"/>',
  /* NUDGE: a die with one pip rising out of it */
  nudge: '<rect x="6.4" y="9.4" width="9.6" height="9.6" rx="2.4"/>'
       + '<circle cx="11.2" cy="14.2" r=".4" fill="currentColor"/>'
       + '<path d="M17.6 8V3.2M15.4 5.4l2.2-2.2 2.2 2.2"/>',
  /* WARD: a shield with a single spark inside — one strike, absorbed */
  ward: '<path d="M12 3.4 18.8 6v5.4c0 4.6-2.9 7.6-6.8 9.2-3.9-1.6-6.8-4.6-6.8-9.2V6Z"/>'
      + '<path d="M12 8.2l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3Z"/>',
  /* SUNDER: a bolt splitting three columns at once */
  sunder: '<path d="M4.2 5v5.4M9.4 5v3M14.6 5v5.4M19.8 5v3"/>'
        + '<path d="M13.4 9.8 9 15.4h3.4L9.8 20.6l6.4-6.8h-3.4l2.4-4Z"/>',
  /* ANVIL: a die squared up on the anvil's face, waisted body, wide base.
     Symmetric about x=12 — the first draft hung a horn off the right and the
     die read as sitting BESIDE the anvil rather than on it. */
  anvil: '<rect x="8.6" y="2.6" width="6.8" height="6.8" rx="1.9"/>'
       + '<circle cx="12" cy="6" r=".45" fill="currentColor"/>'
       + '<path d="M4.6 12.8h14.8"/>'
       + '<path d="M8.9 12.8 7.8 17.2h8.4l-1.1-4.4"/>'
       + '<path d="M5.6 20.6h12.8"/>',
  /* PILFER: one die lifted across the centre line by a hooked arrow */
  pilfer: '<path d="M3.4 12.6h17.2" stroke-dasharray="2.4 2.6"/>'
        + '<rect x="13.4" y="3.6" width="7" height="7" rx="1.8"/>'
        + '<circle cx="16.9" cy="7.1" r=".4" fill="currentColor"/>'
        + '<path d="M10.6 7.1H7.2a2.6 2.6 0 0 0-2.6 2.6v8.7M2.4 16.2l2.2 2.2 2.2-2.2"/>',
};

/* one hue per spell: the rune's glow, its ring, its dragged ghost and its
   slice in the picker. NONE wears the neutral grey CLASSIC uses. */
const HUES: Record<string, string> = {
  none: '#8ea3c0',
  fate: '#b18cff',      // violet — chance rewoven
  nudge: '#7fd7ff',     // sky — the smallest push
  ward: 'var(--wdc)',   // mint normally; hot red in colour-blind mode
  sunder: '#ff9d66',    // ember — the widened strike
  pilfer: '#ffd166',    // gold — theft
  anvil: '#ff7591',     // forge heat — the metal worked, not the flame
};

/* RANDOM is not a rune — it is the same PROMISE the mode row makes, so it
   wears that row's mark and hue rather than a copy of them. A hand-copied
   glyph already drifted here: the mode's shuffle is TWO paths (the crossing
   lines and the arrowheads) and the copy took only the first, so the spell
   row showed a bare X next to the mode row's arrows. Asking is the fix that
   cannot drift again. */
export function spellHue(id: string): string {
  return id === RANDOM_SPELL || id === RANDOM_DUAL_SPELL
    ? modeHue('random') : (HUES[id] ?? '#b18cff');
}

export function spellIcon(id: string, size = 22): string {
  if (id === RANDOM_SPELL) return modeIcon('random', size);
  if (id === RANDOM_DUAL_SPELL) {
    /* TWO DIFFERENT DRAWS, not Random with a damaged corner. At the picker's
       real 16px size a numeral badge cannot stay readable without covering an
       arrowhead. Two outward-dealt cards make the count the silhouette; their
       different sigils and player colours say that the hands are not shared. */
    return `<svg class="sico sico-random2" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" `
      + `stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" `
      + `aria-hidden="true">`
      + `<path class="r2card r2one" stroke="var(--p1)" d="M3.8 6.5 10.2 5.2l1.4 12.5-6.4 1.2Z"/>`
      + `<path class="r2card r2two" stroke="var(--p2)" d="m13.8 5.2 6.4 1.3-1.4 12.4-6.4-1.2Z"/>`
      + `<circle class="r2sigil r2one" cx="7.7" cy="12" r="1.15" fill="var(--p1)" stroke="none"/>`
      + `<path class="r2sigil r2two" d="m16.3 10.45 1.55 1.55-1.55 1.55-1.55-1.55Z" `
      + `fill="var(--p2)" stroke="none"/></svg>`;
  }
  const body = PATHS[id] ?? PATHS.none;
  return `<svg class="sico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" `
    + `aria-hidden="true">${body}</svg>`;
}
