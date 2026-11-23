import { describe, expect, it } from 'vitest';
import { kernel } from '../src/sim/kernel';
import { DEFAULT_PARAMS, R_MAX, frictionFactor, worldFor } from '../src/sim/params';
import { spawn } from '../src/sim/spawn';

describe('kernel', () => {
  const beta = 0.3;

  it('is fully repulsive at r = 0 regardless of attraction', () => {
    expect(kernel(0, 1, beta)).toBe(-1);
    expect(kernel(0, -1, beta)).toBe(-1);
  });

  it('is continuous at beta and at the interaction radius', () => {
    const eps = 1e-9;
    for (const a of [-1, -0.3, 0, 0.5, 1]) {
      expect(kernel(beta - eps, a, beta)).toBeCloseTo(kernel(beta + eps, a, beta), 6);
      expect(kernel(1 - eps, a, beta)).toBeCloseTo(0, 6);
      expect(kernel(1, a, beta)).toBe(0);
    }
  });

  it('peaks at the midpoint of the attraction band with value a', () => {
    const mid = (1 + beta) / 2;
    expect(kernel(mid, 0.8, beta)).toBeCloseTo(0.8, 12);
    expect(kernel(mid, -0.4, beta)).toBeCloseTo(-0.4, 12);
  });

  it('is zero beyond the radius', () => {
    expect(kernel(1.5, 1, beta)).toBe(0);
  });
});

describe('world sizing', () => {
  it('keeps the mean neighbour count equal to density', () => {
    for (const count of [1 << 14, 1 << 16, 1 << 20]) {
      const w = worldFor(count, 30);
      const neighbours = (count / (w.size * w.size)) * Math.PI * R_MAX * R_MAX;
      expect(neighbours).toBeCloseTo(30, 6);
    }
  });

  it('never makes a bin smaller than the interaction radius, and has at least 3 bins per edge', () => {
    for (const count of [16, 1024, 1 << 16, 1 << 20]) {
      for (const density of [4, 30, 120]) {
        const w = worldFor(count, density);
        expect(w.cell).toBeGreaterThanOrEqual(R_MAX);
        expect(w.grid).toBeGreaterThanOrEqual(3);
        expect(w.bins).toBe(w.grid * w.grid);
      }
    }
  });

  it('turns a half-life into a per-step multiplier', () => {
    // After one half-life worth of steps the velocity should have halved.
    const steps = 0.04 / 0.02;
    expect(frictionFactor(0.04) ** steps).toBeCloseTo(0.5, 12);
  });
});

describe('spawn', () => {
  it('is reproducible and keeps everything inside the world', () => {
    const w = worldFor(DEFAULT_PARAMS.count, DEFAULT_PARAMS.density);
    const a = spawn(5000, 6, w.size, 99);
    const b = spawn(5000, 6, w.size, 99);
    expect(a.pos).toEqual(b.pos);
    for (const v of a.pos) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(w.size);
    }
  });

  it('packs id and species into tags', () => {
    const s = spawn(100, 7, 10, 1);
    for (let i = 0; i < 100; i++) {
      expect(s.tags[i]! >>> 4).toBe(i);
      expect(s.tags[i]! & 15).toBe(i % 7);
    }
  });
});
