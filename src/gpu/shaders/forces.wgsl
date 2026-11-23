// Pass 4: forces from the 3x3 neighbouring bins, then integration.
// Reads the bin-sorted buffers and writes the next state back into the
// primary buffers in sorted order, so particle order changes every step.
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> binStart: array<u32>;
@group(0) @binding(2) var<storage, read> sortedPos: array<vec2f>;
@group(0) @binding(3) var<storage, read> sortedVel: array<vec2f>;
@group(0) @binding(4) var<storage, read> sortedTags: array<u32>;
@group(0) @binding(5) var<storage, read_write> pos: array<vec2f>;
@group(0) @binding(6) var<storage, read_write> vel: array<vec2f>;
@group(0) @binding(7) var<storage, read_write> tags: array<u32>;

// Sum of forces on a particle at p from sorted particles [start, end).
// `shift` moves neighbours across the wrap seam into p's frame, so the
// inner loop never has to think about the torus.
fn accumulate(p: vec2f, mine: u32, start: u32, end: u32, shift: vec2f) -> vec2f {
  let local = p - shift;
  let rMax2 = P.rMax * P.rMax;
  let invRMax = 1.0 / P.rMax;
  var f = vec2f(0.0);
  for (var j = start; j < end; j++) {
    let d = sortedPos[j] - local;
    let r2 = dot(d, d);
    if (r2 > 0.0 && r2 < rMax2) {
      let r = sqrt(r2);
      let a = attraction(mine, sortedTags[j] & SPECIES_MASK);
      f += d * (kernel(r * invRMax, a) / r);
    }
  }
  return f;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) {
    return;
  }
  let p = sortedPos[i];
  let mine = sortedTags[i] & SPECIES_MASK;
  let c = vec2i(cellOf(p));
  let g = i32(P.grid);

  var force = vec2f(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    var y = c.y + dy;
    var shiftY = 0.0;
    if (y < 0) {
      y += g;
      shiftY = -P.worldSize;
    } else if (y >= g) {
      y -= g;
      shiftY = P.worldSize;
    }
    let row = u32(y) * P.grid;
    if (c.x >= 1 && c.x <= g - 2) {
      // Bins are row-major, so x-1, x, x+1 in one row are one contiguous
      // run of the sorted buffer: a single loop instead of three.
      let start = binStart[row + u32(c.x - 1)];
      let end = binStart[row + u32(c.x + 2)];
      force += accumulate(p, mine, start, end, vec2f(0.0, shiftY));
    } else {
      for (var dx = -1; dx <= 1; dx++) {
        var x = c.x + dx;
        var shiftX = 0.0;
        if (x < 0) {
          x += g;
          shiftX = -P.worldSize;
        } else if (x >= g) {
          x -= g;
          shiftX = P.worldSize;
        }
        let b = row + u32(x);
        force += accumulate(p, mine, binStart[b], binStart[b + 1u], vec2f(shiftX, shiftY));
      }
    }
  }

  let accel = force * P.forceScale + pointerAccel(p);
  let v = sortedVel[i] * P.friction + accel * P.dt;
  pos[i] = wrapPosition(p + v * P.dt);
  vel[i] = v;
  tags[i] = sortedTags[i];
}
