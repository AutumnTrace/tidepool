/**
 * CPU reference for one simulation step. It follows the GPU pipeline pass
 * for pass (count -> exclusive scan -> scatter -> 3x3 forces -> integrate)
 * so that tests can check each stage, but it does the arithmetic in float64
 * and with a deterministic (stable) order inside each bin.
 *
 * Constants that the GPU receives as f32 go through Math.fround so that bin
 * assignment matches the shader bit for bit; the products that decide a bin
 * are rounded the same way.
 */
import { kernel } from './kernel';
import { DT, R_MAX, SPECIES_MASK, frictionFactor, type SimParams, type World } from './params';
import { get, type Matrix } from './matrix';
import type { ParticleState } from './spawn';

export interface Pointer {
  x: number;
  y: number;
  radius: number;
  strength: number;
}

export interface StepConfig {
  params: SimParams;
  world: World;
  matrix: Matrix;
  pointer?: Pointer;
}

const f32 = Math.fround;

export function binOf(x: number, y: number, world: World): number {
  const inv = f32(1 / world.cell);
  const cx = Math.min(Math.floor(f32(x * inv)), world.grid - 1);
  const cy = Math.min(Math.floor(f32(y * inv)), world.grid - 1);
  return cy * world.grid + cx;
}

/** In-place exclusive scan; returns the total. */
export function exclusiveScan(data: Uint32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    data[i] = sum;
    sum = (sum + v) >>> 0;
  }
  return sum;
}

export interface Binned {
  /** bins + 1 entries; bin b holds sorted indices [start[b], start[b+1]). */
  start: Uint32Array;
  /** sorted index -> original index */
  order: Uint32Array;
}

/** Counting sort of particles into grid bins, stable within a bin. */
export function binParticles(pos: Float32Array, world: World): Binned {
  const n = pos.length / 2;
  const start = new Uint32Array(world.bins + 1);
  const bin = new Uint32Array(n);
  const rank = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const b = binOf(pos[i * 2]!, pos[i * 2 + 1]!, world);
    bin[i] = b;
    rank[i] = start[b]!++;
  }
  exclusiveScan(start);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[start[bin[i]!]! + rank[i]!] = i;
  return { start, order };
}

function wrap(v: number, size: number): number {
  let q = v - size * Math.floor(v / size);
  if (q >= size) q = 0;
  return q;
}

function torusDelta(a: number, b: number, size: number): number {
  let d = b - a;
  if (d > size / 2) d -= size;
  else if (d < -size / 2) d += size;
  return d;
}

function pointerAccel(px: number, py: number, p: Pointer | undefined, size: number): [number, number] {
  if (!p || p.strength === 0) return [0, 0];
  const dx = torusDelta(px, p.x, size);
  const dy = torusDelta(py, p.y, size);
  const r = Math.hypot(dx, dy);
  if (r >= p.radius || r < 1e-6) return [0, 0];
  const fall = 1 - r / p.radius;
  const s = (p.strength * fall * fall) / r;
  return [dx * s, dy * s];
}

function integrate(
  state: ParticleState,
  src: number,
  dst: number,
  fx: number,
  fy: number,
  cfg: StepConfig,
  out: ParticleState,
): void {
  const size = f32(cfg.world.size);
  const px = state.pos[src * 2]!;
  const py = state.pos[src * 2 + 1]!;
  const [pax, pay] = pointerAccel(px, py, cfg.pointer, size);
  const scale = cfg.params.force * R_MAX;
  const fric = frictionFactor(cfg.params.friction);
  const vx = state.vel[src * 2]! * fric + (fx * scale + pax) * DT;
  const vy = state.vel[src * 2 + 1]! * fric + (fy * scale + pay) * DT;
  out.pos[dst * 2] = f32(wrap(px + vx * DT, size));
  out.pos[dst * 2 + 1] = f32(wrap(py + vy * DT, size));
  // An f32 rounding can push a value that was just below the edge onto it.
  if (out.pos[dst * 2]! >= size) out.pos[dst * 2] = 0;
  if (out.pos[dst * 2 + 1]! >= size) out.pos[dst * 2 + 1] = 0;
  out.vel[dst * 2] = vx;
  out.vel[dst * 2 + 1] = vy;
  out.tags[dst] = state.tags[src]!;
}

