import type { Gpu } from './gpu/device';
import { Simulation, type Method } from './gpu/simulation';
import { Renderer } from './gpu/renderer';
import { GpuTimer } from './gpu/timing';
import { Hud } from './ui/hud';
import { fitCamera, type Camera } from './camera';
import { DEFAULT_PARAMS, worldFor, type SimParams } from './sim/params';
import { randomMatrix, type Matrix } from './sim/matrix';
import { createRng } from './sim/rng';
import { spawn } from './sim/spawn';

/** Simulation steps per second of wall time at speed 1. */
const STEP_RATE = 60;
const MAX_STEPS_PER_FRAME = 4;

export class App {
  readonly device: GPUDevice;
  private readonly renderer: Renderer;
  readonly timer: GpuTimer | null;
  private readonly hud: Hud;
  sim: Simulation;
  private camera: Camera;
  private params: SimParams = { ...DEFAULT_PARAMS };
  private matrix: Matrix;
  private seed = 1;
  private method: Method;
  private accumulator = 0;
  private lastTime = 0;
  private running = true;
  private frameTimes: number[] = [];

  constructor(
    readonly gpu: Gpu,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.device = gpu.device;
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not get a WebGPU canvas context.');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device: this.device, format, alphaMode: 'opaque' });
    this.renderer = new Renderer(this.device, context, format);
    this.timer = gpu.timestamps ? new GpuTimer(this.device) : null;
    this.hud = new Hud(document.body, this.timer, describeAdapter(gpu.info));
    this.method = new URLSearchParams(location.search).get('method') === 'brute' ? 'brute' : 'grid';
    this.matrix = randomMatrix(this.params.species, createRng(this.seed ^ 0x5eed));
    this.sim = this.buildSim();
    this.resize();
    this.camera = fitCamera(this.sim.world, canvas.width, canvas.height);
    new ResizeObserver(() => this.resize()).observe(canvas);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'd') this.hud.toggle();
      if (e.key === ' ') this.running = !this.running;
    });
  }

  private buildSim(): Simulation {
    const world = worldFor(this.params.count, this.params.density);
    const state = spawn(this.params.count, this.params.species, world.size, this.seed);
    return new Simulation(this.device, this.params, this.matrix, state, this.method);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.sim) this.camera = fitCamera(this.sim.world, w, h);
  }

  start(): void {
    requestAnimationFrame((t) => {
      this.lastTime = t;
      this.frame(t);
    });
  }

  private frame(now: number): void {
    const elapsedMs = now - this.lastTime;
    this.lastTime = now;
    this.frameTimes.push(elapsedMs);
    if (this.frameTimes.length > 60) this.frameTimes.shift();

    let steps = 0;
    if (this.running) {
      this.accumulator += Math.min(elapsedMs / 1000, 0.25) * STEP_RATE;
      steps = Math.min(Math.floor(this.accumulator), MAX_STEPS_PER_FRAME);
      this.accumulator = Math.min(this.accumulator - steps, 1);
    }

    const timer = this.timer ?? undefined;
    timer?.beginFrame(steps);
    const encoder = this.device.createCommandEncoder();
    for (let i = 0; i < steps; i++) this.sim.step(encoder, timer);
    this.renderer.render(encoder, this.sim, this.camera, this.canvas.width, this.canvas.height, timer);
    timer?.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    timer?.endFrame();

    const avgMs = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.hud.update(now, {
      fps: 1000 / avgMs,
      frameMs: avgMs,
      count: this.sim.count,
      steps: this.timer?.frameStats().steps ?? steps,
      paused: !this.running,
    });
    requestAnimationFrame((t) => this.frame(t));
  }
}

export function describeAdapter(info: GPUAdapterInfo): string {
  return [info.vendor, info.architecture, info.description].filter(Boolean).join(' ');
}
