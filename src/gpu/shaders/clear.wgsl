// Zeroes the bin counters (and the scan's padding) before counting.
@group(0) @binding(0) var<storage, read_write> data: array<vec4u>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x < arrayLength(&data)) {
    data[gid.x] = vec4u(0u);
  }
}