function pairForce(
  state: ParticleState,
  i: number,
  j: number,
  cfg: StepConfig,
  acc: [number, number],
): void {
  if (i === j) return;
  const size = f32(cfg.world.size);
  const dx = torusDelta(state.pos[i * 2]!, state.pos[j * 2]!, size);
  const dy = torusDelta(state.pos[i * 2 + 1]!, state.pos[j * 2 + 1]!, size);
  const r2 = dx * dx + dy * dy;
  if (r2 <= 0 || r2 >= R_MAX * R_MAX) return;
  const r = Math.sqrt(r2);
  const a = get(cfg.matrix, state.tags[i]! & SPECIES_MASK, state.tags[j]! & SPECIES_MASK);
  const k = kernel(r / R_MAX, a, cfg.params.beta) / r;
  acc[0] += dx * k;
  acc[1] += dy * k;
}

function emptyState(n: number): ParticleState {
  return { pos: new Float32Array(n * 2), vel: new Float32Array(n * 2), tags: new Uint32Array(n) };
}

/**
 * One step using the grid, exactly as the GPU does it. Output is in
 * bin-sorted order, like the GPU's.
 */
export function stepGrid(state: ParticleState, cfg: StepConfig): ParticleState {
  const { world } = cfg;
  const n = state.tags.length;
  const { start, order } = binParticles(state.pos, world);
  const out = emptyState(n);
  const g = world.grid;
  const acc: [number, number] = [0, 0];
  for (let s = 0; s < n; s++) {
    const i = order[s]!;
    const b = binOf(state.pos[i * 2]!, state.pos[i * 2 + 1]!, world);
    const cx = b % g;
    const cy = (b - cx) / g;
    acc[0] = 0;
    acc[1] = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nb = ((cy + dy + g) % g) * g + ((cx + dx + g) % g);
        for (let k = start[nb]!; k < start[nb + 1]!; k++) pairForce(state, i, order[k]!, cfg, acc);
      }
    }
    integrate(state, i, s, acc[0], acc[1], cfg, out);
  }
  return out;
}

/** O(N^2) step with no grid at all. Output keeps the input order. */
export function stepBruteForce(state: ParticleState, cfg: StepConfig): ParticleState {
  const n = state.tags.length;
  const out = emptyState(n);
  const acc: [number, number] = [0, 0];
  for (let i = 0; i < n; i++) {
    acc[0] = 0;
    acc[1] = 0;
    for (let j = 0; j < n; j++) pairForce(state, i, j, cfg, acc);
    integrate(state, i, i, acc[0], acc[1], cfg, out);
  }
  return out;
}

/** Reorders a state so that index == particle id (tags >> 4). */
export function byId(state: ParticleState): ParticleState {
  const n = state.tags.length;
  const out = emptyState(n);
  for (let s = 0; s < n; s++) {
    const id = state.tags[s]! >>> 4;
    out.pos[id * 2] = state.pos[s * 2]!;
    out.pos[id * 2 + 1] = state.pos[s * 2 + 1]!;
    out.vel[id * 2] = state.vel[s * 2]!;
    out.vel[id * 2 + 1] = state.vel[s * 2 + 1]!;
    out.tags[id] = state.tags[s]!;
  }
  return out;
}

export interface StateDiff {
  maxPos: number;
  maxVel: number;
  /** ids that are missing or duplicated, which would mean the sort lost a particle. */
  badIds: number;
}

/** Largest per-particle differences, matching particles by id; positions compared on the torus. */
export function compareStates(a: ParticleState, b: ParticleState, worldSize: number): StateDiff {
  const n = a.tags.length;
  const A = byId(a);
  const B = byId(b);
  let maxPos = 0;
  let maxVel = 0;
  let badIds = 0;
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    const id = b.tags[s]! >>> 4;
    if (id >= n || seen[id]) badIds++;
    else seen[id] = 1;
  }
  for (let i = 0; i < n; i++) {
    if (A.tags[i] !== B.tags[i]) badIds++;
    const dx = torusDelta(A.pos[i * 2]!, B.pos[i * 2]!, worldSize);
    const dy = torusDelta(A.pos[i * 2 + 1]!, B.pos[i * 2 + 1]!, worldSize);
    maxPos = Math.max(maxPos, Math.hypot(dx, dy));
    maxVel = Math.max(maxVel, Math.hypot(A.vel[i * 2]! - B.vel[i * 2]!, A.vel[i * 2 + 1]! - B.vel[i * 2 + 1]!));
  }
  return { maxPos, maxVel, badIds };
}
