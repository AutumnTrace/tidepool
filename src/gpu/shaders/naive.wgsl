// Brute force O(N^2) step: every particle looks at every other particle,
// streamed through workgroup memory one 256-particle tile at a time.
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> posIn: array<vec2f>;
@group(0) @binding(2) var<storage, read> velIn: array<vec2f>;
@group(0) @binding(3) var<storage, read> tags: array<u32>;
@group(0) @binding(4) var<storage, read_write> posOut: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> velOut: array<vec2f>;

const TILE = 256u;
var<workgroup> tilePos: array<vec2f, TILE>;
var<workgroup> tileSpecies: array<u32, TILE>;

@compute @workgroup_size(TILE)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) li: u32) {
  let i = gid.x;
  let live = i < P.count;
  let self_i = min(i, P.count - 1u);
  let p = posIn[self_i];
  let mine = tags[self_i] & SPECIES_MASK;
  let rMax2 = P.rMax * P.rMax;

  var force = vec2f(0.0);
  for (var base = 0u; base < P.count; base += TILE) {
    let j = base + li;
    if (j < P.count) {
      tilePos[li] = posIn[j];
      tileSpecies[li] = tags[j] & SPECIES_MASK;
    }
    workgroupBarrier();
    let n = min(TILE, P.count - base);
    for (var k = 0u; k < n; k++) {
      let d = torusDelta(p, tilePos[k]);
      let r2 = dot(d, d);
      if (r2 > 0.0 && r2 < rMax2) {
        let r = sqrt(r2);
        force += (d / r) * kernel(r / P.rMax, attraction(mine, tileSpecies[k]));
      }
    }
    workgroupBarrier();
  }

  if (!live) {
    return;
  }
  let accel = force * P.forceScale + pointerAccel(p);
  let v = velIn[i] * P.friction + accel * P.dt;
  posOut[i] = wrapPosition(p + v * P.dt);
  velOut[i] = v;
}
