import type { Gpu } from './gpu/device';
import { Simulation, type Method } from './gpu/simulation';
import { Renderer } from './gpu/renderer';
import { GpuTimer } from './gpu/timing';
import type { PointerForce } from './gpu/params-buffer';
import { Hud } from './ui/hud';
import { coverZoom, fitCamera, maxZoom, wrapCamera, zoomAt, type Camera } from './camera';
import { R_MAX, worldFor, type SimParams } from './sim/params';
import {
  isSymmetric,
  randomMatrix,
  randomSymmetricMatrix,
  resize,
  set,
  symmetrize,
  type Matrix,
} from './sim/matrix';
import { createRng, randomSeed } from './sim/rng';
import { spawn } from './sim/spawn';
import { decodeState, encodeState, type AppState, type ViewSettings } from './sim/url-state';
import { matchPreset, type Preset } from './sim/presets';

/** Simulation steps per second of wall time at speed 1. */
const STEP_RATE = 60;
const MAX_STEPS_PER_FRAME = 4;
/** GPU milliseconds per frame we are willing to spend on simulation steps. */
const STEP_BUDGET_MS = 12;
const SIM_PASSES = ['clear', 'count', 'scan', 'scatter', 'forces', 'brute force'];

export type Tool = 'pull' | 'push' | 'pan';

export interface StatePatch {
  seed?: number;
  params?: Partial<SimParams>;
  matrix?: Matrix;
  speed?: number;
  view?: Partial<ViewSettings>;
}

export class App {
  readonly device: GPUDevice;
  private readonly renderer: Renderer;
  readonly timer: GpuTimer | null;
  readonly hud: Hud;
  sim: Simulation;
  camera: Camera;
  running = true;
  tool: Tool = 'pull';
  symmetric: boolean;
  presetId: string | null = null;
  /** Benchmarks pin the steps per frame instead of following wall time. */
  fixedSteps: number | null = null;
  /** One-shot hook run right after a frame is submitted, in the same task (for capture). */
  afterFrame: (() => void) | null = null;

  private current: AppState;
  private readonly method: Method;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private accumulator = 0;
  private lastTime = 0;
  private pendingSteps = 0;
  private frameTimes: number[] = [];
  private urlTimer = 0;

  constructor(
    readonly gpu: Gpu,
    readonly canvas: HTMLCanvasElement,
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

    this.current = decodeState(location.hash);
    this.symmetric = isSymmetric(this.current.matrix);
    this.presetId = matchPreset(this.current)?.id ?? null;
    this.sim = this.buildSim();
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.resize();
    this.camera = fitCamera(this.sim.world, canvas.width, canvas.height);
    new ResizeObserver(() => this.resize()).observe(canvas);
    window.addEventListener('hashchange', () => this.loadHash());
    this.writeUrl();
  }

  // ---- state ------------------------------------------------------------

  get state(): AppState {
    return this.current;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
    window.clearTimeout(this.urlTimer);
    this.urlTimer = window.setTimeout(() => this.writeUrl(), 200);
  }

