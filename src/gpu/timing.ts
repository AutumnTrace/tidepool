/**
 * Per-pass GPU timings from timestamp queries.
 *
 * Each frame asks for a pair of timestamps per pass. Results come back
 * asynchronously through a small ring of mappable buffers; if all of them
 * are still in flight the frame simply goes untimed, so timing never stalls
 * the pipeline. Durations are averaged over a sliding window.
 */
const CAPACITY = 128;
const RING = 3;
const WINDOW = 240;

export class GpuTimer {
  private readonly querySet: GPUQuerySet;
  private readonly resolveBuffer: GPUBuffer;
  private readonly free: GPUBuffer[] = [];
  private labels: string[] = [];
  private frameBuffer: GPUBuffer | null = null;
  private readonly history = new Map<string, number[]>();
  private frames: number[] = [];
  private stepCounts: number[] = [];
  private stepsThisFrame = 0;

  constructor(device: GPUDevice) {
    this.querySet = device.createQuerySet({ type: 'timestamp', count: CAPACITY });
    this.resolveBuffer = device.createBuffer({
      size: CAPACITY * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    for (let i = 0; i < RING; i++) {
      this.free.push(
        device.createBuffer({ size: CAPACITY * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      );
    }
  }

  beginFrame(steps: number): void {
    this.labels = [];
    this.stepsThisFrame = steps;
    this.frameBuffer = this.free.pop() ?? null;
  }

  /** timestampWrites for a pass, or undefined when this frame is untimed. */
  pass(label: string): GPUComputePassTimestampWrites | undefined {
    if (!this.frameBuffer || this.labels.length * 2 + 2 > CAPACITY) return undefined;
    const i = this.labels.length * 2;
    this.labels.push(label);
    return { querySet: this.querySet, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 };
  }

  resolve(encoder: GPUCommandEncoder): void {
    if (!this.frameBuffer || this.labels.length === 0) return;
    const n = this.labels.length * 2;
    encoder.resolveQuerySet(this.querySet, 0, n, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.frameBuffer, 0, n * 8);
  }

  /** Call after queue.submit(). */
  endFrame(): void {
    const buffer = this.frameBuffer;
    const labels = this.labels;
    const steps = this.stepsThisFrame;
    this.frameBuffer = null;
    if (!buffer) return;
    if (labels.length === 0) {
      this.free.push(buffer);
      return;
    }
    buffer.mapAsync(GPUMapMode.READ).then(
      () => {
        const t = new BigInt64Array(buffer.getMappedRange(0, labels.length * 16));
        let total = 0;
        labels.forEach((label, k) => {
          const ms = Number(t[k * 2 + 1]! - t[k * 2]!) / 1e6;
          // A pass that the implementation reordered or skipped can produce
          // nonsense; drop anything that isn't a plausible duration.
          const v = ms >= 0 && ms < 1000 ? ms : 0;
          push(this.history, label, v);
          total += v;
        });
        buffer.unmap();
        this.free.push(buffer);
        this.frames.push(total);
        this.stepCounts.push(steps);
        if (this.frames.length > WINDOW) {
          this.frames.shift();
          this.stepCounts.shift();
        }
      },
      () => this.free.push(buffer),
    );
  }

  /** Mean ms per occurrence of each pass (so per step for simulation passes). */
  averages(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [label, values] of this.history) out.set(label, mean(values));
    return out;
  }

  /** Mean ms of GPU work per frame, and mean simulation steps per timed frame. */
  frameStats(): { gpuMs: number; steps: number; samples: number } {
    return { gpuMs: mean(this.frames), steps: mean(this.stepCounts), samples: this.frames.length };
  }

  reset(): void {
    this.history.clear();
    this.frames = [];
    this.stepCounts = [];
  }
}

function push(map: Map<string, number[]>, key: string, v: number): void {
  let arr = map.get(key);
  if (!arr) map.set(key, (arr = []));
  arr.push(v);
  if (arr.length > WINDOW) arr.shift();
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
