import particlesSrc from './shaders/particles.wgsl?raw';
import type { Camera } from '../camera';
import type { Simulation } from './simulation';
import { PALETTE, hexToRgb, srgbToLinear } from '../sim/palette';

const VIEW_SIZE = 224;

export class Renderer {
  private readonly pipeline: GPURenderPipeline;
  private readonly view: GPUBuffer;
  private bindGroup: GPUBindGroup | null = null;
  private boundSim: Simulation | null = null;
  private boundPositions: GPUBuffer | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    format: GPUTextureFormat,
  ) {
    const module = device.createShaderModule({ label: 'particles', code: particlesSrc });
    this.pipeline = device.createRenderPipeline({
      label: 'particles',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: {
        module,
        entryPoint: 'fs',
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-strip' },
    });
    this.view = device.createBuffer({ size: VIEW_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  render(encoder: GPUCommandEncoder, sim: Simulation, cam: Camera, width: number, height: number): void {
    const v = new Float32Array(VIEW_SIZE / 4);
    v[0] = cam.x;
    v[1] = cam.y;
    v[2] = (2 * cam.zoom) / width;
    v[3] = (-2 * cam.zoom) / height;
    v[4] = sim.world.size;
    v[5] = 0.22; // sprite radius, world units
    v[6] = 0.9;
    PALETTE.forEach((hex, i) => {
      const [r, g, b] = hexToRgb(hex);
      v.set([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), 1], 8 + i * 4);
    });
    this.device.queue.writeBuffer(this.view, 0, v);

    if (this.boundSim !== sim || this.boundPositions !== sim.positions) {
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.view } },
          { binding: 1, resource: { buffer: sim.positions } },
          { binding: 2, resource: { buffer: sim.tags } },
        ],
      });
      this.boundSim = sim;
      this.boundPositions = sim.positions;
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.012, g: 0.016, b: 0.03, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup!);
    pass.draw(4, sim.count);
    pass.end();
  }
}
