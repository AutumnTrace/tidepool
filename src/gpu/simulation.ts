import common from './shaders/common.wgsl?raw';
import clearSrc from './shaders/clear.wgsl?raw';
import countSrc from './shaders/count.wgsl?raw';
import scatterSrc from './shaders/scatter.wgsl?raw';
import forcesSrc from './shaders/forces.wgsl?raw';
import naiveSrc from './shaders/naive.wgsl?raw';
import { PARAMS_SIZE, packParams, NO_POINTER, type PointerForce } from './params-buffer';
import { PrefixSum } from './prefix-sum';
import type { GpuTimer } from './timing';
import { worldFor, type SimParams, type World } from '../sim/params';
import type { Matrix } from '../sim/matrix';
import type { ParticleState } from '../sim/spawn';

const WORKGROUP = 256;

/**
 * 'grid' is the real thing. 'brute' is the O(N^2) baseline it replaced,
 * kept around for benchmarks and as a second opinion in tests.
 */
export type Method = 'grid' | 'brute';

/**
 * Owns the particle buffers and the compute pipelines that advance them.
 *
 * One grid step is five passes:
 *   clear    zero the per-bin counters
 *   count    atomicAdd per particle into its bin; remember the returned slot
 *   scan     exclusive prefix sum of the counts -> first index of each bin
 *   scatter  copy each particle to binStart[bin] + slot (a counting sort)
 *   forces   read the 3x3 neighbouring bins, integrate, write back
 */
export class Simulation {
  readonly world: World;
  readonly method: Method;
  private params: SimParams;
  private matrix: Matrix;
  private pointer: PointerForce = NO_POINTER;
  private dirty = true;

  private readonly uniform: GPUBuffer;
  readonly pos: GPUBuffer;
  readonly vel: GPUBuffer;
  readonly tags: GPUBuffer;
  private readonly sortedPos: GPUBuffer;
  private readonly sortedVel: GPUBuffer;
  private readonly sortedTags: GPUBuffer;
  private readonly rank: GPUBuffer;
  /** Bin counts, scanned in place into bin start offsets. bins + 1 entries. */
  readonly scan: PrefixSum;

  private readonly pipelines: Record<'clear' | 'count' | 'scatter' | 'forces' | 'brute', GPUComputePipeline>;
  private readonly groups: Record<'clear' | 'count' | 'scatter' | 'forces' | 'brute', GPUBindGroup>;

