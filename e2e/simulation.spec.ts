import { expect, test } from '@playwright/test';
import { openWithGpu } from './gpu';
import { DEFAULT_PARAMS, worldFor } from '../src/sim/params';
import { randomMatrix } from '../src/sim/matrix';
import { createRng } from '../src/sim/rng';
import { spawn, type ParticleState } from '../src/sim/spawn';
import { binParticles, compareStates, stepGrid, stepBruteForce } from '../src/sim/reference';

const COUNT = 4096;
const params = { ...DEFAULT_PARAMS, count: COUNT, density: 30, species: 6 };
const world = worldFor(COUNT, params.density);
const SEED = 1234;
const MATRIX_SEED = 99;

function cpuRun(steps: number, method: 'grid' | 'brute' = 'grid'): ParticleState {
  const matrix = randomMatrix(params.species, createRng(MATRIX_SEED));
  let state = spawn(COUNT, params.species, world.size, SEED);
  for (let i = 0; i < steps; i++) {
    state = (method === 'grid' ? stepGrid : stepBruteForce)(state, { params, world, matrix });
  }
  return state;
}

function toState(r: { pos: number[]; vel: number[]; tags: number[] }): ParticleState {
  return { pos: Float32Array.from(r.pos), vel: Float32Array.from(r.vel), tags: Uint32Array.from(r.tags) };
}

test.describe('GPU simulation vs CPU reference', () => {
  test.beforeEach(async ({ page }) => openWithGpu(page, './', { hardware: true }));

  test('prefix sum is exact across one, two and three levels', async ({ page }) => {
    const lengths = [1, 3, 1023, 1024, 1025, 4097, 65_537, 1_048_577, 2_500_000];
    const results = await page.evaluate((l) => window.tidepool!.gpuScan(l, 7), lengths);
    expect(results.map((r) => r.levels)).toEqual([1, 1, 1, 1, 2, 2, 2, 3, 3]);
    for (const r of results) expect(r, `scan of ${r.n}`).toMatchObject({ mismatches: 0 });
  });

  test('count + scan produce exactly the CPU bin offsets', async ({ page }) => {
    const gpu = await page.evaluate(
      (req) => window.tidepool!.gpuStep(req),
      { params, seed: SEED, matrixSeed: MATRIX_SEED, steps: 1 },
    );
    const initial = spawn(COUNT, params.species, world.size, SEED);
    expect(gpu.binStarts).toEqual(Array.from(binParticles(initial.pos, world).start));
  });

  test('one step matches the CPU reference', async ({ page }) => {
    const gpu = await page.evaluate(
      (req) => window.tidepool!.gpuStep(req),
      { params, seed: SEED, matrixSeed: MATRIX_SEED, steps: 1 },
    );
    const diff = compareStates(toState(gpu), cpuRun(1), world.size);
    console.log(`1 step, N=${COUNT}: max |dpos| ${diff.maxPos.toExponential(2)}, max |dvel| ${diff.maxVel.toExponential(2)}`);
    expect(diff.badIds).toBe(0);
    expect(diff.maxPos).toBeLessThan(1e-5);
    expect(diff.maxVel).toBeLessThan(1e-4);
  });

  test('ten steps stay close to the CPU reference', async ({ page }) => {
    const gpu = await page.evaluate(
      (req) => window.tidepool!.gpuStep(req),
      { params, seed: SEED, matrixSeed: MATRIX_SEED, steps: 10 },
    );
    const diff = compareStates(toState(gpu), cpuRun(10), world.size);
    console.log(`10 steps, N=${COUNT}: max |dpos| ${diff.maxPos.toExponential(2)}, max |dvel| ${diff.maxVel.toExponential(2)}`);
    expect(diff.badIds).toBe(0);
    expect(diff.maxPos).toBeLessThan(1e-4);
  });

  test('brute-force GPU path agrees with the grid path', async ({ page }) => {
    const gpu = await page.evaluate(
      (req) => window.tidepool!.gpuStep(req),
      { params, seed: SEED, matrixSeed: MATRIX_SEED, steps: 1, method: 'brute' as const },
    );
    const diff = compareStates(toState(gpu), cpuRun(1, 'brute'), world.size);
    expect(diff.badIds).toBe(0);
    expect(diff.maxPos).toBeLessThan(1e-5);
  });
});
