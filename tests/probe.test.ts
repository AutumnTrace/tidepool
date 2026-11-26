import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, PARAM_LIMITS } from '../src/sim/params';
import { AUTO_COUNT, PROBE_BUDGET_MS, isSoftwareAdapter, pickCount, predictFrameMs, probeWanted, type ProbeTiming } from '../src/sim/probe';

/** A probe taken at the default count. */
const at65k = (stepMs: number, drawMs: number, fixedMs: number): ProbeTiming => ({ count: 65_536, stepMs, drawMs, fixedMs });

describe('pickCount', () => {
  it('keeps the default without a measurement', () => {
    expect(pickCount(null)).toBe(DEFAULT_PARAMS.count);
  });

  it('starts a fast GPU at the top of the automatic range', () => {
    // The README's 65,536 row on an RTX 5070: 0.43 ms of simulation, 0.19 ms of draw and tone-map.
    expect(pickCount(at65k(0.43, 0.05, 0.14))).toBe(AUTO_COUNT.max);
  });

  it('starts a slow GPU at the bottom of the automatic range', () => {
    expect(pickCount(at65k(14, 3, 1))).toBe(AUTO_COUNT.min);
    // Even when nothing fits, it does not go below the range.
    expect(pickCount(at65k(200, 50, 30))).toBe(AUTO_COUNT.min);
  });

  it('picks the largest power of two whose predicted frame fits the budget', () => {
    // 0.5 ms fixed + 2.5 ms per 65,536 particles: 131,072 predicts 5.5 ms, 262,144 predicts 10.5 ms.
    const t = at65k(2, 0.5, 0.5);
    expect(predictFrameMs(t, 131_072)).toBeCloseTo(5.5);
    expect(predictFrameMs(t, 262_144)).toBeCloseTo(10.5);
    expect(pickCount(t)).toBe(131_072);
  });

  it('treats a prediction exactly on the budget as fitting', () => {
    // 65,536 particles cost exactly half the budget, so 131,072 lands on it.
    const t = at65k(PROBE_BUDGET_MS / 2, 0, 0);
    expect(pickCount(t)).toBe(131_072);
  });

  it('works from a probe taken at any count', () => {
    const per1k = 0.02; // ms per 1,024 particles, all scaling work
    const probes = [16_384, 65_536, 262_144].map((count) => ({ count, stepMs: (per1k * count) / 1024, drawMs: 0, fixedMs: 1 }));
    // 1 + 0.02 * 256 = 6.12 ms at 262,144, so every probe agrees on the top of the range.
    for (const t of probes) expect(pickCount(t)).toBe(262_144);
  });

  it('ignores timings it cannot use', () => {
    for (const t of [
      at65k(Number.NaN, 0, 0),
      at65k(-1, 0, 0),
      at65k(0, 0, 0),
      at65k(1, Number.POSITIVE_INFINITY, 0),
      at65k(1, 0, -0.5),
      { count: 0, stepMs: 1, drawMs: 0, fixedMs: 0 },
      { count: 1.5, stepMs: 1, drawMs: 0, fixedMs: 0 },
    ]) {
      expect(pickCount(t)).toBe(DEFAULT_PARAMS.count);
    }
  });

  it('always returns a power of two the panel can reach, and never more for a slower GPU', () => {
    let previous = Infinity;
    for (let ms = 0.01; ms < 100; ms *= 1.15) {
      const count = pickCount(at65k(ms, ms / 10, 0.3));
      expect(Math.log2(count) % 1).toBe(0);
      expect(count).toBeGreaterThanOrEqual(Math.max(AUTO_COUNT.min, PARAM_LIMITS.count.min));
      expect(count).toBeLessThanOrEqual(Math.min(AUTO_COUNT.max, PARAM_LIMITS.count.max));
      expect(count).toBeLessThanOrEqual(previous);
      previous = count;
    }
  });
});

describe('isSoftwareAdapter', () => {
  const info = (vendor: string, architecture: string, description: string, isFallbackAdapter?: boolean) => ({
    vendor,
    architecture,
    description,
    isFallbackAdapter,
  });

  it('spots fallback and software adapters', () => {
    expect(isSoftwareAdapter(info('google', 'swiftshader', ''))).toBe(true);
    expect(isSoftwareAdapter(info('mesa', '', 'llvmpipe (LLVM 19.1.7, 256 bits)'))).toBe(true);
    expect(isSoftwareAdapter(info('', '', '', true))).toBe(true);
  });

  it('leaves hardware adapters alone', () => {
    expect(isSoftwareAdapter(info('nvidia', 'blackwell', ''))).toBe(false);
    expect(isSoftwareAdapter(info('intel', 'xe-lpg', 'Intel(R) Graphics'))).toBe(false);
    expect(isSoftwareAdapter(info('apple', 'metal-3', '', false))).toBe(false);
  });
});

describe('probeWanted', () => {
  it('probes a first visit in a normal browser', () => {
    expect(probeWanted('', '', false)).toBe(true);
    expect(probeWanted('', '#seed=3&k=3', false)).toBe(true);
  });

  it('keeps a count that is already in the link', () => {
    expect(probeWanted('', '#seed=42&n=65536&k=6', false)).toBe(false);
    expect(probeWanted('?probe=1', '#n=16384', false)).toBe(false);
  });

  it('follows ?probe=0 and ?probe=1', () => {
    expect(probeWanted('?probe=0', '', false)).toBe(false);
    expect(probeWanted('?method=brute&probe=1', '', true)).toBe(true);
  });

  it('does not probe in automated browsers unless asked', () => {
    expect(probeWanted('', '', true)).toBe(false);
  });
});
