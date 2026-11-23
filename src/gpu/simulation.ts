import common from './shaders/common.wgsl?raw';
import naiveSrc from './shaders/naive.wgsl?raw';
import { PARAMS_SIZE, packParams, NO_POINTER, type PointerForce } from './params-buffer';
import { worldFor, type SimParams, type World } from '../sim/params';
import type { Matrix } from '../sim/matrix';
import type { ParticleState } from '../sim/spawn';

const WORKGROUP = 256;

/**
 * Owns the particle buffers and the compute pipeline that advances them.
 * This version is the brute-force O(N^2) baseline.
 */
export class Simulation {
  readonly world: World;
  private params: SimParams;
  private matrix: Matrix;
  private pointer: PointerForce = NO_POINTER;
  private dirty = true;

  private readonly uniform: GPUBuffer;
  private readonly pos: [GPUBuffer, GPUBuffer];
  private readonly vel: [GPUBuffer, GPUBuffer];
  readonly tags: GPUBuffer;
  private readonly pipeline: GPUComputePipeline;
  private readonly bindGroups: [GPUBindGroup, GPUBindGroup];
  private current = 0;

  constructor(
    readonly device: GPUDevice,
    params: SimParams,
    matrix: Matrix,
    state: ParticleState,
  ) {
    this.params = { ...params };
    this.matrix = matrix;
    this.world = worldFor(params.count, params.density);
    const n = params.count;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const make = (label: string, size: number, usage = storage) =>
      device.createBuffer({ label, size, usage });

    this.uniform = make('params', PARAMS_SIZE, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.pos = [make('pos A', n * 8), make('pos B', n * 8)];
    this.vel = [make('vel A', n * 8), make('vel B', n * 8)];
    this.tags = make('tags', n * 4);

    const module = device.createShaderModule({ label: 'naive', code: common + naiveSrc });
    this.pipeline = device.createComputePipeline({
      label: 'naive step',
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    const bg = (src: number, dst: number) =>
      device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 1, resource: { buffer: this.pos[src]! } },
          { binding: 2, resource: { buffer: this.vel[src]! } },
          { binding: 3, resource: { buffer: this.tags } },
          { binding: 4, resource: { buffer: this.pos[dst]! } },
          { binding: 5, resource: { buffer: this.vel[dst]! } },
        ],
      });
    this.bindGroups = [bg(0, 1), bg(1, 0)];
    this.upload(state);
  }

  get count(): number {
    return this.params.count;
  }

  /** Buffer holding the latest positions, for the renderer. */
  get positions(): GPUBuffer {
    return this.pos[this.current]!;
  }

  upload(state: ParticleState): void {
    const q = this.device.queue;
    this.current = 0;
    q.writeBuffer(this.pos[0], 0, state.pos);
    q.writeBuffer(this.vel[0], 0, state.vel);
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

  step(encoder: GPUCommandEncoder): void {
    this.flush();
    const pass = encoder.beginComputePass({ label: 'naive step' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroups[this.current]!);
    pass.dispatchWorkgroups(Math.ceil(this.params.count / WORKGROUP));
    pass.end();
    this.current ^= 1;
  }

  /** Copies particle state back to the CPU. Slow; for tests and tools. */
  async readback(): Promise<ParticleState> {
    const n = this.params.count;
    const staging = this.device.createBuffer({
      size: n * 20,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.positions, 0, staging, 0, n * 8);
    enc.copyBufferToBuffer(this.vel[this.current]!, 0, staging, n * 8, n * 8);
    enc.copyBufferToBuffer(this.tags, 0, staging, n * 16, n * 4);
    this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const bytes = staging.getMappedRange().slice(0);
    staging.unmap();
    staging.destroy();
    return {
      pos: new Float32Array(bytes, 0, n * 2),
      vel: new Float32Array(bytes, n * 8, n * 2),
      tags: new Uint32Array(bytes, n * 16, n),
    };
  }

  destroy(): void {
    for (const b of [this.uniform, ...this.pos, ...this.vel, this.tags]) b.destroy();
  }
}
