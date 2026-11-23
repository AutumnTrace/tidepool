import scanSrc from './shaders/scan.wgsl?raw';
import type { GpuTimer } from './timing';

/** Elements handled by one scan workgroup: 256 threads x vec4. */
export const SCAN_BLOCK = 1024;

const roundUp = (n: number, m: number) => Math.ceil(n / m) * m;

interface Level {
  n: number;
  blocks: number;
  buffer: GPUBuffer;
  scanGroup: GPUBindGroup;
  addGroup: GPUBindGroup | null;
}

/**
 * In-place exclusive prefix sum over a u32 buffer of arbitrary length.
 *
 * Level 0 scans 1024-element blocks of the input and writes one total per
 * block into level 1's buffer; level 1 does the same to level 2, and so on
 * until a level fits in a single block. Then the scanned totals are added
 * back down the chain. Three levels cover 2^30 elements.
 */
export class PrefixSum {
  /** The buffer being scanned. Padded to a multiple of SCAN_BLOCK u32s. */
  readonly buffer: GPUBuffer;
  readonly levels: Level[] = [];
  private readonly scanPipeline: GPUComputePipeline;
  private readonly addPipeline: GPUComputePipeline;
  private readonly owned: GPUBuffer[] = [];

  constructor(
    device: GPUDevice,
    readonly length: number,
    label = 'scan',
  ) {
    const module = device.createShaderModule({ label, code: scanSrc });
    this.scanPipeline = device.createComputePipeline({
      label: `${label} blocks`,
      layout: 'auto',
      compute: { module, entryPoint: 'scanBlocks' },
    });
    this.addPipeline = device.createComputePipeline({
      label: `${label} add`,
      layout: 'auto',
      compute: { module, entryPoint: 'addSums' },
    });

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const sizes: number[] = [];
    for (let n = Math.max(1, length); ; n = Math.ceil(n / SCAN_BLOCK)) {
      sizes.push(n);
      if (n <= SCAN_BLOCK) break;
    }
    const buffers = sizes.map((n, i) => {
      const b = device.createBuffer({ label: `${label} L${i}`, size: roundUp(n, SCAN_BLOCK) * 4, usage });
      this.owned.push(b);
      return b;
    });
    // The top level still writes one total; give it somewhere to go.
    const sink = device.createBuffer({ label: `${label} sink`, size: 16, usage: GPUBufferUsage.STORAGE });
    this.owned.push(sink);
    this.buffer = buffers[0]!;

    sizes.forEach((n, i) => {
      const info = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
      new Uint32Array(info.getMappedRange())[0] = n;
      info.unmap();
      this.owned.push(info);
      const sums = buffers[i + 1] ?? sink;
      const scanGroup = device.createBindGroup({
        layout: this.scanPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers[i]! } },
          { binding: 1, resource: { buffer: sums } },
          { binding: 2, resource: { buffer: info } },
        ],
      });
      const addGroup =
        i + 1 < sizes.length
          ? device.createBindGroup({
              layout: this.addPipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: { buffer: buffers[i]! } },
                { binding: 1, resource: { buffer: sums } },
              ],
            })
          : null;
      this.levels.push({ n, blocks: roundUp(n, SCAN_BLOCK) / SCAN_BLOCK, buffer: buffers[i]!, scanGroup, addGroup });
    });
  }

  encode(encoder: GPUCommandEncoder, timer?: GpuTimer): void {
    const pass = encoder.beginComputePass({ label: 'scan', timestampWrites: timer?.pass('scan') });
    pass.setPipeline(this.scanPipeline);
    for (const level of this.levels) {
      pass.setBindGroup(0, level.scanGroup);
      pass.dispatchWorkgroups(level.blocks);
    }
    pass.setPipeline(this.addPipeline);
    for (let i = this.levels.length - 2; i >= 0; i--) {
      const level = this.levels[i]!;
      pass.setBindGroup(0, level.addGroup!);
      pass.dispatchWorkgroups(level.blocks);
    }
    pass.end();
  }

  destroy(): void {
    for (const b of this.owned) b.destroy();
  }
}
