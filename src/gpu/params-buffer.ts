import { DT, R_MAX, frictionFactor, type SimParams, type World } from '../sim/params';
import { packForGpu, type Matrix } from '../sim/matrix';

/** Byte size of the WGSL `Params` struct in shaders/common.wgsl. */
export const PARAMS_SIZE = 640;

export interface PointerForce {
  x: number;
  y: number;
  radius: number;
  /** > 0 pulls particles in, < 0 pushes them away, 0 is off. */
  strength: number;
}

export const NO_POINTER: PointerForce = { x: 0, y: 0, radius: 1, strength: 0 };

export function packParams(
  params: SimParams,
  world: World,
  matrix: Matrix,
  pointer: PointerForce = NO_POINTER,
): ArrayBuffer {
  const buf = new ArrayBuffer(PARAMS_SIZE);
  const u = new Uint32Array(buf);
  const f = new Float32Array(buf);
  u[0] = params.count;
  u[1] = params.species;
  u[2] = world.grid;
  u[3] = world.bins;
  f[4] = world.size;
  f[5] = 1 / world.cell;
  f[6] = R_MAX;
  f[7] = params.beta;
  f[8] = params.force * R_MAX;
  f[9] = frictionFactor(params.friction);
  f[10] = DT;
  f[11] = pointer.radius;
  f[12] = pointer.x;
  f[13] = pointer.y;
  f[14] = pointer.strength;
  f.set(packForGpu(matrix), 16);
  return buf;
}
