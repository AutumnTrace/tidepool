import type { App } from '../app';
import { get } from '../sim/matrix';
import { PALETTE, SPECIES_NAMES } from '../sim/palette';
import { h } from './dom';

const NEUTRAL: [number, number, number] = [20, 26, 38];
const ATTRACT: [number, number, number] = [61, 224, 181];
const REPEL: [number, number, number] = [255, 79, 109];

/** Diverging heatmap colour for a value in [-1, 1]. */
export function cellColor(v: number): string {
  const t = Math.pow(Math.min(1, Math.abs(v)), 0.75);
  const target = v >= 0 ? ATTRACT : REPEL;
  const c = NEUTRAL.map((n, i) => Math.round(n + (target[i]! - n) * t));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

function formatValue(v: number): string {
  if (v === 0) return '0';
  return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2).replace(/^0/, '');
}

/**
 * The K x K attraction matrix as a heatmap you can play with.
 * Row i, column j: how species i feels about species j.
 *
 *   drag up / down     change the value (Shift for fine control)
 *   double-click       zero
 *   right-click        flip the sign
 *   arrow keys         nudge the focused cell
 */
export class MatrixEditor {
  readonly el: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly readout: HTMLElement;
  private cells: HTMLElement[] = [];
  private k = 0;
  private focus: { i: number; j: number } | null = null;
  private drag: { i: number; j: number; y: number; v: number; moved: boolean } | null = null;

  constructor(private readonly app: App) {
    this.grid = h('div', { class: 'matrix', role: 'group', 'aria-label': 'Attraction matrix' });
    this.readout = h('div', { class: 'matrix-readout' });
    this.el = h('div', { class: 'matrix-wrap' }, this.grid, this.readout);
    app.subscribe(() => this.sync());
    this.sync();
  }

  private build(k: number): void {
    this.k = k;
    this.grid.replaceChildren();
    this.grid.style.setProperty('--k', String(k));
    this.cells = [];
    this.grid.append(h('div', { class: 'matrix-corner' }));
    for (let j = 0; j < k; j++) this.grid.append(this.swatch(j, 'col'));
    for (let i = 0; i < k; i++) {
      this.grid.append(this.swatch(i, 'row'));
      for (let j = 0; j < k; j++) {
        const cell = h('div', {
          class: 'matrix-cell',
          role: 'slider',
          tabindex: 0,
          'aria-valuemin': -1,
          'aria-valuemax': 1,
          'aria-label': `${SPECIES_NAMES[i]} towards ${SPECIES_NAMES[j]}`,
        });
        this.wire(cell, i, j);
        this.cells.push(cell);
        this.grid.append(cell);
      }
    }
  }

  private swatch(s: number, kind: 'row' | 'col'): HTMLElement {
    const el = h('div', { class: `matrix-swatch ${kind}`, title: SPECIES_NAMES[s] });
    el.style.setProperty('--c', PALETTE[s]!);
    return el;
  }

  private wire(cell: HTMLElement, i: number, j: number): void {
    const value = () => get(this.app.state.matrix, i, j);
    cell.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      cell.setPointerCapture(e.pointerId);
      this.drag = { i, j, y: e.clientY, v: value(), moved: false };
      this.setFocus(i, j);
      e.preventDefault();
    });
    cell.addEventListener('pointermove', (e) => {
      if (!this.drag || this.drag.i !== i || this.drag.j !== j) return;
      const dy = this.drag.y - e.clientY;
      if (Math.abs(dy) > 2) this.drag.moved = true;
      if (!this.drag.moved) return;
      const perPixel = e.shiftKey ? 1 / 600 : 1 / 120;
      this.app.editCell(i, j, this.drag.v + dy * perPixel);
    });
    const end = () => {
      this.drag = null;
      this.cells.forEach((c) => c.classList.remove('dragging'));
    };
    cell.addEventListener('pointerup', end);
    cell.addEventListener('pointercancel', end);
    cell.addEventListener('dblclick', () => this.app.editCell(i, j, 0));
    cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.app.editCell(i, j, -value());
    });
    cell.addEventListener('pointerenter', () => this.setFocus(i, j));
    cell.addEventListener('focus', () => this.setFocus(i, j));
    cell.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.app.editCell(i, j, value() - Math.sign(e.deltaY) * (e.shiftKey ? 0.01 : 0.05));
    }, { passive: false });
    cell.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.01 : 0.05;
      const k = this.k;
      const move = (di: number, dj: number) => this.cells[((i + di + k) % k) * k + ((j + dj + k) % k)]?.focus();
      switch (e.key) {
        case 'ArrowUp':
        case '+':
          this.app.editCell(i, j, value() + step);
          break;
        case 'ArrowDown':
        case '-':
          this.app.editCell(i, j, value() - step);
          break;
        case 'ArrowLeft':
          move(0, -1);
          break;
        case 'ArrowRight':
          move(0, 1);
          break;
        case 'Enter':
          move(1, 0);
          break;
        case 'Delete':
        case 'Backspace':
          this.app.editCell(i, j, 0);
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    });
  }

  private setFocus(i: number, j: number): void {
    this.focus = { i, j };
    this.renderReadout();
  }

  sync(): void {
    const m = this.app.state.matrix;
    if (m.k !== this.k) this.build(m.k);
    const showNumbers = m.k <= 7;
    this.grid.classList.toggle('numbers', showNumbers);
    this.cells.forEach((cell, idx) => {
      const v = m.values[idx]!;
      cell.style.background = cellColor(v);
      cell.setAttribute('aria-valuenow', String(v));
      cell.setAttribute('aria-valuetext', formatValue(v));
      cell.textContent = showNumbers ? formatValue(v) : '';
      cell.classList.toggle('strong', Math.abs(v) > 0.55);
    });
    if (this.focus && (this.focus.i >= m.k || this.focus.j >= m.k)) this.focus = null;
    this.renderReadout();
  }

  private renderReadout(): void {
    const f = this.focus;
    if (!f) {
      this.readout.innerHTML = '<span class="dim">Drag a cell up or down. Double-click zeroes, right-click flips.</span>';
      return;
    }
    const v = get(this.app.state.matrix, f.i, f.j);
    const verb = v > 0.05 ? 'is drawn to' : v < -0.05 ? 'avoids' : 'ignores';
    const dot = (s: number) => `<i class="dot" style="--c:${PALETTE[s]}"></i>`;
    const who = f.i === f.j ? `${dot(f.i)}${SPECIES_NAMES[f.i]} ${verb} its own kind` : `${dot(f.i)}${SPECIES_NAMES[f.i]} ${verb} ${dot(f.j)}${SPECIES_NAMES[f.j]}`;
    this.readout.innerHTML = `<span>${who}</span><b>${formatValue(v)}</b>`;
  }
}
