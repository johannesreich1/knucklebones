// THE REVEAL'S ANSWERS, as markup and nothing else.
//
// Pure string builders, split from the shell (ui/reveal.ts) because they have a
// second reader: design/build.mjs renders the pairing and both answer shapes
// through THESE functions ({{versus}}, {{wsettled}}, {{wanswer}}), so a design
// card can never re-type a mode's name or blurb and drift from the registry.
// Keeping them here also keeps the shell's own file about sequencing.
import { formatNumber, t } from '../i18n/index.ts';
import type { Answer, DialSide } from './reveal-types.ts';

export const esc = (value: string): string => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));

/* one side of the versus line — the .dav slot is filled by paintAvatar after
   the innerHTML write, so the avatar has exactly one renderer (ui/avatar.ts) */
function sideHtml(p: DialSide, cls: 'me' | 'foe'): string {
  const rating = p.rating != null ? `<span class="rt">${formatNumber(p.rating)}</span>` : '';
  return `<span class="dside ${cls}"><span class="dav"></span>` +
         `<span class="dnm">${esc(p.name)}</span>${rating}</span>`;
}
/* Both ratings are shown; the DIFFERENCE between them is not. It is arithmetic
   the player can do if they care, and printing it turns a duel into a forecast.
   Exported for the same reason settledAnswer and answerLines below are: the
   design build renders the pairing through THIS function ({{versus}}), and the
   two dial cards had been carrying a hand-written one-line "Opponent NAME ·
   RATING" — the pre-study treatment this replaced — for as long as it existed. */
export function versus(me: DialSide, foe: DialSide): string {
  return sideHtml(me, 'me') + `<span class="dvs">${t('common', 'versus')}</span>` + sideHtml(foe, 'foe');
}

/* An answer that is done being looked at, kept where it can still be read. It
   exists so a second beat does not erase the first one's result: the mode
   settles into the top half and is still on screen — RULE AND ALL — when the
   rune is dealt, which is what makes ONE countdown honest for BOTH answers.
   It keeps the blurb, not just the name: "COLUMN SHIELD" on its own is a label,
   and the line under it is the half that says what you are about to play. Same
   line, same class, as the readout under the stage.
   Pure, and exported, because the design build renders these two through the
   very same functions ({{wsettled}}, {{wanswer}}): a card that re-typed a
   mode's blurb would be one more copy of the registry. */
export function ownerEyebrow(context?: string, hue?: string, id?: string): string {
  const idAttr = id ? ` id="${id}"` : '';
  const hueAttr = hue ? ` style="color:${hue}"` : '';
  const hiddenAttr = context ? '' : ' hidden';
  return `<small class="wowner"${idAttr}${hueAttr}${hiddenAttr}>`
    + `<span class="wownername">${context ? esc(context) : ''}</span></small>`;
}

export const settledAnswer = (b: Answer): string =>
  `<div class="wsett${b.context ? ' wowned' : ''}" style="color:${b.hue}">`
  + `<span class="wanswerhead">`
  + `${b.context ? ownerEyebrow(b.context, b.contextHue ?? b.hue) : ''}`
  + `<span class="wpill">${b.icon}<b>${esc(b.name)}</b></span></span>`
  + `<span class="wblurb">${esc(b.blurb)}</span></div>`;

/** the readout under the stage — what a landed beat says, and its colour */
export const answerLines = (b: Answer): string =>
  `<div class="wname" style="color:${b.hue}">${b.icon} ${esc(b.name)}</div>`
  + `<div class="wblurb">${esc(b.blurb)}</div>`;
