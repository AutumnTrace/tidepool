import type { GpuTimer } from '../gpu/timing';

const PASS_ORDER = ['clear', 'count', 'scan', 'scatter', 'forces', 'brute force', 'draw', 'composite'];

export interface HudInfo {
  fps: number;
  frameMs: number;
  count: number;
  steps: number;
  paused: boolean;
}

/**
 * Small monospace readout: frame rate always, per-pass GPU timings when
 * expanded and when the adapter supports timestamp queries.
 */
export class Hud {
  readonly el: HTMLElement;
  private expanded = false;
  private last = 0;

  constructor(
    parent: HTMLElement,
    private readonly timer: GpuTimer | null,
    private readonly adapterName: string,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.setAttribute('aria-live', 'off');
    parent.append(this.el);
  }

  toggle(force?: boolean): void {
    this.expanded = force ?? !this.expanded;
    this.last = 0;
  }

  get isExpanded(): boolean {
    return this.expanded;
  }

  update(now: number, info: HudInfo): void {
    if (now - this.last < 250) return;
    this.last = now;
    const lines = [
      `<span class="hud-big">${info.fps.toFixed(0)}</span> fps  ${info.frameMs.toFixed(1)} ms${info.paused ? '  paused' : ''}`,
    ];
    if (this.expanded) {
      lines.push(`${info.count.toLocaleString('en-US')} particles, ${info.steps.toFixed(1)} steps/frame`);
      if (this.timer) {
        const avg = this.timer.averages();
        lines.push('', 'gpu ms per pass');
        for (const name of PASS_ORDER) {
          const v = avg.get(name);
          if (v === undefined) continue;
          lines.push(`${name.padEnd(12)}${v.toFixed(3).padStart(8)}`);
        }
        const { gpuMs } = this.timer.frameStats();
        lines.push(`${'per frame'.padEnd(12)}${gpuMs.toFixed(3).padStart(8)}`);
      } else {
        lines.push('', 'no timestamp-query on this adapter');
      }
      if (this.adapterName) lines.push('', this.adapterName);
    }
    this.el.innerHTML = lines.join('\n');
  }
}
