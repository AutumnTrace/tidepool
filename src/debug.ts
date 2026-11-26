/**
 * A small handle on window.tidepool for the end-to-end tests, the benchmark
 * script and anyone poking around in devtools. Everything here builds its
 * own Simulation on the app's device, so it never disturbs what is on
 * screen.
 */
import type { App, ProbeOutcome } from './app';
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

export interface BenchRequest {
  /** Steps to run before measuring, so the structures have formed. */
  warmup: number;
  /** Frames to measure, at exactly stepsPerFrame steps each. */
  frames: number;
  stepsPerFrame: number;
}

export interface BenchResult {
  count: number;
  worldSize: number;
  bins: number;
  frames: number;
  /** Mean and 95th percentile of requestAnimationFrame intervals, ms. */
  frameMs: number;
  frameP95Ms: number;
  /** Mean GPU ms per pass occurrence (per step for simulation passes). */
  passes: Record<string, number>;
  /** Mean GPU ms per frame, all passes. */
  gpuFrameMs: number;
  /** Mean neighbour candidates visited per particle (from the bin layout). */
  candidates: number;
}

export interface DebugApi {
  app: App;
  adapter: { vendor: string; architecture: string; description: string; isFallback: boolean };
  timestamps: boolean;
  presets: readonly Preset[];
  /** The startup probe, when one ran: what it measured and the count it picked. */
  probe?: Promise<ProbeOutcome | null>;
  gpuStep(req: GpuStepRequest): Promise<GpuStepResult>;
  gpuScan(lengths: number[], seed: number): Promise<ScanCheck[]>;
  bench(req: BenchRequest): Promise<BenchResult>;
  /** RGBA pixels of the next frame, scaled to width x height, base64. */
  captureFrame(width: number, height: number): Promise<string>;
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

    async bench(req) {
      app.running = false;
      for (let done = 0; done < req.warmup; done += 50) {
        app.advance(Math.min(50, req.warmup - done));
        await device.queue.onSubmittedWorkDone();
      }
      app.fixedSteps = req.stepsPerFrame;
      app.running = true;
      // Let a few frames go by so the timer ring and caches settle.
      const intervals: number[] = [];
      await new Promise<void>((resolve) => {
        let last = 0;
        let seen = 0;
        const tick = (t: number) => {
          if (seen === 10) app.timer?.reset();
          if (seen > 10) intervals.push(t - last);
          last = t;
          seen++;
          if (intervals.length < req.frames) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      await device.queue.onSubmittedWorkDone();
      await new Promise((r) => setTimeout(r, 100));
      app.fixedSteps = null;
      const sorted = intervals.slice().sort((a, b) => a - b);
      const sim = app.sim;
      // Average over particles of how many sorted entries the forces pass
      // walks: the sum of the 3x3 bin populations around each particle.
      const starts = await sim.readBinStarts();
      const g = sim.world.grid;
      const pop = (x: number, y: number) => {
        const b = ((y + g) % g) * g + ((x + g) % g);
        return starts[b + 1]! - starts[b]!;
      };
      let visits = 0;
      for (let y = 0; y < g; y++) {
        for (let x = 0; x < g; x++) {
          let around = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) around += pop(x + dx, y + dy);
          visits += pop(x, y) * around;
        }
      }
      return {
        count: sim.count,
        worldSize: sim.world.size,
        bins: sim.world.bins,
        frames: intervals.length,
        frameMs: intervals.reduce((a, b) => a + b, 0) / intervals.length,
        frameP95Ms: sorted[Math.floor(sorted.length * 0.95)]!,
        passes: Object.fromEntries(app.timer?.averages() ?? []),
        gpuFrameMs: app.timer?.frameStats().gpuMs ?? 0,
        candidates: visits / sim.count,
      };
    },

    captureFrame(width, height) {
      return new Promise((resolve) => {
        // Must run in the same task as the frame's submit: once the task
        // ends the canvas texture is presented and can't be read back.
        app.afterFrame = () => {
          const canvas = new OffscreenCanvas(width, height);
          const ctx = canvas.getContext('2d')!;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(app.canvas, 0, 0, width, height);
          const bytes = ctx.getImageData(0, 0, width, height).data;
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          resolve(btoa(bin));
        };
      });
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
