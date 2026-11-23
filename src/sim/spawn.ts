import { createRng } from './rng';
import { SPECIES_BITS } from './params';

/**
 * Particle state as it lives on the GPU: structure of arrays.
 * tags[i] packs (id << 4) | species. The id survives the per-frame
 * re-sorting, which is what lets tests line GPU output up with the CPU
 * reference.
 */
export interface ParticleState {
  pos: Float32Array; // x, y interleaved
  vel: Float32Array; // vx, vy interleaved
  tags: Uint32Array;
}

export function spawn(count: number, species: number, worldSize: number, seed: number): ParticleState {
  const rng = createRng(seed);
  const pos = new Float32Array(count * 2);
  const vel = new Float32Array(count * 2);
  const tags = new Uint32Array(count);
  // The GPU sees the world size as an f32; a coordinate that rounds up to it
  // would land one bin past the end, so fold it back to 0.
  const edge = Math.fround(worldSize);
  for (let i = 0; i < count; i++) {
    const x = Math.fround(rng.next() * worldSize);
    const y = Math.fround(rng.next() * worldSize);
    pos[i * 2] = x >= edge ? 0 : x;
    pos[i * 2 + 1] = y >= edge ? 0 : y;
    // Round-robin species: every species gets the same share.
    tags[i] = ((i << SPECIES_BITS) | (i % species)) >>> 0;
  }
  return { pos, vel, tags };
}
