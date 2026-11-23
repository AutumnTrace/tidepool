/**
 * Small seeded PRNG: sfc32, with its 128-bit state expanded from a 32-bit
 * seed by splitmix32. sfc32 passes PractRand to multiple terabytes, only uses
 * 32-bit integer ops, and is a handful of lines, which is all a particle
 * spawner needs. The same seed gives the same sequence in Node and in every
 * browser, which is what makes shareable URLs reproducible.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform unsigned 32-bit integer. */
  nextU32(): number;
  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
}

export function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): Rng {
  const init = splitmix32(seed);
  let a = init();
  let b = init();
  let c = init();
  let d = init();

  const nextU32 = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  // Discard a few outputs so nearby seeds decorrelate quickly.
  for (let i = 0; i < 12; i++) nextU32();

  const next = (): number => nextU32() / 4294967296;
  return {
    next,
    nextU32,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (n) => Math.floor(next() * n),
  };
}

/** A fresh, non-deterministic seed for "give me something new" actions. */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Keep seeds short enough to read aloud and paste: 1..999,999,999.
  return (buf[0]! % 999_999_999) + 1;
}
