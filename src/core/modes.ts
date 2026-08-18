// The ranked mode wheel: registry + the seed-deterministic spin.
// Pure and shared — pvp-join picks the mode server-side from the match seed,
// clients derive the SAME pick to aim the wheel animation, and replay
// validation runs the match under it. Weights are wheel odds, not segment
// sizes: the wheel draws every mode as an equal segment and weights the spin
// (classic 3 of 6 = the agreed 50% no-addition rate).
import { randStream } from './dice.ts';
import { CLASSIC, ROWSWITCH, ROWMULT, COLSHIELD, SINGLESTRIKE, BOUNTY, type Mode } from './rules.ts';

export interface ModeSpec {
  mode: Mode;
  id: string;        // stored in matches.modifier — stable, never rename
  name: string;      // wheel label
  icon: string;      // single glyph: wheel banner, match badge, board hints
  blurb: string;     // one line under the landed segment
  weight: number;
}

/* Production odds: classic half the time (weight 5 of 10), every addition an
   equal slice of the rest (1 of 10 = 10% each). The agreed contract: no
   addition in 50% of matches, additions split the other half evenly. */
export const MODES: ModeSpec[] = [
  { mode: CLASSIC, id: 'classic', name: 'CLASSIC', icon: '◆', blurb: 'The pure duel. Columns multiply.', weight: 5 },
  { mode: ROWSWITCH, id: 'rowswitch', name: 'ROW SWITCH', icon: '☰', blurb: 'Scoring turns sideways — only rows count.', weight: 1 },
  { mode: ROWMULT, id: 'rowmult', name: 'ROW MULTIPLY', icon: '✚', blurb: 'Rows pay a bonus on top of columns.', weight: 1 },
  { mode: COLSHIELD, id: 'colshield', name: 'COLUMN SHIELD', icon: '🛡', blurb: 'A full column cannot be destroyed.', weight: 1 },
  { mode: SINGLESTRIKE, id: 'singlestrike', name: 'SINGLE STRIKE', icon: '☓', blurb: 'Destruction takes ONE die — the closest to the centre.', weight: 1 },
  { mode: BOUNTY, id: 'bounty', name: 'BOUNTY', icon: '✦', blurb: 'Every die you destroy banks +1. Forever.', weight: 1 },
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
