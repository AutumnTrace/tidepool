// Instanced glow sprites, added into an rgba16float buffer.
//
// The world is a torus, so when the view is wider than the world the same
// particle is drawn once per visible tile: instance i is particle i % count
// in tile i / count. Sprites that land off screen collapse to a point
// outside the clip volume and cost nothing past the vertex stage.

struct View {
  center: vec2f,
  // world units -> clip space
  scale: vec2f,
  worldSize: f32,
  // sprite half-size in world units, after the minimum-pixel clamp
  radius: f32,
  // brightness per sprite, after energy compensation
  intensity: f32,
  count: u32,
  tileOrigin: vec2f,
  tilesX: u32,
  _pad: u32,
  palette: array<vec4f, 12>,
}

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> pos: array<vec2f>;
@group(0) @binding(2) var<storage, read> tags: array<u32>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  let p = ii % V.count;
  let t = ii / V.count;
  let tile = V.tileOrigin + vec2f(f32(t % V.tilesX), f32(t / V.tilesX));
  let center = (pos[p] + tile * V.worldSize - V.center) * V.scale;
  let half = V.radius * abs(V.scale);
  if (any(abs(center) > vec2f(1.0) + half)) {
    out.clip = vec4f(2.0, 2.0, 2.0, 1.0);
    return out;
  }
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  out.clip = vec4f(center + corner * half, 0.0, 1.0);
  out.uv = corner;
  out.color = V.palette[tags[p] & 15u].rgb * V.intensity;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d2 = dot(in.uv, in.uv);
  // A tight core plus a wide, faint halo; overlapping halos are what make
  // dense clusters bloom once they go through the tone curve.
  let core = exp(-d2 * 9.0);
  let halo = exp(-d2 * 3.0) * 0.08;
  let fade = 1.0 - smoothstep(0.7, 1.0, d2);
  return vec4f(in.color * (core + halo) * fade, 0.0);
}
