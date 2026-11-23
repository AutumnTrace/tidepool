/**
 * The particle-life force kernel, in units of the interaction radius.
 *
 *   r < beta       hard-ish repulsion, linear from -1 at r=0 to 0 at r=beta
 *   beta <= r < 1  triangular bump scaled by the attraction a, peaking at the
 *                  midpoint (1+beta)/2 and falling back to 0 at r=1
 *   r >= 1         nothing
 *
 * It is continuous everywhere, which matters: a discontinuity at r=beta or
 * r=1 makes particles "buzz" at the boundary. The WGSL version in
 * shaders/common.wgsl must stay identical to this one; the CPU reference and
 * the unit tests use this.
 */
export function kernel(r: number, a: number, beta: number): number {
  if (r < beta) return r / beta - 1;
  if (r < 1) return a * (1 - Math.abs(2 * r - 1 - beta) / (1 - beta));
  return 0;
}
