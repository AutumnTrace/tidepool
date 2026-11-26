/**
 * Choosing a starting particle count for the visitor's GPU.
 *
 * On a first visit the app runs about a second of frames at the default
 * count with timestamp queries, then switches to the largest count whose GPU
 * work per frame should fit a budget. Every simulation pass is linear in the
 * particle count, and so is drawing the sprites; compositing the HDR buffer
 * depends only on the canvas size. So one measurement at one count predicts
 * the others well enough to pick a power of two.
 *
 * Everything here is pure; the timing itself lives in App.
 */
import { DEFAULT_PARAMS } from './params';

export interface ProbeTiming {
  /** Particle count the frames were timed at. */
  count: number;
  /** Mean GPU ms of one simulation step, all simulation passes together. */
  stepMs: number;
  /** Mean GPU ms per frame of drawing that scales with the count (the sprite pass). */
  drawMs: number;
  /** Mean GPU ms per frame of work that does not depend on the count (compositing). */
  fixedMs: number;
}

/**
 * GPU ms per frame the pick aims for: about half a 60 Hz frame, which leaves
 * room for the browser's own work, for a slower second step when a frame
 * runs late, and for structures that make the neighbour search busier.
 */
export const PROBE_BUDGET_MS = 8;

/**
 * The pick stays within two doublings of the default either way. The presets
 * were tuned around the default, and the panel still goes from 1,024 to a
 * million by hand.
 */
export const AUTO_COUNT = { min: DEFAULT_PARAMS.count >> 2, max: DEFAULT_PARAMS.count << 2 } as const;

/** GPU ms per frame at `count` and one simulation step per frame, extrapolated from a probe. */
export function predictFrameMs(t: ProbeTiming, count: number): number {
  return t.fixedMs + ((t.stepMs + t.drawMs) * count) / t.count;
}

/**
 * The largest power of two in AUTO_COUNT whose predicted frame fits the
 * budget, or AUTO_COUNT.min if none does. Without a usable measurement it
 * returns the default count unchanged.
 */
export function pickCount(t: ProbeTiming | null, budgetMs = PROBE_BUDGET_MS): number {
  if (t === null || !usable(t)) return DEFAULT_PARAMS.count;
  let count = AUTO_COUNT.min;
  while (count * 2 <= AUTO_COUNT.max && predictFrameMs(t, count * 2) <= budgetMs) count *= 2;
  return count;
}

function usable(t: ProbeTiming): boolean {
  const ms = (v: number) => Number.isFinite(v) && v >= 0;
  return Number.isInteger(t.count) && t.count > 0 && ms(t.stepMs) && ms(t.drawMs) && ms(t.fixedMs) && t.stepMs + t.drawMs > 0;
}

/** Software rasterisers time nothing useful; the same list the end-to-end tests skip on. */
const SOFTWARE_ADAPTER = /swiftshader|llvmpipe|lavapipe|software|warp/i;

export function isSoftwareAdapter(info: {
  vendor: string;
  architecture: string;
  description: string;
  isFallbackAdapter?: boolean;
}): boolean {
  return Boolean(info.isFallbackAdapter) || SOFTWARE_ADAPTER.test(`${info.vendor} ${info.architecture} ${info.description}`);
}

/**
 * Whether to probe at all, from the page address. A count in the hash (a
 * shared link, or a reload after an earlier pick) is kept as it is.
 * `?probe=0` turns probing off and `?probe=1` turns it on. Automated
 * browsers don't probe unless asked, so tests and benchmarks start at the
 * default count.
 */
export function probeWanted(search: string, hash: string, automated: boolean): boolean {
  const flag = new URLSearchParams(search).get('probe');
  if (flag === '0') return false;
  if (new URLSearchParams(hash.replace(/^#/, '')).has('n')) return false;
  return flag === '1' || !automated;
}
