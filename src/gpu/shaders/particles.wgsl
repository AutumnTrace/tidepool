struct View {
  center: vec2f,
  // world units -> clip space
  scale: vec2f,
  worldSize: f32,
  // sprite radius in world units
  radius: f32,
  intensity: f32,
  _pad: f32,
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
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  // Draw the copy of the particle nearest the camera centre.
  var d = pos[ii] - V.center;
  d -= V.worldSize * round(d / V.worldSize);
  let world = d + corner * V.radius;
  var out: VOut;
  out.clip = vec4f(world * V.scale, 0.0, 1.0);
  out.uv = corner;
  out.color = V.palette[tags[ii] & 15u].rgb * V.intensity;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) {
    discard;
  }
  let glow = exp(-r2 * 5.0);
  return vec4f(in.color * glow, glow);
}
