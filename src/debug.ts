/**
 * A small handle on window.tidepool for the end-to-end tests, the benchmark
 * script and anyone poking around in devtools. Everything here builds its
 * own Simulation on the app's device, so it never disturbs what is on
 * screen.
 */
import type { App } from './app';
import { Simulation, readBuffers, type Method } from './gpu/simulation';
import { PrefixSum } from './gpu/prefix-sum';
import { DEFAULT_PARAMS, worldFor, type SimParams } from './sim/params';
import { randomMatrix } from './sim/matrix';
import { createRng } from './sim/rng';
import { spawn } from './sim/spawn';
import { exclusiveScan } from './sim/reference';
import { PRESETS, type Preset } from './sim/presets';

export interface GpuStepRequest {
  params?: Partial<SimParams>;
  seed: number;
  matrixSeed: number;
  steps: number;
  method?: Method;
}

export interface GpuStepResult {
  pos: number[];
  vel: number[];
  tags: number[];
  /** Bin start offsets as computed during the last step. */
  binStarts: number[];
}

export interface ScanCheck {
  n: number;
  levels: number;
  mismatches: number;
  firstBad: number;
}

export interface DebugApi {
  app: App;
  adapter: { vendor: string; architecture: string; description: string; isFallback: boolean };
  timestamps: boolean;
  presets: readonly Preset[];
  gpuStep(req: GpuStepRequest): Promise<GpuStepResult>;
  gpuScan(lengths: number[], seed: number): Promise<ScanCheck[]>;
}

declare global {
  interface Window {
    tidepool?: DebugApi;
  }
}

export function installDebugApi(app: App): void {
  const device = app.device;
  const info = app.gpu.info;
  window.tidepool = {
    app,
    adapter: {
      vendor: info.vendor,
      architecture: info.architecture,
      description: info.description,
      isFallback: Boolean((info as GPUAdapterInfo & { isFallbackAdapter?: boolean }).isFallbackAdapter),
    },
    timestamps: app.gpu.timestamps,
    presets: PRESETS,

    async gpuStep(req) {
      const params: SimParams = { ...DEFAULT_PARAMS, ...req.params };
      const world = worldFor(params.count, params.density);
      const matrix = randomMatrix(params.species, createRng(req.matrixSeed));
      const state = spawn(params.count, params.species, world.size, req.seed);
      const sim = new Simulation(device, params, matrix, state, req.method ?? 'grid');
      const encoder = device.createCommandEncoder();
      for (let i = 0; i < req.steps; i++) sim.step(encoder);
      device.queue.submit([encoder.finish()]);
      const out = await sim.readback();
      const starts = sim.method === 'grid' ? await sim.readBinStarts() : new Uint32Array();
      sim.destroy();
      return {
        pos: Array.from(out.pos),
        vel: Array.from(out.vel),
        tags: Array.from(out.tags),
        binStarts: Array.from(starts),
      };
    },

    async gpuScan(lengths, seed) {
      const results: ScanCheck[] = [];
      const rng = createRng(seed);
      for (const n of lengths) {
        const scan = new PrefixSum(device, n, `test scan ${n}`);
        const input = new Uint32Array(n);
        // Small values with long runs of zeros, like real bin counts.
        for (let i = 0; i < n; i++) input[i] = rng.next() < 0.3 ? 0 : rng.int(40);
        device.queue.writeBuffer(scan.buffer, 0, input);
        const encoder = device.createCommandEncoder();
        scan.encode(encoder);
        device.queue.submit([encoder.finish()]);
        const gpu = new Uint32Array(await readBuffers(device, [[scan.buffer, n * 4]]));
        exclusiveScan(input);
        let mismatches = 0;
        let firstBad = -1;
        for (let i = 0; i < n; i++) {
          if (gpu[i] !== input[i]) {
            mismatches++;
            if (firstBad < 0) firstBad = i;
          }
        }
        results.push({ n, levels: scan.levels.length, mismatches, firstBad });
        scan.destroy();
      }
      return results;
    },
  };
}
