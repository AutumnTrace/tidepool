import { fromRows, quantize, type Matrix } from './matrix';
import { DEFAULT_PARAMS, type SimParams } from './params';

/**
 * Named starting points. Most of these were found the honest way: render a
 * few hundred random matrices as a contact sheet, keep the ones that do
 * something you can name. The structured ones (Necklaces, Boil, Swimmers)
 * are classic ring-shaped rules where species i only cares about i +/- 1.
 */
export interface Preset {
  id: string;
  name: string;
  /** One line shown under the preset buttons. */
  blurb: string;
  seed: number;
  params: SimParams;
  matrix: Matrix;
}

function ring(k: number, self: number, next: number, prev: number, rest: number): Matrix {
  const rows: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      const v = j === i ? self : j === (i + 1) % k ? next : j === (i + k - 1) % k ? prev : rest;
      row.push(quantize(v));
    }
    rows.push(row);
  }
  return fromRows(rows);
}

function preset(
  id: string,
  name: string,
  blurb: string,
  seed: number,
  params: Partial<SimParams>,
  matrix: Matrix,
): Preset {
  return { id, name, blurb, seed, params: { ...DEFAULT_PARAMS, ...params, species: matrix.k }, matrix };
}

export const PRESETS: readonly Preset[] = [
  preset(
    'tidepool',
    'Tidepool',
    'Six species, rules picked at random and kept because they never quite settle.',
    1,
    {},
    fromRows([
      [0.23, 0.34, 0.1, -0.36, -0.7, 0.43],
      [-0.23, 0.87, 0.35, 0.92, -0.78, -0.4],
      [0, -0.51, -0.54, -0.24, -0.65, 0.9],
      [-0.64, -0.18, -0.6, -0.42, 0.48, -0.49],
      [0.51, -0.78, -0.45, 0.65, 0.52, -0.09],
      [-0.38, -0.04, 0.55, 0.31, 0.2, -0.78],
    ]),
  ),
  preset(
    'caterpillars',
    'Caterpillars',
    'Short segmented bodies, each a stack of species chasing the segment ahead.',
    2,
    {},
    fromRows([
      [-0.59, -0.37, 0.06, 0.78, 0.1, 0.37],
      [-0.97, 0.04, -0.54, 0, 0.26, -0.62],
      [-0.73, -0.51, -0.3, 0.93, -0.89, 0.01],
      [-0.53, -0.58, 0.44, 0.13, 0.73, -0.77],
      [0.28, 0.35, -0.53, -0.67, 0.73, -0.86],
      [0.97, 0.96, 0.5, -0.26, -0.29, 0.32],
    ]),
  ),
  preset(
    'cells',
    'Cells',
    'Three species. Sea glass wraps the other two in membranes and the tissue tiles the world.',
    3,
    {},
    fromRows([
      [0.23, -0.73, -0.53],
      [-0.65, -0.27, -0.75],
      [0.5, 0.67, 0.32],
    ]),
  ),
  preset(
    'eyes',
    'Eyes',
    'Gold and sea-glass pupils ringed in pink, drifting through a loose pink sea.',
    4,
    {},
    fromRows([
      [-0.01, -0.47, 0.59],
      [1, 0.24, 0.68],
      [-0.96, 0.76, -0.44],
    ]),
  ),
  preset(
    'necklaces',
    'Necklaces',
    'Symmetric ring rules: like yourself, tolerate your neighbours, hate everyone else. Settles into beads.',
    5,
    {},
    ring(6, 1, 0.2, 0.2, -1),
  ),
  preset(
    'rainbow',
    'Rainbow',
    'All twelve species. Rainbow worms and clumps, busy everywhere.',
    6,
    {},
    fromRows([
      [-0.12, -0.14, -0.25, 0.68, -0.9, -0.67, -0.11, -0.25, 0, 0.77, 0.82, 0.67],
      [0.82, -0.53, -0.79, -0.3, -0.9, -0.05, 0.29, -0.19, 0.49, -0.63, 0.72, -0.89],
      [0.17, -0.14, -0.66, 0.51, -0.3, 0.95, -0.21, -0.23, -0.66, -0.59, 0.55, -0.41],
      [-0.41, -0.32, 0.33, -0.51, -0.95, -0.84, 0.2, 0.39, 0.79, 0.4, 0.67, -0.53],
      [0.28, -0.13, 0.26, 0.13, -0.78, 0.48, 0.13, 0.05, 0.29, 0.01, -0.53, 0.6],
      [-0.59, -0.14, 0.74, -0.54, -0.91, -0.74, 0.32, -0.64, 0.78, -0.46, -0.4, -0.84],
      [0.19, -0.77, -0.14, 0.93, 0.59, -0.19, 0.43, 0.91, -0.27, 0, 0.54, -0.4],
      [-0.94, -0.56, -0.95, 0.12, -0.94, -0.51, 0.88, 0.45, -0.01, 0.9, -0.12, -0.03],
      [0.61, -0.29, 0.03, 0.39, 0.89, -0.25, 0.25, 0.77, -0.5, 0.49, -0.28, 0.4],
      [0.44, -0.74, 0.74, -0.85, -1, 0.95, 0.21, 0.55, -0.25, 0.33, 0.93, 1],
      [-0.36, 0.36, 0.84, -0.12, 0.71, -0.44, -0.28, -0.6, -0.99, -0.57, -0.4, -0.24],
      [-0.02, -0.07, 0.95, -0.71, 0.99, -0.38, 0.85, -0.57, 0.89, 0.26, 0.15, -0.64],
    ]),
  ),
  preset(
    'boil',
    'Boil',
    'Everyone chases the next species and runs from the previous one. Never calms down.',
    7,
    {},
    ring(5, 0.1, 0.5, -0.3, -0.1),
  ),
  preset(
    'swimmers',
    'Swimmers',
    'Necklaces with the symmetry broken: next-door attraction is one-sided, so clusters swim.',
    8,
    {},
    ring(6, 1, 0.3, 0.1, -1),
  ),
  preset(
    'mosaic',
    'Mosaic',
    'Three species packed into a tiled floor that never quite stops shifting.',
    9,
    {},
    fromRows([
      [0.86, 0.61, -0.31],
      [0.02, -0.28, 0.31],
      [-0.36, -0.28, -0.65],
    ]),
  ),
];

/** The preset a state came from, if its rules and physics still match one. */
export function matchPreset(state: { params: SimParams; matrix: Matrix }): Preset | null {
  const { params, matrix } = state;
  return (
    PRESETS.find(
      (p) =>
        p.matrix.k === matrix.k &&
        p.matrix.values.every((v, i) => v === matrix.values[i]) &&
        p.params.density === params.density &&
        p.params.force === params.force &&
        p.params.friction === params.friction &&
        p.params.beta === params.beta,
    ) ?? null
  );
}
