// The avatar: a die face and a hue, "die:5:cy". 36 identities, no storage
// bucket, no moderation, and no user-generated-image obligations at review.
// The string shape is the seam: a later value can be "img:<path>".
//
// Lives in ui/ (not online/) because the HOME plate paints it at boot, before
// any online code loads — and anything the offline game can show must not pull
// in the online chunk. The account panel and the avatar picker import from
// here; there is exactly one reading of the avatar string.
import { ME } from '../core/rules.ts';
import { HUE_IDS } from '../state.ts';
import { makeDie } from './die.ts';

/* raw hue tokens, never --p1/--p2: a picked avatar keeps its colour whatever
   the Settings pickers do to the duel pair */
/* ONE HUE REGISTRY, NOT TWO. This list used to be written out here as well as
   in state.ts, and the two drifted the moment a colour was added to only one of
   them: BLUE joined the duel palette on 2026-08-22 and never reached the avatar
   picker, because the picker kept its own copy (reported from a device). Derived
   now, so a hue added to DUELHUES is offered here by construction. Every id has
   a matching --<id> token in foundations/tokens.css; that pairing is what the
   registry means. */
export const AV_HUES: Record<string, string> =
  Object.fromEntries(HUE_IDS.map((id) => [id, `var(--${id})`]));
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
