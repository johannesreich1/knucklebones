// The ranked mode wheel: registry + the seed-deterministic spin.
// Pure and shared — pvp-join picks the mode server-side from the match seed,
// clients derive the SAME pick to aim the wheel animation, and replay
// validation runs the match under it. Weights are wheel odds, not segment
// sizes: the dial draws every mode as an equal node and weights the pick
// (classic 4 of 10 = the agreed 40% no-addition rate).
import { randStream } from './dice.ts';
import { CLASSIC, ROWSWITCH, ROWMULT, COLSHIELD, SINGLESTRIKE, BOUNTY, LIMITED, type Mode } from './rules.ts';

export interface ModeSpec {
  mode: Mode;
  id: string;        // stored in matches.modifier — stable, never rename
  name: string;      // wheel label
  icon: string;      // single glyph: wheel banner, match badge, board hints
  blurb: string;     // one line under the landed segment
  detail: string;    // the tap-to-learn sheet's full explanation (client-only)
  weight: number;
}

/* NO SEATING FIELD HERE, ON PURPOSE (decided 2026-08-22, and briefly shipped
   the other way as v19).

   Who opens a ranked match is decided by RATING alone — the lower-rated player
   starts — and that rule is deliberately the same in every mode. A `seatEdge`
   field did exist for a few hours, flipping the seat under LIMITED because the
   measurement says its second mover is favoured; it was removed because a
   seating rule that varies per mode makes every future mode carry a balance
   decision, and the thing it was correcting is smaller than the noise it added
   to the explanation.

   The measurement itself is still true and still worth knowing — 60,000 games
   per mode, three seeds, 95% CI ±0.40, first-mover win%:

      classic 50.74 · rowswitch 51.37 · rowmult 51.51 · colshield 52.65
      singlestrike 52.05 · bounty 49.91 · limited 46.63

   So in LIMITED the player the handicap means to help gets a seat worth about
   −3.4 points instead of +0. That is the accepted cost of one rule
   (docs/LADDER.md, seating): the edge is small, the mode is 10% of the wheel,
   and it is not worth a per-mode branch. Do NOT reintroduce one without a
   decision — it was tried. */

/* Production odds: plain classic 40% of the time (weight 4 of 10), every
   addition an equal slice of the rest (1 of 10 = 10% each). Changed from 50/50
   on 2026-08-19 — the additions ARE the game's variety, and half of all matches
   never seeing one made them feel rarer than they should. Any change here has
   to be redeployed to pvp-join, which owns the real pick. */
export const MODES: ModeSpec[] = [
  { mode: CLASSIC, id: 'classic', name: 'CLASSIC', icon: '◆', blurb: 'The pure duel. Columns multiply.', weight: 4,
    detail: 'Matching dice stacked in a column multiply: two 4s = 16, three 4s = 36. Place a die and every matching die in the facing enemy column is destroyed. First full grid ends it — highest total wins.' },
  { mode: ROWSWITCH, id: 'rowswitch', name: 'ROW SWITCH', icon: '☰', blurb: 'Scoring turns sideways — only rows count.', weight: 1,
    detail: 'Only ROWS score here — columns count for nothing. Matching dice in the same row multiply, and the rail on the left tracks every row. Destruction still strikes down the facing column.' },
  { mode: ROWMULT, id: 'rowmult', name: 'ROW MULTIPLY', icon: '✚', blurb: 'Rows pay a bonus on top of columns.', weight: 1,
    detail: 'Columns score as always — and matching dice lined up in a ROW pay their sum again on top. The rail on the left shows what each row is adding.' },
  { mode: COLSHIELD, id: 'colshield', name: 'COLUMN SHIELD', icon: '🛡', blurb: 'A full column cannot be destroyed.', weight: 1,
    detail: 'Fill a column and it locks: a shielded column cannot be destroyed, whatever lands opposite. The shield pops onto the column chip the moment it engages.' },
  { mode: SINGLESTRIKE, id: 'singlestrike', name: 'SINGLE STRIKE', icon: '☓', blurb: 'Destruction takes ONE die — the closest to the centre.', weight: 1,
    detail: 'Destruction is surgical: a hit removes only ONE matching die — the one closest to the centre. Stacks survive longer, so multipliers rule the board.' },
  { mode: BOUNTY, id: 'bounty', name: 'BOUNTY', icon: '✦', blurb: 'Every die you destroy banks +1. Forever.', weight: 1,
    detail: 'Every die you destroy banks a permanent +1 on your nameplate — the ✦ tally never resets, even when your own dice fall. Feed on destruction; the bank decides close matches.' },
  { mode: LIMITED, id: 'limited', name: 'LIMITED', icon: '▦', blurb: 'Every face exists FOUR times. The bag ends it.', weight: 1,
    detail: 'The dice are finite: one shared bag holds every face exactly four times — 24 dice for the whole match. The stack beside the die in play counts what is still to come — how MANY, never which. When the last die is placed the game ends, full boards or not.' },
];

/* The OFFLINE picker's eighth option: not a mode, but "let the dial choose".
   Kept out of MODES on purpose — it must never be pickable BY the dial, and no
   match can ever be stored under it. */
export const RANDOM = -1;

export function modeById(id: string | null | undefined): ModeSpec {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/* the same lookup by numeric Mode — what the UI holds in S.scoring */
export function modeByEnum(mode: Mode): ModeSpec {
  return MODES.find((m) => m.mode === mode) ?? MODES[0];
}

/* deterministic weighted pick — the '#mode' suffix keeps this draw independent
   of the dice stream, so adding modes never shifts anyone's rolls */
export function pickMode(seed: string): ModeSpec {
  const total = MODES.reduce((s, m) => s + m.weight, 0);
  let t = randStream(seed + '#mode')() * total;
  for (const m of MODES) { t -= m.weight; if (t < 0) return m; }
  return MODES[0];
}
