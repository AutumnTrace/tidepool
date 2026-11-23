/** Interaction radius. Everything else is measured in multiples of it. */
export const R_MAX = 1;
/** Physics timestep in seconds. Fixed: the integrator never sees frame time. */
export const DT = 0.02;
export const MAX_SPECIES = 12;
export const MIN_SPECIES = 2;
/** Species index lives in the low 4 bits of a particle's tag, id above it. */
export const SPECIES_BITS = 4;
export const SPECIES_MASK = (1 << SPECIES_BITS) - 1;
/** Hard cap on the grid edge so the bin buffers stay sane. */
export const MAX_GRID = 2048;

export interface SimParams {
  /** Number of particles. */
  count: number;
  /** Number of species, 2..12. */
  species: number;
  /**
   * Mean number of neighbours inside R_MAX if particles were spread
   * uniformly. This, not the particle count, decides how crowded it feels:
   * the world grows with the count so local physics stays the same.
   */
  density: number;
  /** Force multiplier. */
  force: number;
  /** Velocity half-life in seconds (lower = more friction). */
  friction: number;
  /** Radius of the universal short-range repulsion, as a fraction of R_MAX. */
  beta: number;
}

export interface World {
  /** Edge length of the square, toroidal world. */
  size: number;
  /** Bins per edge. */
  grid: number;
  /** Bin edge length; always >= R_MAX so a 3x3 neighbourhood is enough. */
  cell: number;
  /** grid * grid */
  bins: number;
}

export const PARAM_LIMITS = {
  count: { min: 1024, max: 1 << 20 },
  species: { min: MIN_SPECIES, max: MAX_SPECIES },
  density: { min: 4, max: 120 },
  force: { min: 0.5, max: 40 },
  friction: { min: 0.005, max: 1 },
  beta: { min: 0.05, max: 0.6 },
} as const satisfies Record<keyof SimParams, { min: number; max: number }>;

export const DEFAULT_PARAMS: SimParams = {
  count: 1 << 16,
  species: 6,
  density: 80,
  force: 10,
  friction: 0.04,
  beta: 0.3,
};

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function worldFor(count: number, density: number): World {
  const area = (count * Math.PI * R_MAX * R_MAX) / density;
  const size = Math.max(Math.sqrt(area), 3 * R_MAX);
  const grid = clamp(Math.floor(size / R_MAX), 3, MAX_GRID);
  return { size, grid, cell: size / grid, bins: grid * grid };
}

/** Per-step velocity multiplier for a given half-life. */
export function frictionFactor(halfLife: number, dt = DT): number {
  return Math.pow(0.5, dt / halfLife);
}

/** Slider resolution for each tunable; URL values are snapped to these. */
export const PARAM_STEPS = {
  density: 1,
  force: 0.1,
  friction: 0.005,
  beta: 0.01,
} as const;

export function snap(v: number, step: number): number {
  // Decimal places of the step itself: 0.25 needs two, not the one that
  // log10 would suggest.
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number((Math.round(v / step) * step).toFixed(decimals));
}
