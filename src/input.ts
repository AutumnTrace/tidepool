import type { App } from './app';

interface Point {
  x: number;
  y: number;
}

type Mode = { kind: 'force'; push: boolean } | { kind: 'pan' } | { kind: 'gesture' } | null;

/**
 * Mouse, pen and touch on the canvas.
 *
 *   left drag / one finger   the current tool (pull, push or pan)
 *   right drag               the opposite force
 *   middle or Alt + drag     pan
 *   wheel / pinch            zoom about the pointer
 *   two fingers              pan and zoom together
 */
export class PointerControls {
  private readonly pointers = new Map<number, Point>();
  private mode: Mode = null;
  private gesture: { cx: number; cy: number; dist: number } | null = null;
  private readonly ring: HTMLElement;
  private hover: Point | null = null;

  constructor(
    private readonly app: App,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.ring = document.createElement('div');
    this.ring.className = 'pointer-ring';
    document.body.append(this.ring);

    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.updateRing();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const scale = e.deltaMode === 1 ? 0.05 : 0.0015;
        this.app.zoomAt(Math.exp(-e.deltaY * scale), e.clientX, e.clientY);
        this.updateRing();
      },
      { passive: false },
    );
    app.subscribe(() => this.updateRing());
  }

  private down(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size >= 2) {
      this.app.setPointer(null);
      this.mode = { kind: 'gesture' };
      this.gesture = this.measure();
      return;
    }
    const tool = this.app.tool;
    if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && tool === 'pan')) {
      this.mode = { kind: 'pan' };
    } else if (e.button === 2) {
      this.mode = { kind: 'force', push: tool !== 'push' };
    } else if (e.button === 0) {
      this.mode = { kind: 'force', push: tool === 'push' };
    } else {
      return;
    }
    if (this.mode.kind === 'force') this.app.setPointer(e.clientX, e.clientY, this.mode.push ? 'push' : 'pull');
    this.hover = { x: e.clientX, y: e.clientY };
    this.updateRing();
  }

  private move(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    this.hover = { x: e.clientX, y: e.clientY };
    if (!prev) {
      this.updateRing();
      return;
    }
    const cur = { x: e.clientX, y: e.clientY };
    this.pointers.set(e.pointerId, cur);
    const mode = this.mode;
    if (mode?.kind === 'gesture' && this.gesture) {
      const g = this.measure();
      this.app.panBy(g.cx - this.gesture.cx, g.cy - this.gesture.cy);
      if (this.gesture.dist > 0 && g.dist > 0) this.app.zoomAt(g.dist / this.gesture.dist, g.cx, g.cy);
      this.gesture = g;
    } else if (mode?.kind === 'pan') {
      this.app.panBy(cur.x - prev.x, cur.y - prev.y);
    } else if (mode?.kind === 'force') {
      this.app.setPointer(cur.x, cur.y, mode.push ? 'push' : 'pull');
    }
    this.updateRing();
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.mode?.kind === 'force') this.app.setPointer(null);
    if (this.pointers.size === 0) {
      this.mode = null;
      this.gesture = null;
    } else if (this.mode?.kind === 'gesture') {
      // Lifting one of two fingers shouldn't turn the other into a force.
      this.gesture = this.measure();
    }
    if (e.pointerType !== 'mouse') this.hover = null;
    this.updateRing();
  }

  private measure(): { cx: number; cy: number; dist: number } {
    const pts = [...this.pointers.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dist = pts.length >= 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0;
    return { cx, cy, dist };
  }

  private updateRing(): void {
    const ring = this.ring;
    const show = this.hover !== null && (this.mode?.kind === 'force' || (this.mode === null && this.app.tool !== 'pan'));
    ring.classList.toggle('visible', show);
    if (!show || !this.hover) return;
    const r = this.app.pointerRadiusCss();
    const active = this.mode?.kind === 'force';
    const push = active ? (this.mode as { push: boolean }).push : this.app.tool === 'push';
    ring.classList.toggle('active', active);
    ring.classList.toggle('push', push);
    ring.style.width = ring.style.height = `${r * 2}px`;
    ring.style.transform = `translate(${this.hover.x - r}px, ${this.hover.y - r}px)`;
  }
}
