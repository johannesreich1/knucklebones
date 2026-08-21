// The avatar: a die face and a hue, "die:5:cy". 36 identities, no storage
// bucket, no moderation, and no user-generated-image obligations at review.
// The string shape is the seam: a later value can be "img:<path>".
//
// Lives in ui/ (not online/) because the HOME plate paints it at boot, before
// any online code loads — and anything the offline game can show must not pull
// in the online chunk. The account panel and the avatar picker import from
// here; there is exactly one reading of the avatar string.
import { ME } from '../core/rules.ts';
import { makeDie } from './die.ts';

/* raw hue tokens, never --p1/--p2: a picked avatar keeps its colour whatever
   the Settings pickers do to the duel pair */
export const AV_HUES: Record<string, string> = {
  cy: 'var(--cy)', mg: 'var(--mg)', gold: 'var(--gold)',
  green: 'var(--green)', violet: 'var(--violet)', orange: 'var(--orange)',
};
export const DEFAULT_AVATAR = 'die:5:cy';

export function parseAvatar(v: string | null | undefined): { face: number; hue: string } {
  const m = /^die:([1-6]):([a-z]+)$/.exec(v ?? '');
  return m && AV_HUES[m[2]] ? { face: +m[1], hue: m[2] } : { face: 5, hue: 'cy' };
}

/* one die, tinted — --dc is what the die's pips and border read for colour */
export function paintAvatar(slot: HTMLElement, v: string | null | undefined, size = 74): void {
  const { face, hue } = parseAvatar(v);
  slot.innerHTML = '';
  const die = makeDie(face, ME);
  die.style.setProperty('--dc', AV_HUES[hue]);
  die.style.width = die.style.height = `${size}px`;
  die.style.setProperty('--cell', `${size}px`);
  slot.appendChild(die);
}
