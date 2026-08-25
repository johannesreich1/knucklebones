// Determinism gate for the seeded dice stream. Ranked-game validation replays
// moves against the seed's roll sequence, so client (browser), test (Node) and
// validator (Deno) MUST derive identical rolls. The golden sequence pins that:
// if it ever changes, the PRNG changed, and every stored ranked game's replay
// breaks — that is a red build, not a snapshot to update casually.
// Run: mise exec -- node --experimental-strip-types tests/dice.test.ts
import { diceStream } from '../src/core/dice.ts';

const problems: string[] = [];
const check = (c: boolean, m: string, x?: unknown) => { if (!c) problems.push(m + ' :: ' + JSON.stringify(x)); };

// golden: first 12 rolls for a fixed seed (computed once, pinned forever)
const golden = [5, 3, 3, 4, 5, 6, 5, 2, 5, 3, 1, 1];
const r1 = diceStream('kb-golden-1');
check(JSON.stringify(Array.from({ length: 12 }, r1)) === JSON.stringify(golden),
  'golden sequence drifted — the PRNG changed', golden);

// same seed → identical long sequence
const a = diceStream('replay-me'), b = diceStream('replay-me');
let same = true;
for (let i = 0; i < 10_000; i++) if (a() !== b()) { same = false; break; }
check(same, 'same seed produced diverging sequences');

// different seed → different sequence
const c1 = diceStream('seed-a'), c2 = diceStream('seed-b');
check(Array.from({ length: 32 }, c1).join() !== Array.from({ length: 32 }, c2).join(),
  'different seeds produced the same sequence');

// range + rough uniformity over 60k rolls (each face ~10k, generous ±15%)
const counts = [0, 0, 0, 0, 0, 0];
const r = diceStream('uniformity');
for (let i = 0; i < 60_000; i++) {
  const v = r();
  check(v >= 1 && v <= 6, 'roll out of range', v);
  counts[v - 1]++;
}
for (let f = 0; f < 6; f++)
  check(counts[f] > 8_500 && counts[f] < 11_500, 'face distribution skewed', { face: f + 1, n: counts[f] });

console.log(JSON.stringify({ counts, problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
