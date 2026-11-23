/**
 * The whole configuration lives in the URL hash, so any view can be shared:
 *
 *   #seed=42&n=65536&k=6&density=80&force=10&friction=0.04&beta=0.3&speed=1&m=<matrix>
 *
 * The matrix is K*K signed bytes (value * 100) in base64url. Missing or
 * malformed fields fall back to defaults; a missing or mismatched matrix is
 * generated from the seed, so `#seed=42&k=5` alone is a complete world.
 */
import { PARAM_LIMITS, PARAM_STEPS, clamp, snap, type SimParams } from './params';
import { decodeMatrix, encodeMatrix, randomMatrix, type Matrix } from './matrix';
import { createRng } from './rng';
import { PRESETS } from './presets';

export interface AppState {
  seed: number;
  params: SimParams;
  matrix: Matrix;
  /** Simulation speed multiplier (steps per second / 60). */
  speed: number;
}

export const SPEED_LIMITS = { min: 0.25, max: 4, step: 0.25 } as const;

/** The matrix a seed implies when nobody has edited it. */
export function matrixForSeed(seed: number, k: number): Matrix {
  return randomMatrix(k, createRng(seed ^ 0x5eed));
}

/** No hash at all: the first preset. */
export function defaultState(): AppState {
  const first = PRESETS[0]!;
  return {
    seed: first.seed,
    params: { ...first.params },
    matrix: { k: first.matrix.k, values: first.matrix.values.slice() },
    speed: 1,
  };
}

export function encodeState(s: AppState): string {
  const p = s.params;
  const fields: [string, string | number][] = [
    ['seed', s.seed],
    ['n', p.count],
    ['k', p.species],
    ['density', p.density],
    ['force', p.force],
    ['friction', p.friction],
    ['beta', p.beta],
    ['speed', s.speed],
    ['m', encodeMatrix(s.matrix)],
  ];
  return fields.map(([k, v]) => `${k}=${v}`).join('&');
}

function readNumber(q: URLSearchParams, key: string): number | null {
  const raw = q.get(key);
  if (raw === null || raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

export function decodeState(hash: string): AppState {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const base = defaultState();
  const num = (key: string, fallback: number, lo: number, hi: number, step?: number) => {
    const v = readNumber(q, key);
    if (v === null) return fallback;
    const c = clamp(v, lo, hi);
    return step ? snap(c, step) : Math.round(c);
  };
  const L = PARAM_LIMITS;
  const seedRaw = readNumber(q, 'seed');
  const seed = seedRaw === null ? base.seed : Math.abs(Math.trunc(seedRaw)) >>> 0;
  const params: SimParams = {
    count: num('n', base.params.count, L.count.min, L.count.max),
    species: num('k', base.params.species, L.species.min, L.species.max),
    density: num('density', base.params.density, L.density.min, L.density.max, PARAM_STEPS.density),
    force: num('force', base.params.force, L.force.min, L.force.max, PARAM_STEPS.force),
    friction: num('friction', base.params.friction, L.friction.min, L.friction.max, PARAM_STEPS.friction),
    beta: num('beta', base.params.beta, L.beta.min, L.beta.max, PARAM_STEPS.beta),
  };
  const speed = num('speed', base.speed, SPEED_LIMITS.min, SPEED_LIMITS.max, SPEED_LIMITS.step);
  const m = q.get('m');
  // No seed and no usable matrix: keep the default rules if they still fit.
  const fallback =
    seedRaw === null && params.species === base.params.species ? base.matrix : matrixForSeed(seed, params.species);
  const matrix = (m !== null ? decodeMatrix(m, params.species) : null) ?? fallback;
  return { seed, params, matrix, speed };
}
