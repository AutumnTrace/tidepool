import { describe, expect, it } from 'vitest';
import { createRng, splitmix32 } from '../src/sim/rng';

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('pins the first outputs so a refactor cannot silently change every shared link', () => {
    const r = createRng(1);
    expect([r.nextU32(), r.nextU32(), r.nextU32()]).toMatchInlineSnapshot(`
      [
        1828152527,
        3394835397,
        2967886022,
      ]
    `);
  });

  it('gives different streams for neighbouring seeds', () => {
    const a = createRng(1000);
    const b = createRng(1001);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.nextU32() === b.nextU32()) same++;
    expect(same).toBe(0);
  });

  it('stays in [0, 1) and looks uniform', () => {
    const r = createRng(7);
    const buckets = new Array(10).fill(0);
    const n = 200_000;
    for (let i = 0; i < n; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      buckets[Math.floor(x * 10)]++;
    }
    // Chi-squared with 9 degrees of freedom; 27.9 is the p = 0.001 cut-off.
    const expected = n / 10;
    const chi2 = buckets.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(27.9);
  });

  it('int() covers the whole range', () => {
    const r = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(r.int(12));
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('splitmix32', () => {
  it('produces 32-bit unsigned integers', () => {
    const next = splitmix32(0);
    for (let i = 0; i < 100; i++) {
      const v = next();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });
});