  private writeUrl(): void {
    const hash = '#' + encodeState(this.current);
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  /** Current state as a shareable URL. */
  link(): string {
    this.writeUrl();
    return location.href;
  }

  private loadHash(): void {
    const next = decodeState(location.hash);
    if (encodeState(next) === encodeState(this.current)) return;
    this.symmetric = isSymmetric(next.matrix);
    this.update(next, { respawn: true, preset: matchPreset(next)?.id ?? null });
  }

  /**
   * The one place state changes. Works out the cheapest way to apply it:
   * live uniform update, rescaling the world, or a full respawn.
   */
  update(patch: StatePatch, opts: { respawn?: boolean; preset?: string | null } = {}): void {
    const prev = this.current;
    const params: SimParams = { ...prev.params, ...patch.params };
    let matrix = patch.matrix ?? prev.matrix;
    if (matrix.k !== params.species) {
      matrix = resize(matrix, params.species, createRng(randomSeed()));
      if (this.symmetric) matrix = symmetrize(matrix);
    }
    this.current = {
      seed: patch.seed ?? prev.seed,
      params,
      matrix,
      speed: patch.speed ?? prev.speed,
      view: { ...prev.view, ...patch.view },
    };
    this.presetId = opts.preset ?? null;

    const respawn =
      opts.respawn ||
      this.current.seed !== prev.seed ||
      params.count !== prev.params.count ||
      params.species !== prev.params.species;
    if (respawn) {
      this.replaceSim(this.buildSim(), true);
    } else if (params.density !== prev.params.density) {
      void this.rescale();
    } else {
      this.sim.setParams(params);
      this.sim.setMatrix(matrix);
    }
    this.emit();
  }

  private buildSim(): Simulation {
    const { params, seed, matrix } = this.current;
    const world = worldFor(params.count, params.density);
    const state = spawn(params.count, params.species, world.size, seed);
    return new Simulation(this.device, params, matrix, state, this.method);
  }

  private replaceSim(sim: Simulation, refit: boolean): void {
    this.generation++;
    const old = this.sim;
    this.sim = sim;
    if (refit) this.camera = fitCamera(sim.world, this.canvas.width, this.canvas.height);
    this.timer?.reset();
    // Let any in-flight work that references the old buffers finish first.
    if (old) void this.device.queue.onSubmittedWorkDone().then(() => old.destroy());
  }

  /**
   * Density changes the world size. Instead of respawning, read the
   * particles back, stretch their positions to the new size, and carry on:
   * structures survive and visibly loosen or tighten.
   */
  private async rescale(): Promise<void> {
    const gen = ++this.generation;
    const old = this.sim;
    const state = await old.readback();
    if (gen !== this.generation) return;
    const { params, matrix } = this.current;
    const world = worldFor(params.count, params.density);
    const k = world.size / old.world.size;
    const edge = Math.fround(world.size);
    for (let i = 0; i < state.pos.length; i++) {
      const v = Math.fround(state.pos[i]! * k);
      state.pos[i] = v >= edge ? 0 : v;
    }
    this.replaceSim(new Simulation(this.device, params, matrix, state, this.method), false);
    this.camera = { x: this.camera.x * k, y: this.camera.y * k, zoom: this.camera.zoom / k };
    this.clampCamera();
  }

  // ---- actions used by the panel and the keyboard -------------------------

  setParam<K extends keyof SimParams>(key: K, value: SimParams[K]): void {
    this.update({ params: { [key]: value } as Partial<SimParams> });
  }

  editCell(i: number, j: number, value: number): void {
    this.update({ matrix: set(this.current.matrix, i, j, value, this.symmetric) });
  }

  setView<K extends keyof ViewSettings>(key: K, value: ViewSettings[K]): void {
    this.update({ view: { [key]: value } as Partial<ViewSettings> }, { preset: this.presetId });
  }

  setMatrix(matrix: Matrix): void {
    this.update({ matrix });
  }

  randomizeMatrix(): void {
    const rng = createRng(randomSeed());
    const k = this.current.params.species;
    this.update({ matrix: this.symmetric ? randomSymmetricMatrix(k, rng) : randomMatrix(k, rng) });
  }

  setSymmetric(on: boolean): void {
    this.symmetric = on;
    if (on && !isSymmetric(this.current.matrix)) this.update({ matrix: symmetrize(this.current.matrix) });
    else this.emit();
  }

  applyPreset(p: Preset): void {
    this.symmetric = isSymmetric(p.matrix);
    // Presets describe behaviour, not load: keep the particle count.
    this.update(
      { seed: p.seed, params: { ...p.params, count: this.current.params.count }, matrix: p.matrix },
      { respawn: true, preset: p.id },
    );
  }

  respawn(seed = randomSeed()): void {
    this.update({ seed }, { respawn: true, preset: this.presetId });
  }

  togglePause(): void {
    this.running = !this.running;
    this.accumulator = 0;
    this.emit();
  }

  stepOnce(): void {
    if (this.running) this.running = false;
    this.pendingSteps++;
    this.emit();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.emit();
  }

  /** Runs n steps right now, regardless of pause. For tools and capture. */
  advance(n: number): void {
    const encoder = this.device.createCommandEncoder();
    for (let i = 0; i < n; i++) this.sim.step(encoder);
    this.device.queue.submit([encoder.finish()]);
  }

  // ---- camera and pointer -------------------------------------------------

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.sim) this.clampCamera();
  }

  get pixelRatio(): number {
    return this.canvas.width / Math.max(1, this.canvas.clientWidth);
  }

  resetCamera(): void {
    this.camera = fitCamera(this.sim.world, this.canvas.width, this.canvas.height);
  }

  /** Zoomed out far enough to see the torus repeat about three times across. */
  private minZoom(): number {
    return coverZoom(this.sim.world, this.canvas.width, this.canvas.height) / 3;
  }

  private clampCamera(): void {
    const zoom = Math.min(Math.max(this.camera.zoom, this.minZoom()), maxZoom(this.canvas.width, this.canvas.height));
    this.camera = wrapCamera({ ...this.camera, zoom }, this.sim.world.size);
  }

  /** Zoom about a point given in CSS pixels. */
  zoomAt(factor: number, cssX: number, cssY: number): void {
    const r = this.pixelRatio;
    const { width, height } = this.canvas;
    this.camera = zoomAt(this.camera, factor, cssX * r, cssY * r, width, height, this.minZoom(), maxZoom(width, height));
    this.clampCamera();
  }

  /** Pan by a CSS-pixel delta. */
  panBy(dx: number, dy: number): void {
    const r = this.pixelRatio;
    this.camera = { ...this.camera, x: this.camera.x - (dx * r) / this.camera.zoom, y: this.camera.y - (dy * r) / this.camera.zoom };
    this.clampCamera();
  }

  cssToWorld(cssX: number, cssY: number): [number, number] {
    const r = this.pixelRatio;
    const { width, height } = this.canvas;
    return [this.camera.x + (cssX * r - width / 2) / this.camera.zoom, this.camera.y + (cssY * r - height / 2) / this.camera.zoom];
  }

  /** Pointer force radius in CSS pixels at the current zoom. */
  pointerRadiusCss(): number {
    return (this.pointerRadiusWorld() * this.camera.zoom) / this.pixelRatio;
  }

  private pointerRadiusWorld(): number {
    // About 90 CSS px on screen, but never smaller than two interaction radii
    // or larger than a quarter of the world.
    const wanted = (90 * this.pixelRatio) / this.camera.zoom;
    return Math.min(Math.max(wanted, 2 * R_MAX), this.sim.world.size / 4);
  }

  /** Start or move a push/pull at a CSS-pixel position; null releases it. */
  setPointer(cssX: number, cssY: number, mode: 'pull' | 'push'): void;
  setPointer(release: null): void;
  setPointer(a: number | null, cssY?: number, mode?: 'pull' | 'push'): void {
    if (a === null) {
      this.sim.setPointer({ x: 0, y: 0, radius: 1, strength: 0 });
      return;
    }
    const size = this.sim.world.size;
    const [wx, wy] = this.cssToWorld(a, cssY!);
    const wrap = (v: number) => v - size * Math.floor(v / size);
    const force: PointerForce = {
      x: wrap(wx),
      y: wrap(wy),
      radius: this.pointerRadiusWorld(),
      strength: (mode === 'push' ? -1 : 1) * 60 * this.current.params.force / 10,
    };
    this.sim.setPointer(force);
  }

  // ---- frame loop ---------------------------------------------------------

  start(): void {
    requestAnimationFrame((t) => {
      this.lastTime = t;
      this.frame(t);
    });
  }

  /** How many steps fit in the GPU budget, from measured per-step cost. */
  private stepCap(): number {
    if (!this.timer) return MAX_STEPS_PER_FRAME;
    const avg = this.timer.averages();
    let perStep = 0;
    for (const name of SIM_PASSES) perStep += avg.get(name) ?? 0;
    if (perStep <= 0) return MAX_STEPS_PER_FRAME;
    return Math.max(1, Math.min(MAX_STEPS_PER_FRAME, Math.floor(STEP_BUDGET_MS / perStep)));
  }

  private frame(now: number): void {
    const elapsedMs = now - this.lastTime;
    this.lastTime = now;
    this.frameTimes.push(elapsedMs);
    if (this.frameTimes.length > 60) this.frameTimes.shift();

    let steps = 0;
    if (this.running && this.fixedSteps !== null) {
      steps = this.fixedSteps;
    } else if (this.running) {
      this.accumulator += Math.min(elapsedMs / 1000, 0.25) * STEP_RATE * this.current.speed;
      const cap = this.stepCap();
      steps = Math.min(Math.floor(this.accumulator), cap);
      // Don't bank time we couldn't spend: running slow beats catching up.
      this.accumulator = Math.min(this.accumulator - steps, 1);
    } else if (this.pendingSteps > 0) {
      steps = this.pendingSteps;
      this.pendingSteps = 0;
    }

    const timer = this.timer ?? undefined;
    timer?.beginFrame(steps);
    const encoder = this.device.createCommandEncoder();
    for (let i = 0; i < steps; i++) this.sim.step(encoder, timer);
    this.renderer.render(
      encoder,
      this.sim,
      this.camera,
      this.canvas.width,
      this.canvas.height,
      this.current.view,
      timer,
    );
    timer?.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    timer?.endFrame();
    const hook = this.afterFrame;
    this.afterFrame = null;
    hook?.();

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
