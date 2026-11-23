// Pass 1 of the counting sort: histogram of particles per bin.
// atomicAdd hands back the old count, which doubles as the particle's slot
// inside its bin, so the scatter pass needs no atomics of its own.
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> pos: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> binCounts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> rank: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) {
    return;
  }
  rank[i] = atomicAdd(&binCounts[binOf(pos[i])], 1u);
}
