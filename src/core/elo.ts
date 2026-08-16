// Elo rating updates for the PvP ladder. Bots carry (hidden) ratings and go
// through the same math — backfill games must feel indistinguishable, and a
// bot whose rating drifts to match its strength produces fairer pairings.
export const ELO_K = 32;
export const ELO_START = 1000;

export type MatchScore = 0 | 0.5 | 1;   // loss | draw | win, from a's perspective

export function eloDelta(a: number, b: number, score: MatchScore): number {
  const expected = 1 / (1 + Math.pow(10, (b - a) / 400));
  return Math.round(ELO_K * (score - expected));
}
