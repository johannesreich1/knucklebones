// The ranked mode wheel: registry + the seed-deterministic spin.
// Pure and shared — pvp-join picks the mode server-side from the match seed,
// clients derive the SAME pick to aim the wheel animation, and replay
// validation runs the match under it. Weights are wheel odds, not segment
// sizes: the wheel draws every mode as an equal segment and weights the spin
// (classic 3 of 6 = the agreed 50% no-addition rate).
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

/* Production odds: classic half the time (weight 6 of 12), every addition an
   equal slice of the rest (1 of 12 each). The agreed contract: no addition in
   50% of matches, additions split the other half evenly. */
export const MODES: ModeSpec[] = [
  { mode: CLASSIC, id: 'classic', name: 'CLASSIC', icon: '◆', blurb: 'The pure duel. Columns multiply.', weight: 6,
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
    detail: 'The dice are finite: one shared bag holds every face exactly four times — 24 dice for the whole match. The rail above the boards counts what remains, so you can read what can still come. When the last die is placed the game ends, full boards or not.' },
];

export function modeById(id: string | null | undefined): ModeSpec {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

/* deterministic weighted pick — the '#mode' suffix keeps this draw independent
   of the dice stream, so adding modes never shifts anyone's rolls */
export function pickMode(seed: string): ModeSpec {
  const total = MODES.reduce((s, m) => s + m.weight, 0);
  let t = randStream(seed + '#mode')() * total;
  for (const m of MODES) { t -= m.weight; if (t < 0) return m; }
  return MODES[0];
}
