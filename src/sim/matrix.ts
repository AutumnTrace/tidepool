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

export function set(m: Matrix, i: number, j: number, v: number, symmetric = false): Matrix {
  const values = m.values.slice();
  values[i * m.k + j] = quantize(v);
  if (symmetric) values[j * m.k + i] = quantize(v);
  return { k: m.k, values };
}

export function isSymmetric(m: Matrix): boolean {
  for (let i = 0; i < m.k; i++) {
    for (let j = i + 1; j < m.k; j++) if (get(m, i, j) !== get(m, j, i)) return false;
  }
  return true;
}

/** (A + A^T) / 2, re-quantised. Diagonal untouched. */
export function symmetrize(m: Matrix): Matrix {
  const values = m.values.slice();
  for (let i = 0; i < m.k; i++) {
    for (let j = i + 1; j < m.k; j++) {
      const v = quantize((get(m, i, j) + get(m, j, i)) / 2);
      values[i * m.k + j] = v;
      values[j * m.k + i] = v;
    }
  }
  return { k: m.k, values };
}

export function randomSymmetricMatrix(k: number, rng: Rng): Matrix {
  const m = randomMatrix(k, rng);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < i; j++) m.values[i * k + j] = m.values[j * k + i]!;
  }
  return m;
}

/**
 * Grows or shrinks to k species, keeping the overlapping top-left block and
 * filling new rows and columns from rng.
 */
export function resize(m: Matrix, k: number, rng: Rng): Matrix {
  const values: number[] = [];
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      values.push(i < m.k && j < m.k ? get(m, i, j) : quantize(rng.range(-1, 1)));
    }
  }
  return { k, values };
}

export function zeros(k: number): Matrix {
  return { k, values: new Array(k * k).fill(0) };
}

export function fromRows(rows: number[][]): Matrix {
  return { k: rows.length, values: rows.flat().map(quantize) };
}

export function equals(a: Matrix, b: Matrix): boolean {
  return a.k === b.k && a.values.every((v, i) => v === b.values[i]);
}

/** int8 per entry (value * 100), base64url. 12 species -> 192 characters. */
export function encodeMatrix(m: Matrix): string {
  const bytes = new Uint8Array(m.values.length);
  m.values.forEach((v, i) => (bytes[i] = Math.round(v * QUANTUM) & 0xff));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Returns null for anything malformed rather than throwing. */
export function decodeMatrix(text: string, k: number): Matrix | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  let bin: string;
  try {
    bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
  if (bin.length !== k * k) return null;
  const values: number[] = [];
  for (let i = 0; i < bin.length; i++) {
    const signed = (bin.charCodeAt(i) << 24) >> 24;
    if (signed < -QUANTUM || signed > QUANTUM) return null;
    values.push(quantize(signed / QUANTUM));
  }
  return { k, values };
}
