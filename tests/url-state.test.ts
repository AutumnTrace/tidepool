import { describe, expect, it } from 'vitest';
import { decodeState, defaultState, encodeState, matrixForSeed, type AppState } from '../src/sim/url-state';
import { randomMatrix } from '../src/sim/matrix';
import { createRng } from '../src/sim/rng';

describe('URL state', () => {
  it('round-trips the default state', () => {
    const s = defaultState();
    expect(decodeState('#' + encodeState(s))).toEqual(s);
  });

  it('round-trips random states exactly, matrix included', () => {
    const rng = createRng(2024);
    for (let t = 0; t < 200; t++) {
      const k = 2 + rng.int(11);
      const s: AppState = {
        seed: 1 + rng.int(999_999_999),
        params: {
          count: 1024 << rng.int(11),
          species: k,
          density: 4 + rng.int(117),
          force: Math.round(rng.range(0.5, 40) * 10) / 10,
          friction: Math.round(rng.range(0.005, 1) * 200) / 200,
          beta: Math.round(rng.range(0.05, 0.6) * 100) / 100,
        },
        matrix: randomMatrix(k, rng),
        speed: 0.25 * (1 + rng.int(16)),
        view: {
          trails: rng.next() < 0.3 ? 0 : Math.round(rng.range(0.5, 0.97) * 100) / 100,
          glow: Math.round(rng.range(0.4, 3) * 20) / 20,
          exposure: Math.round(rng.range(0.25, 4) * 20) / 20,
        },
      };
      const hash = encodeState(s);
      const back = decodeState(hash);
      expect(back).toEqual(s);
      expect(encodeState(back)).toBe(hash);
    }
  });

  it('produces a readable hash', () => {
    expect(encodeState(defaultState())).toMatch(
      /^seed=1&n=65536&k=6&density=80&force=10&friction=0.04&beta=0.3&speed=1&trails=0&glow=1&exposure=1&m=[A-Za-z0-9_-]+$/,
    );
  });

  it('falls back to defaults for an empty or garbage hash', () => {
    expect(decodeState('')).toEqual(defaultState());
    expect(decodeState('#hello=world&n=banana&force=NaN')).toEqual(defaultState());
  });

  it('clamps out-of-range numbers instead of rejecting them', () => {
    const s = decodeState('#n=99999999&k=40&density=-5&force=1e9&beta=0.33333');
    expect(s.params.count).toBe(1 << 20);
    expect(s.params.species).toBe(12);
    expect(s.params.density).toBe(4);
    expect(s.params.force).toBe(40);
    expect(s.params.beta).toBe(0.33);
  });

  it('derives the matrix from the seed when it is missing or the wrong size', () => {
    const fromSeed = decodeState('#seed=42&k=5');
    expect(fromSeed.matrix).toEqual(matrixForSeed(42, 5));
    const wrongK = encodeState(fromSeed).replace('k=5', 'k=4');
    expect(decodeState('#' + wrongK).matrix).toEqual(matrixForSeed(42, 4));
  });

  it('rejects a matrix with entries outside [-1, 1]', () => {
    // 0x7f = 127, which would mean 1.27
    const bad = btoa(String.fromCharCode(0x7f, 0, 0, 0)).replace(/=+$/, '');
    expect(decodeState('#seed=3&k=2&m=' + bad).matrix).toEqual(matrixForSeed(3, 2));
  });
});
