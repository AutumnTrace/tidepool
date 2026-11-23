import type { Rng } from './rng';
import { MAX_SPECIES } from './params';

/**
 * K x K attraction matrix, row-major. values[i * k + j] is how much species
 * i is drawn towards species j: +1 strongly attracted, -1 strongly repelled.
 * Values are kept on a 0.01 grid so they survive a trip through the URL
 * unchanged.
 */
export interface Matrix {
  k: number;
  values: number[];
}

export const QUANTUM = 100;

export function quantize(v: number): number {
  const q = Math.round(Math.max(-1, Math.min(1, v)) * QUANTUM);
  return (q === 0 ? 0 : q) / QUANTUM; // no -0
}

export function randomMatrix(k: number, rng: Rng): Matrix {
  const values: number[] = [];
  for (let i = 0; i < k * k; i++) values.push(quantize(rng.range(-1, 1)));
  return { k, values };
}

export function get(m: Matrix, i: number, j: number): number {
  return m.values[i * m.k + j]!;
}

/** Pads to the fixed 12 x 12 layout the shaders index into. */
export function packForGpu(m: Matrix): Float32Array {
  const out = new Float32Array(MAX_SPECIES * MAX_SPECIES);
  for (let i = 0; i < m.k; i++) {
    for (let j = 0; j < m.k; j++) out[i * MAX_SPECIES + j] = get(m, i, j);
  }
  return out;
}
