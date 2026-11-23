import type { Gpu } from './gpu/device';
import { Simulation } from './gpu/simulation';
import { Renderer } from './gpu/renderer';
import { fitCamera, type Camera } from './camera';
import { DEFAULT_PARAMS, worldFor, type SimParams } from './sim/params';
import { randomMatrix, type Matrix } from './sim/matrix';
import { createRng } from './sim/rng';
import { spawn } from './sim/spawn';

/** Simulation steps per second of wall time at speed 1. */
const STEP_RATE = 60;
const MAX_STEPS_PER_FRAME = 4;

export class App {
  private readonly device: GPUDevice;
  private readonly renderer: Renderer;
  private sim: Simulation;
  private camera: Camera;
  private params: SimParams = { ...DEFAULT_PARAMS };
  private matrix: Matrix;
  private seed = 1;
  private accumulator = 0;
  private lastTime = 0;
  private running = true;

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
    this.matrix = randomMatrix(this.params.species, createRng(this.seed ^ 0x5eed));
    this.sim = this.buildSim();
    this.resize();
    this.camera = fitCamera(this.sim.world, canvas.width, canvas.height);
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  private buildSim(): Simulation {
    const world = worldFor(this.params.count, this.params.density);
    const state = spawn(this.params.count, this.params.species, world.size, this.seed);
    return new Simulation(this.device, this.params, this.matrix, state);
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
    const elapsed = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    let steps = 0;
    if (this.running) {
      this.accumulator += elapsed * STEP_RATE;
      steps = Math.min(Math.floor(this.accumulator), MAX_STEPS_PER_FRAME);
      this.accumulator = Math.min(this.accumulator - steps, 1);
    }

    const encoder = this.device.createCommandEncoder();
    for (let i = 0; i < steps; i++) this.sim.step(encoder);
    this.renderer.render(encoder, this.sim, this.camera, this.canvas.width, this.canvas.height);
    this.device.queue.submit([encoder.finish()]);
    requestAnimationFrame((t) => this.frame(t));
  }
}
