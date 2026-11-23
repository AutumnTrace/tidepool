// Pass 3 of the counting sort: copy every particle to its slot in the
// bin-sorted buffers. binStart is the exclusive scan of the bin counts.
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> pos: array<vec2f>;
@group(0) @binding(2) var<storage, read> vel: array<vec2f>;
@group(0) @binding(3) var<storage, read> tags: array<u32>;
@group(0) @binding(4) var<storage, read> rank: array<u32>;
@group(0) @binding(5) var<storage, read> binStart: array<u32>;
@group(0) @binding(6) var<storage, read_write> sortedPos: array<vec2f>;
@group(0) @binding(7) var<storage, read_write> sortedVel: array<vec2f>;
@group(0) @binding(8) var<storage, read_write> sortedTags: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) {
    return;
  }
  let p = pos[i];
  let dst = binStart[binOf(p)] + rank[i];
  sortedPos[dst] = p;
  sortedVel[dst] = vel[i];
  sortedTags[dst] = tags[i];
}
