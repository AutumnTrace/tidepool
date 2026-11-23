// Full-screen passes: the trail fade and the final tone-map to the canvas.

struct Composite {
  size: vec2f,
  exposure: f32,
  _pad: f32,
}

@group(0) @binding(0) var hdr: texture_2d<f32>;
@group(0) @binding(1) var<uniform> C: Composite;

@vertex
fn fullscreen(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  // One triangle that covers the screen.
  let uv = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}

// The fade pass writes nothing useful: the blend state (dst * constant)
// does the work.
@fragment
fn fade() -> @location(0) vec4f {
  return vec4f(0.0);
}

fn linearToSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn composite(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let light = textureLoad(hdr, vec2i(frag.xy), 0).rgb;
  let uv = frag.xy / C.size;
  // Deep water: a faint blue lift in the middle, darker at the corners.
  let r = length((uv - 0.5) * vec2f(C.size.x / C.size.y, 1.0));
  let water = vec3f(0.0016, 0.0024, 0.0052) * (1.25 - r);
  // Per-channel exponential tone curve: bright clusters run to white,
  // single particles keep their colour.
  var color = 1.0 - exp(-(light * C.exposure + max(water, vec3f(0.0))));
  color = linearToSrgb(color);
  // Half an 8-bit step of noise hides banding in the dark gradients.
  color += (hash(frag.xy) - 0.5) / 255.0;
  return vec4f(color, 1.0);
}