  constructor(
    readonly device: GPUDevice,
    params: SimParams,
    matrix: Matrix,
    state: ParticleState,
    method: Method = 'grid',
  ) {
    this.params = { ...params };
    this.matrix = matrix;
    this.method = method;
    this.world = worldFor(params.count, params.density);
    const n = params.count;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const make = (label: string, size: number, usage = storage) => device.createBuffer({ label, size, usage });

    this.uniform = make('params', PARAMS_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.pos = make('pos', n * 8);
    this.vel = make('vel', n * 8);
    this.tags = make('tags', n * 4);
    this.sortedPos = make('sorted pos', n * 8);
    this.sortedVel = make('sorted vel', n * 8);
    this.sortedTags = make('sorted tags', n * 4);
    this.rank = make('rank', n * 4);
    // One extra bin whose count is always 0: after the scan it holds N, so
    // the end of bin b is always binStart[b + 1], even for the last bin.
    this.scan = new PrefixSum(device, this.world.bins + 1, 'bin scan');

    const pipeline = (label: string, code: string) =>
      device.createComputePipeline({
        label,
        layout: 'auto',
        compute: { module: device.createShaderModule({ label, code }), entryPoint: 'main' },
      });
    this.pipelines = {
      clear: pipeline('clear', clearSrc),
      count: pipeline('count', common + countSrc),
      scatter: pipeline('scatter', common + scatterSrc),
      forces: pipeline('forces', common + forcesSrc),
      brute: pipeline('brute force', common + naiveSrc),
    };

    const group = (name: keyof typeof this.pipelines, buffers: GPUBuffer[]) =>
      device.createBindGroup({
        label: name,
        layout: this.pipelines[name].getBindGroupLayout(0),
        entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    const bins = this.scan.buffer;
    this.groups = {
      clear: group('clear', [bins]),
      count: group('count', [this.uniform, this.pos, bins, this.rank]),
      scatter: group('scatter', [
        this.uniform,
        this.pos,
        this.vel,
        this.tags,
        this.rank,
        bins,
        this.sortedPos,
        this.sortedVel,
        this.sortedTags,
      ]),
      forces: group('forces', [
        this.uniform,
        bins,
        this.sortedPos,
        this.sortedVel,
        this.sortedTags,
        this.pos,
        this.vel,
        this.tags,
      ]),
      brute: group('brute', [this.uniform, this.pos, this.vel, this.tags, this.sortedPos, this.sortedVel]),
    };
    this.upload(state);
  }

  get count(): number {
    return this.params.count;
  }

  upload(state: ParticleState): void {
    const q = this.device.queue;
    q.writeBuffer(this.pos, 0, state.pos);
    q.writeBuffer(this.vel, 0, state.vel);
    q.writeBuffer(this.tags, 0, state.tags);
  }

  setMatrix(matrix: Matrix): void {
    this.matrix = matrix;
    this.dirty = true;
  }

  /** Count and density are fixed per Simulation; everything else can change live. */
  setParams(params: SimParams): void {
    this.params = { ...params, count: this.params.count, density: this.params.density };
    this.dirty = true;
  }

  setPointer(pointer: PointerForce): void {
    this.pointer = pointer;
    this.dirty = true;
  }

  private flush(): void {
    if (!this.dirty) return;
    this.device.queue.writeBuffer(this.uniform, 0, packParams(this.params, this.world, this.matrix, this.pointer));
    this.dirty = false;
  }

  step(encoder: GPUCommandEncoder, timer?: GpuTimer): void {
    this.flush();
    if (this.method === 'brute') {
      this.stepBrute(encoder, timer);
      return;
    }
    const n = this.params.count;
    const groups = Math.ceil(n / WORKGROUP);
    const run = (name: 'clear' | 'count' | 'scatter' | 'forces', workgroups: number) => {
      const pass = encoder.beginComputePass({ label: name, timestampWrites: timer?.pass(name) });
      pass.setPipeline(this.pipelines[name]);
      pass.setBindGroup(0, this.groups[name]);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    };
    run('clear', this.scan.buffer.size / 16 / WORKGROUP);
    run('count', groups);
    this.scan.encode(encoder, timer);
    run('scatter', groups);
    run('forces', groups);
  }

  private stepBrute(encoder: GPUCommandEncoder, timer?: GpuTimer): void {
    const n = this.params.count;
    const pass = encoder.beginComputePass({ label: 'brute force', timestampWrites: timer?.pass('brute force') });
    pass.setPipeline(this.pipelines.brute);
    pass.setBindGroup(0, this.groups.brute);
    pass.dispatchWorkgroups(Math.ceil(n / WORKGROUP));
    pass.end();
    encoder.copyBufferToBuffer(this.sortedPos, 0, this.pos, 0, n * 8);
    encoder.copyBufferToBuffer(this.sortedVel, 0, this.vel, 0, n * 8);
  }

  /** Copies particle state back to the CPU. Slow; for tests and tools. */
  async readback(): Promise<ParticleState> {
    const n = this.params.count;
    const bytes = await readBuffers(this.device, [
      [this.pos, n * 8],
      [this.vel, n * 8],
      [this.tags, n * 4],
    ]);
    return {
      pos: new Float32Array(bytes, 0, n * 2),
      vel: new Float32Array(bytes, n * 8, n * 2),
      tags: new Uint32Array(bytes, n * 16, n),
    };
  }

  /** Bin start offsets from the most recent step (bins + 1 entries). */
  async readBinStarts(): Promise<Uint32Array> {
    const len = this.world.bins + 1;
    return new Uint32Array(await readBuffers(this.device, [[this.scan.buffer, len * 4]]));
  }

  destroy(): void {
    for (const b of [
      this.uniform,
      this.pos,
      this.vel,
      this.tags,
      this.sortedPos,
      this.sortedVel,
      this.sortedTags,
      this.rank,
    ]) {
      b.destroy();
    }
    this.scan.destroy();
  }
}

/** Concatenates the leading bytes of several buffers into one ArrayBuffer. */
export async function readBuffers(device: GPUDevice, parts: [GPUBuffer, number][]): Promise<ArrayBuffer> {
  const total = parts.reduce((s, [, size]) => s + size, 0);
  const staging = device.createBuffer({ size: total, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = device.createCommandEncoder();
  let offset = 0;
  for (const [buffer, size] of parts) {
    enc.copyBufferToBuffer(buffer, 0, staging, offset, size);
    offset += size;
  }
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const out = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return out;
}
