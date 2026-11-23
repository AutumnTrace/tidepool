/**
 * Species colours. Picked by eye against the near-black background with
 * additive blending in mind: the first six are as far apart as possible,
 * because six species is the default, and everything is saturated enough that
 * overlapping glows brighten towards white instead of going muddy.
 */
export const PALETTE: readonly string[] = [
  '#ff4f7b', // anemone
  '#2fe0c3', // sea glass
  '#ffc23d', // sun
  '#8f7bff', // urchin
  '#93e04f', // kelp
  '#ff7f3f', // coral
  '#3fa2ff', // lagoon
  '#f0e9ff', // foam
  '#e94fe0', // nudibranch
  '#4fffa4', // algae
  '#c9ff3f', // lime
  '#3fe0ff', // shallows
];

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** sRGB -> linear, for colours that are summed in the HDR buffer. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export const SPECIES_NAMES: readonly string[] = [
  'anemone',
  'sea glass',
  'sun',
  'urchin',
  'kelp',
  'coral',
  'lagoon',
  'foam',
  'nudibranch',
  'algae',
  'lime',
  'shallows',
];
