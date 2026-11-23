import { describe, expect, it } from 'vitest';
import {
  decodeMatrix,
  encodeMatrix,
  fromRows,
  get,
  isSymmetric,
  packForGpu,
  quantize,
  randomMatrix,
  randomSymmetricMatrix,
  resize,
  set,
  symmetrize,
} from '../src/sim/matrix';
import { createRng } from '../src/sim/rng';

describe('matrix utilities', () => {
  it('quantizes to hundredths, clamps to [-1, 1] and never returns -0', () => {
    expect(quantize(0.123)).toBe(0.12);
    expect(quantize(-0.126)).toBe(-0.13);
    expect(quantize(3)).toBe(1);
    expect(quantize(-3)).toBe(-1);
    expect(Object.is(quantize(-0.001), 0)).toBe(true);
  });

  it('random matrices stay in range', () => {
    const m = randomMatrix(12, createRng(1));
    expect(m.values).toHaveLength(144);
    for (const v of m.values) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('symmetrize averages mirrored pairs and leaves the diagonal alone', () => {
    const m = fromRows([
      [0.5, 1, -1],
      [0, -0.2, 0.4],
      [0.6, 0, 0.9],
    ]);
    const s = symmetrize(m);
    expect(isSymmetric(s)).toBe(true);
    expect(isSymmetric(m)).toBe(false);
    expect(get(s, 0, 1)).toBe(0.5);
    expect(get(s, 0, 2)).toBe(-0.2);
    expect([get(s, 0, 0), get(s, 1, 1), get(s, 2, 2)]).toEqual([0.5, -0.2, 0.9]);
  });

  it('random symmetric matrices are symmetric', () => {
    expect(isSymmetric(randomSymmetricMatrix(9, createRng(4)))).toBe(true);
  });

  it('set() mirrors when asked to', () => {
    const m = fromRows([
      [0, 0],
      [0, 0],
    ]);
    expect(set(m, 0, 1, 0.7).values).toEqual([0, 0.7, 0, 0]);
    expect(set(m, 0, 1, 0.7, true).values).toEqual([0, 0.7, 0.7, 0]);
  });

  it('resize keeps the overlapping block', () => {
    const m = randomMatrix(4, createRng(9));
    const bigger = resize(m, 6, createRng(10));
    const smaller = resize(bigger, 3, createRng(11));
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(get(smaller, i, j)).toBe(get(m, i, j));
    }
    expect(bigger.values).toHaveLength(36);
  });

  it('packs into the fixed 12-wide GPU layout', () => {
    const m = fromRows([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const packed = packForGpu(m);
    expect(packed).toHaveLength(144);
    expect(packed[0]).toBeCloseTo(0.1);
    expect(packed[1]).toBeCloseTo(0.2);
    expect(packed[12]).toBeCloseTo(0.3);
    expect(packed[13]).toBeCloseTo(0.4);
    expect(packed[2]).toBe(0);
  });

  it('encodes compactly and decodes exactly', () => {
    for (let k = 2; k <= 12; k++) {
      const m = randomMatrix(k, createRng(k));
      const text = encodeMatrix(m);
      expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(text.length).toBe(Math.ceil((k * k * 4) / 3));
      expect(decodeMatrix(text, k)).toEqual(m);
    }
  });

  it('refuses malformed input', () => {
    expect(decodeMatrix('!!!', 2)).toBeNull();
    expect(decodeMatrix(encodeMatrix(randomMatrix(3, createRng(1))), 4)).toBeNull();
  });
});
