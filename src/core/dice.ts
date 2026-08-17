// Seeded dice for ranked games. The server issues the seed; client and the
// replay-validating Edge Function both derive the SAME roll sequence from it,
// so a submitted game can be replayed move-for-move.
//
// xmur3 (string hash) + mulberry32 (PRNG): 32-bit integer arithmetic only —
// bit-identical in every JS runtime (browser, Node, Deno). Do not "upgrade"
// to Math.random or a float-seeded scheme; determinism IS the feature.
import { DICE_FACES } from '../config.ts';

/* uniform [0,1) stream — the primitive under diceStream, also used to derive
   secondary deterministic draws (e.g. the ranked mode wheel) from a seed */
export function randStream(seed: string): () => number {
  let h = 1779033703 ^ seed.length;                    // xmur3
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  let a = (h ^= h >>> 16) >>> 0;

  return () => {                                       // mulberry32
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function diceStream(seed: string): () => number {
  const rand = randStream(seed);
  return () => 1 + Math.floor(rand() * DICE_FACES);
}
