// Shared by every simulation pass. Layout must match packParams() in params-buffer.ts.
struct Params {
  count: u32,
  species: u32,
  grid: u32,
  bins: u32,
  worldSize: f32,
  invCell: f32,
  rMax: f32,
  beta: f32,
  forceScale: f32,
  friction: f32,
  dt: f32,
  pointerRadius: f32,
  pointer: vec2f,
  pointerStrength: f32,
  _pad: f32,
  // 12 x 12 attraction matrix, row = species being pushed, column = species pushing.
  matrix: array<vec4f, 36>,
}

const SPECIES_MASK = 15u;

fn attraction(row: u32, col: u32) -> f32 {
  let idx = row * 12u + col;
  return P.matrix[idx >> 2u][idx & 3u];
}

// Same as kernel() in src/sim/kernel.ts. r is in units of rMax.
fn kernel(r: f32, a: f32) -> f32 {
  if (r < P.beta) {
    return r / P.beta - 1.0;
  }
  return a * (1.0 - abs(2.0 * r - 1.0 - P.beta) / (1.0 - P.beta));
}

// Shortest vector from a to b on the torus.
fn torusDelta(a: vec2f, b: vec2f) -> vec2f {
  var d = b - a;
  let half = 0.5 * P.worldSize;
  d = select(d, d - P.worldSize, d > vec2f(half));
  d = select(d, d + P.worldSize, d < vec2f(-half));
  return d;
}

fn wrapPosition(p: vec2f) -> vec2f {
  var q = p - P.worldSize * floor(p / P.worldSize);
  // floor() can leave q == worldSize for tiny negative p; keep it in [0, size).
  q = select(q, vec2f(0.0), q >= vec2f(P.worldSize));
  return q;
}

// Acceleration contribution from the pointer: radial, smooth falloff.
fn pointerAccel(p: vec2f) -> vec2f {
  if (P.pointerStrength == 0.0) {
    return vec2f(0.0);
  }
  let d = torusDelta(p, P.pointer);
  let r = length(d);
  if (r >= P.pointerRadius || r < 1e-6) {
    return vec2f(0.0);
  }
  let falloff = 1.0 - r / P.pointerRadius;
  return (d / r) * P.pointerStrength * falloff * falloff;
}
