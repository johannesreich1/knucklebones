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

/* One draw off any caller-supplied source, checked before it is used. Every
   secondary draw here scales the result into an index or a weight, so a source
   returning NaN, 1, or a negative silently lands out of range instead of
   throwing. The label names the draw in the error, because the caller that
   passed the bad source is usually several frames up. */
export function unitDraw(random: () => number, label: string): number {
  const draw = random();
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new RangeError(`${label} random source must return a finite number in [0, 1).`);
  }
  return draw;
}

export function diceStream(seed: string): () => number {
  const rand = randStream(seed);
  return () => 1 + Math.floor(rand() * DICE_FACES);
}

/* LIMITED mode: the dice are FINITE — one shared bag holding every face
   exactly POOL_PER_FACE times, shuffled deterministically from the seed
   (Fisher-Yates over randStream). The '#pool' suffix keeps the draw
   independent of diceStream, so adding the mode never shifted anyone's
   classic rolls. Clients never see the seed: they derive remaining counts
   from the public move log + the visible next die instead. */
export const POOL_PER_FACE = 4;

/* The bag itself, shuffled by whatever randomness the caller explicitly
   brings. Ranked matches pass the seed stream so server and both clients deal
   the identical bag; offline callers deliberately pass Math.random. */
export function makeBag(rand: () => number): number[] {
  const bag: number[] = [];
  for (let v = 1; v <= DICE_FACES; v++) for (let i = 0; i < POOL_PER_FACE; i++) bag.push(v);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export function poolSequence(seed: string): number[] {
  return makeBag(randStream(seed + '#pool'));
}
