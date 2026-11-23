import particlesSrc from './shaders/particles.wgsl?raw';
import screenSrc from './shaders/screen.wgsl?raw';
import type { Camera } from '../camera';
import type { Simulation } from './simulation';
import type { GpuTimer } from './timing';
import { PALETTE, hexToRgb, srgbToLinear } from '../sim/palette';
import { R_MAX } from '../sim/params';
import type { ViewSettings } from '../sim/url-state';

const VIEW_SIZE = 240;
const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
/** Sprite half-size at glow = 1, in units of the interaction radius. */
const BASE_RADIUS = 0.3 * R_MAX;
/** Below this many device pixels a sprite stops shrinking and dims instead. */
const MIN_RADIUS_PX = 2.2;
const BASE_INTENSITY = 0.8;

/**
 * Two passes per frame:
 *   draw       (optionally fade the previous frame for trails, then) add
 *              every particle's glow into an rgba16float buffer
 *   composite  tone-map that buffer onto the canvas
 *
 * Accumulating in half floats matters twice over: hundreds of overlapping
 * sprites can sum far past 1.0 without clipping, and trails can fade by a
 * few percent per frame without the 8-bit rounding that leaves permanent
 * ghost smears behind.
 */
export class Renderer {
  private readonly particles: GPURenderPipeline;
  private readonly fade: GPURenderPipeline;
  private readonly composite: GPURenderPipeline;
  private readonly view: GPUBuffer;
  private readonly compositeUniform: GPUBuffer;
  private readonly palette: Float32Array;
  private hdr: GPUTexture | null = null;
  private compositeGroup: GPUBindGroup | null = null;
  private particleGroup: GPUBindGroup | null = null;
  private boundSim: Simulation | null = null;
  private lastCamera: Camera | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    format: GPUTextureFormat,
  ) {
    const particleModule = device.createShaderModule({ label: 'particles', code: particlesSrc });
    const screenModule = device.createShaderModule({ label: 'screen', code: screenSrc });
    this.particles = device.createRenderPipeline({
      label: 'particles',
      layout: 'auto',
      vertex: { module: particleModule, entryPoint: 'vs' },
      fragment: {
        module: particleModule,
        entryPoint: 'fs',
        targets: [
          {
            format: HDR_FORMAT,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-strip' },
    });
    this.fade = device.createRenderPipeline({
      label: 'trail fade',
      layout: 'auto',
      vertex: { module: screenModule, entryPoint: 'fullscreen' },
      fragment: {
        module: screenModule,
        entryPoint: 'fade',
        targets: [
          {
            format: HDR_FORMAT,
            // result = dst * blendConstant
            blend: {
              color: { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' },
              alpha: { srcFactor: 'zero', dstFactor: 'constant', operation: 'add' },
            },
          },
        ],
      },
    });
    this.composite = device.createRenderPipeline({
      label: 'composite',
      layout: 'auto',
      vertex: { module: screenModule, entryPoint: 'fullscreen' },
      fragment: { module: screenModule, entryPoint: 'composite', targets: [{ format }] },
    });
    this.view = device.createBuffer({ size: VIEW_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.compositeUniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.palette = new Float32Array(48);
    PALETTE.forEach((hex, i) => {
      const [r, g, b] = hexToRgb(hex);
      this.palette.set([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), 1], i * 4);
    });
  }

  private ensureTarget(width: number, height: number): GPUTexture {
    if (this.hdr && this.hdr.width === width && this.hdr.height === height) return this.hdr;
    this.hdr?.destroy();
    this.hdr = this.device.createTexture({
      label: 'hdr',
      size: { width, height },
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.compositeGroup = this.device.createBindGroup({
      layout: this.composite.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.hdr.createView() },
        { binding: 1, resource: { buffer: this.compositeUniform } },
      ],
    });
    this.lastCamera = null;
    return this.hdr;
  }

  render(
    encoder: GPUCommandEncoder,
    sim: Simulation,
    cam: Camera,
    width: number,
    height: number,
    settings: ViewSettings,
    timer?: GpuTimer,
  ): void {
    const target = this.ensureTarget(width, height);
    const size = sim.world.size;

    // Sprite size: fixed in world units, but never below a couple of pixels.
    // Smaller than that and a million particles alias into flicker, so the
    // sprite stays put and its brightness drops with the area it should have.
    const wanted = BASE_RADIUS * settings.glow;
    const wantedPx = wanted * cam.zoom;
    const radius = Math.max(wanted, MIN_RADIUS_PX / cam.zoom);
    const shrink = wantedPx < MIN_RADIUS_PX ? (wantedPx / MIN_RADIUS_PX) ** 2 : 1;

    // Which copies of the torus are on screen?
    const halfW = width / 2 / cam.zoom + radius;
    const halfH = height / 2 / cam.zoom + radius;
    const x0 = Math.floor((cam.x - halfW) / size);
    const x1 = Math.floor((cam.x + halfW) / size);
    const y0 = Math.floor((cam.y - halfH) / size);
    const y1 = Math.floor((cam.y + halfH) / size);
    const tilesX = x1 - x0 + 1;
    const tiles = tilesX * (y1 - y0 + 1);

    // Trails live in screen space, so a moving camera would smear them
    // across the world. Start clean whenever the view (or the world) changes.
    const still =
      this.boundSim === sim &&
      this.lastCamera !== null &&
      this.lastCamera.x === cam.x &&
      this.lastCamera.y === cam.y &&
      this.lastCamera.zoom === cam.zoom;
    const keep = settings.trails > 0 && still;
    this.lastCamera = { ...cam };

    // With trails on, each frame lays a fresh layer over the faded ones and a
    // still particle would settle at 1 / (1 - trails) times its brightness.
    // Scaling by (1 - trails)^0.85 keeps clusters from blowing out while
    // leaving moving heads bright enough to read.
    const trailScale = settings.trails > 0 ? (1 - settings.trails) ** 0.85 : 1;

    const buf = new ArrayBuffer(VIEW_SIZE);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    f[0] = cam.x;
    f[1] = cam.y;
    f[2] = (2 * cam.zoom) / width;
    f[3] = (-2 * cam.zoom) / height;
    f[4] = size;
    f[5] = radius;
    f[6] = BASE_INTENSITY * shrink * trailScale;
    u[7] = sim.count;
    f[8] = x0;
    f[9] = y0;
    u[10] = tilesX;
    f.set(this.palette, 12);
    this.device.queue.writeBuffer(this.view, 0, buf);
    this.device.queue.writeBuffer(this.compositeUniform, 0, new Float32Array([width, height, settings.exposure, 0]));

    if (this.boundSim !== sim) {
      this.particleGroup = this.device.createBindGroup({
        layout: this.particles.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.view } },
          { binding: 1, resource: { buffer: sim.pos } },
          { binding: 2, resource: { buffer: sim.tags } },
        ],
      });
      this.boundSim = sim;
    }


    const draw = encoder.beginRenderPass({
      label: 'draw',
      timestampWrites: timer?.pass('draw'),
      colorAttachments: [
        {
          view: target.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: keep ? 'load' : 'clear',
          storeOp: 'store',
        },
      ],
    });
    if (keep) {
      draw.setPipeline(this.fade);
      draw.setBlendConstant([settings.trails, settings.trails, settings.trails, settings.trails]);
      draw.draw(3);
    }
    draw.setPipeline(this.particles);
    draw.setBindGroup(0, this.particleGroup!);
    draw.draw(4, sim.count * tiles);
    draw.end();

    const out = encoder.beginRenderPass({
      label: 'composite',
      timestampWrites: timer?.pass('composite'),
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    out.setPipeline(this.composite);
    out.setBindGroup(0, this.compositeGroup!);
    out.draw(3);
    out.end();
  }

  destroy(): void {
    this.hdr?.destroy();
    this.view.destroy();
    this.compositeUniform.destroy();
  }
}
