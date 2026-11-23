import { describe, expect, it } from 'vitest';
import {
  binOf,
  binParticles,
  byId,
  compareStates,
  exclusiveScan,
  stepBruteForce,
  stepGrid,
  type StepConfig,
} from '../src/sim/reference';
import { DEFAULT_PARAMS, worldFor } from '../src/sim/params';
import { randomMatrix } from '../src/sim/matrix';
import { createRng } from '../src/sim/rng';
import { spawn, type ParticleState } from '../src/sim/spawn';

function setup(count: number, density: number, seed: number): { state: ParticleState; cfg: StepConfig } {
  const params = { ...DEFAULT_PARAMS, count, density };
  const world = worldFor(count, density);
  const matrix = randomMatrix(params.species, createRng(seed + 1));
  return { state: spawn(count, params.species, world.size, seed), cfg: { params, world, matrix } };
}

describe('exclusiveScan', () => {
  it('matches a naive running sum', () => {
    const rng = createRng(5);
    const data = Uint32Array.from({ length: 3000 }, () => rng.int(50));
    const copy = data.slice();
    const total = exclusiveScan(data);
    let sum = 0;
    for (let i = 0; i < copy.length; i++) {
      expect(data[i]).toBe(sum);
      sum += copy[i]!;
    }
    expect(total).toBe(sum);
  });
});

describe('binParticles', () => {
  it('produces a permutation that is sorted by bin', () => {
    const { state, cfg } = setup(5000, 20, 11);
    const { start, order } = binParticles(state.pos, cfg.world);
    expect(new Set(order).size).toBe(5000);
    expect(start[cfg.world.bins]).toBe(5000);
    for (let b = 0; b < cfg.world.bins; b++) {
      for (let s = start[b]!; s < start[b + 1]!; s++) {
        const i = order[s]!;
        expect(binOf(state.pos[i * 2]!, state.pos[i * 2 + 1]!, cfg.world)).toBe(b);
      }
    }
  });

  it('clamps a coordinate sitting exactly on the far edge into the last bin', () => {
    const world = worldFor(1024, 30);
    expect(binOf(world.size, world.size, world)).toBe(world.bins - 1);
  });
});

describe('stepGrid', () => {
  it('finds exactly the same neighbours as brute force', () => {
    // Several steps so that particles bunch up and cross the wrap seam.
    let { state, cfg } = setup(1500, 25, 3);
    let brute = state;
    for (let step = 0; step < 5; step++) {
      state = stepGrid(state, cfg);
      brute = stepBruteForce(brute, cfg);
      const diff = compareStates(state, brute, cfg.world.size);
      expect(diff.badIds).toBe(0);
      // Only the summation order differs, and both sum in float64.
      expect(diff.maxPos).toBeLessThan(1e-5);
      expect(diff.maxVel).toBeLessThan(1e-4);
    }
  });

  it('keeps every particle inside the world', () => {
    let { state, cfg } = setup(2000, 40, 8);
    for (let step = 0; step < 10; step++) state = stepGrid(state, cfg);
    for (const v of state.pos) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(cfg.world.size);
    }
  });

  it('applies the pointer force towards the pointer when pulling', () => {
    const { cfg } = setup(1024, 30, 1);
    const world = cfg.world;
    const state: ParticleState = {
      pos: new Float32Array([world.size / 2, world.size / 2]),
      vel: new Float32Array(2),
      tags: new Uint32Array(1),
    };
    const pull = { x: world.size / 2 + 2, y: world.size / 2, radius: 5, strength: 50 };
    const next = byId(stepGrid(state, { ...cfg, params: { ...cfg.params, count: 1 }, pointer: pull }));
    expect(next.vel[0]).toBeGreaterThan(0);
    expect(next.vel[1]).toBeCloseTo(0, 6);
  });

  it('pulls a lone pair together when they attract each other', () => {
    const { cfg } = setup(1024, 30, 1);
    const matrix = { k: 2, values: [0, 1, 1, 0] };
    const state: ParticleState = {
      pos: new Float32Array([5, 5, 5.7, 5]),
      vel: new Float32Array(4),
      tags: new Uint32Array([(0 << 4) | 0, (1 << 4) | 1]),
    };
    const next = byId(stepGrid(state, { ...cfg, matrix, params: { ...cfg.params, count: 2, species: 2 } }));
    expect(next.vel[0]).toBeGreaterThan(0);
    expect(next.vel[2]).toBeLessThan(0);
  });
});
