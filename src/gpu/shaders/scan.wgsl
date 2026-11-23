// Exclusive prefix sum, one level of a multi-level scan.
//
// scanBlocks: each workgroup scans a block of 1024 u32s in place (256
// threads x one vec4 each) and writes the block's total to `sums`.
// addSums: after `sums` itself has been scanned, adds each block's offset
// back onto the block.
//
// Inside a block: every thread scans its own vec4 serially, the 256 thread
// totals are scanned in workgroup memory (Hillis-Steele, 8 rounds), and the
// thread's exclusive prefix is added back onto its four values.

struct ScanInfo {
  n: u32,
}

@group(0) @binding(0) var<storage, read_write> data: array<vec4u>;
@group(0) @binding(1) var<storage, read_write> sums: array<u32>;
@group(0) @binding(2) var<uniform> info: ScanInfo;

const WG = 256u;
var<workgroup> partial: array<u32, WG>;

@compute @workgroup_size(WG)
fn scanBlocks(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let vi = wid.x * WG + li;
  let first = vi * 4u;
  var x = data[vi];
  // Anything past n is padding: count it as zero.
  x = select(vec4u(0u), x, vec4u(first) + vec4u(0u, 1u, 2u, 3u) < vec4u(info.n));
  let s1 = x.x;
  let s2 = s1 + x.y;
  let s3 = s2 + x.z;
  let total = s3 + x.w;

  partial[li] = total;
  workgroupBarrier();
  for (var offset = 1u; offset < WG; offset <<= 1u) {
    var t = 0u;
    if (li >= offset) {
      t = partial[li - offset];
    }
    workgroupBarrier();
    partial[li] += t;
    workgroupBarrier();
  }

  let prefix = partial[li] - total;
  data[vi] = vec4u(prefix, prefix + s1, prefix + s2, prefix + s3);
  if (li == WG - 1u) {
    sums[wid.x] = partial[li];
  }
}

@compute @workgroup_size(WG)
fn addSums(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wid: vec3u) {
  let vi = wid.x * WG + li;
  data[vi] += vec4u(sums[wid.x]);
}
