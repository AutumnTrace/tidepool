import type { App, Tool } from '../app';
import { PARAM_LIMITS, PARAM_STEPS, type SimParams } from '../sim/params';
import { zeros } from '../sim/matrix';
import { SPEED_LIMITS } from '../sim/url-state';
import type { Preset } from '../sim/presets';
import { MatrixEditor } from './matrix-editor';
import { ICONS, h, icon } from './dom';

export interface PanelActions {
  copyLink(): void;
  toggleHelp(): void;
}

interface Control {
  el: HTMLElement;
  sync(): void;
}

const fmtCount = (n: number) => n.toLocaleString('en-US');

/**
 * A slider with a label and live readout. `log` maps the track
 * logarithmically, which suits half-lives that span two orders of magnitude.
 */
function slider(o: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  log?: boolean;
  /** Apply on release instead of on every input event. */
  onRelease?: boolean;
  get(): number;
  set(v: number): void;
  format(v: number): string;
}): Control {
  const RES = 1000;
  const toTrack = (v: number) =>
    o.log ? (Math.log(v / o.min) / Math.log(o.max / o.min)) * RES : ((v - o.min) / (o.max - o.min)) * RES;
  const fromTrack = (t: number) => {
    const raw = o.log ? o.min * Math.pow(o.max / o.min, t / RES) : o.min + ((o.max - o.min) * t) / RES;
    const snapped = Math.round(raw / o.step) * o.step;
    return Math.min(o.max, Math.max(o.min, Number(snapped.toFixed(6))));
  };
  const input = h('input', { type: 'range', min: 0, max: RES, step: 1, 'aria-label': o.label });
  const value = h('output', { class: 'slider-value' });
  const el = h('label', { class: 'slider', title: o.hint }, h('span', { class: 'slider-label', text: o.label }), value, input);
  let editing = false;
  const paint = (v: number) => {
    value.textContent = o.format(v);
    input.style.setProperty('--fill', `${(toTrack(v) / RES) * 100}%`);
  };
  input.addEventListener('input', () => {
    editing = true;
    const v = fromTrack(Number(input.value));
    paint(v);
    if (!o.onRelease) o.set(v);
  });
  input.addEventListener('change', () => {
    editing = false;
    o.set(fromTrack(Number(input.value)));
  });
  return {
    el,
    sync() {
      if (editing && o.onRelease) return;
      const v = o.get();
      input.value = String(Math.round(toTrack(v)));
      paint(v);
    },
  };
}

function stepper(o: {
  label: string;
  hint: string;
  get(): number;
  dec(): void;
  inc(): void;
  format(v: number): string;
  canDec(): boolean;
  canInc(): boolean;
}): Control {
  const minus = h('button', { class: 'step-btn', 'aria-label': `Fewer ${o.label.toLowerCase()}`, text: '−' });
  const plus = h('button', { class: 'step-btn', 'aria-label': `More ${o.label.toLowerCase()}`, text: '+' });
  const value = h('output', { class: 'stepper-value' });
  minus.addEventListener('click', () => o.dec());
  plus.addEventListener('click', () => o.inc());
  const el = h(
    'div',
    { class: 'stepper', title: o.hint },
    h('span', { class: 'slider-label', text: o.label }),
    h('div', { class: 'stepper-controls' }, minus, value, plus),
  );
  return {
    el,
    sync() {
      value.textContent = o.format(o.get());
      minus.disabled = !o.canDec();
      plus.disabled = !o.canInc();
    },
  };
}

export class Panel {
  readonly el: HTMLElement;
  private readonly controls: Control[] = [];
  private readonly playBtn: HTMLButtonElement;
  private readonly presetButtons = new Map<string, HTMLButtonElement>();
  private readonly blurb: HTMLElement;
  private readonly mirror: HTMLButtonElement;
  private readonly tools = new Map<Tool, HTMLButtonElement>();
  private readonly seedInput: HTMLInputElement;

  constructor(
    private readonly app: App,
    private readonly presets: readonly Preset[],
    actions: PanelActions,
  ) {
    const s = () => app.state;
    const p = () => app.state.params;
    const setP = <K extends keyof SimParams>(key: K) => (v: number) => app.setParam(key, v as SimParams[K]);

    // Header
    const collapse = h('button', { class: 'icon-btn collapse', 'aria-label': 'Hide panel (P)', title: 'Hide panel (P)' }, icon(ICONS.chevron));
    collapse.addEventListener('click', () => this.toggle());
    const head = h(
      'header',
      { class: 'panel-head' },
      h('div', { class: 'brand' }, h('span', { class: 'wordmark', text: 'tidepool' }), h('span', { class: 'tagline', text: 'particle life on WebGPU' })),
      collapse,
    );
    head.addEventListener('click', (e) => {
      if (this.el.classList.contains('collapsed') && e.target !== collapse) this.toggle(false);
    });

    // Transport
    const button = (label: string, svg: string, onClick: () => void, extra = '') => {
      const b = h('button', { class: `icon-btn ${extra}`, 'aria-label': label, title: label }, icon(svg));
      b.addEventListener('click', onClick);
      return b;
    };
    this.playBtn = button('Pause (Space)', ICONS.pause, () => app.togglePause(), 'primary');
    const transport = h(
      'div',
      { class: 'transport' },
      this.playBtn,
      button('Step once (.)', ICONS.step, () => app.stepOnce()),
      button('Respawn with a new seed (N)', ICONS.respawn, () => app.respawn()),
      button('Copy a link to this exact setup (C)', ICONS.link, () => actions.copyLink()),
      h('span', { class: 'spacer' }),
      button('Keyboard shortcuts (?)', ICONS.help, () => actions.toggleHelp()),
    );

    // Presets
    const presetRow = h('div', { class: 'presets' });
    presets.forEach((preset, idx) => {
      const b = h('button', { class: 'chip', title: `${preset.blurb} (${idx + 1})` }, h('span', { class: 'chip-key', text: String(idx + 1) }), preset.name);
      b.addEventListener('click', () => app.applyPreset(preset));
      this.presetButtons.set(preset.id, b);
      presetRow.append(b);
    });
    this.blurb = h('p', { class: 'blurb' });

    // Rules
    const editor = new MatrixEditor(app);
    const randomize = h('button', { class: 'text-btn', title: 'New random rules (R)', text: 'Randomise' });
    randomize.addEventListener('click', () => app.randomizeMatrix());
    this.mirror = h('button', { class: 'text-btn toggle', title: 'Keep the matrix symmetric (M)', 'aria-pressed': 'false', text: 'Symmetric' });
    this.mirror.addEventListener('click', () => app.setSymmetric(!app.symmetric));
    const zero = h('button', { class: 'text-btn', title: 'Set every rule to zero', text: 'Zero' });
    zero.addEventListener('click', () => app.setMatrix(zeros(p().species)));

    // World
    const count = stepper({
      label: 'Particles',
      hint: 'Doubles or halves the particle count; the world grows with it so density stays put. Keys: [ and ].',
      get: () => p().count,
      dec: () => app.setParam('count', Math.max(PARAM_LIMITS.count.min, p().count / 2)),
      inc: () => app.setParam('count', Math.min(PARAM_LIMITS.count.max, p().count * 2)),
      canDec: () => p().count / 2 >= PARAM_LIMITS.count.min,
      canInc: () => p().count * 2 <= PARAM_LIMITS.count.max,
      format: fmtCount,
    });
    const species = stepper({
      label: 'Species',
      hint: 'Number of particle types, 2 to 12. Keys: - and =.',
      get: () => p().species,
      dec: () => app.setParam('species', p().species - 1),
      inc: () => app.setParam('species', p().species + 1),
      canDec: () => p().species > PARAM_LIMITS.species.min,
      canInc: () => p().species < PARAM_LIMITS.species.max,
      format: String,
    });
    this.seedInput = h('input', { class: 'seed-input', type: 'text', inputmode: 'numeric', 'aria-label': 'Seed', spellcheck: 'false' });
    this.seedInput.addEventListener('change', () => {
      const v = Number.parseInt(this.seedInput.value, 10);
      if (Number.isFinite(v) && v >= 0) app.respawn(v >>> 0);
      else this.seedInput.value = String(s().seed);
    });
    this.seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.seedInput.blur();
    });
    const dice = button('Random seed (N)', ICONS.dice, () => app.respawn());
    const seedRow = h('div', { class: 'stepper', title: 'Seed for the starting positions. Same seed, same start.' }, h('span', { class: 'slider-label', text: 'Seed' }), h('div', { class: 'stepper-controls' }, this.seedInput, dice));

    // Physics
    const L = PARAM_LIMITS;
    const physics = [
      slider({
        label: 'Density',
        hint: 'Average neighbours inside the interaction radius. Rescales the world without respawning.',
        min: L.density.min,
        max: L.density.max,
        step: PARAM_STEPS.density,
        log: true,
        onRelease: true,
        get: () => p().density,
        set: setP('density'),
        format: (v) => `${v.toFixed(0)} nbrs`,
      }),
      slider({
        label: 'Force',
        hint: 'Overall strength of every rule.',
        min: L.force.min,
        max: L.force.max,
        step: PARAM_STEPS.force,
        log: true,
        get: () => p().force,
        set: setP('force'),
        format: (v) => v.toFixed(1),
      }),
      slider({
        label: 'Friction',
        hint: 'Velocity half-life. Short = syrupy, long = slippery.',
        min: L.friction.min,
        max: L.friction.max,
        step: PARAM_STEPS.friction,
        log: true,
        get: () => p().friction,
        set: setP('friction'),
        format: (v) => `${(v * 1000).toFixed(0)} ms`,
      }),
      slider({
        label: 'Personal space',
        hint: 'Radius of the short-range repulsion every particle has, as a fraction of the interaction radius.',
        min: L.beta.min,
        max: L.beta.max,
        step: PARAM_STEPS.beta,
        get: () => p().beta,
        set: setP('beta'),
        format: (v) => v.toFixed(2),
      }),
      slider({
        label: 'Speed',
        hint: 'Simulation steps per second, as a multiple of 60.',
        min: SPEED_LIMITS.min,
        max: SPEED_LIMITS.max,
        step: SPEED_LIMITS.step,
        log: true,
        get: () => s().speed,
        set: (v) => app.update({ speed: v }),
        format: (v) => `${v}×`,
      }),
    ];

    // Pointer
    const toolRow = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Pointer tool' });
    const toolHints: Record<Tool, string> = {
      pull: 'Drag to pull particles in (right-drag pushes)',
      push: 'Drag to push particles away (right-drag pulls)',
      pan: 'Drag to move around',
    };
    for (const tool of ['pull', 'push', 'pan'] as const) {
      const b = h('button', { role: 'radio', title: toolHints[tool], text: tool[0]!.toUpperCase() + tool.slice(1) });
      b.addEventListener('click', () => app.setTool(tool));
      this.tools.set(tool, b);
      toolRow.append(b);
    }

    const section = (title: string, ...children: (Node | string)[]) =>
      h('section', {}, h('h2', { text: title }), ...children);

    this.controls.push(count, species, ...physics);
    const body = h(
      'div',
      { class: 'panel-body' },
      transport,
      section('Presets', presetRow, this.blurb),
      section('Rules', editor.el, h('div', { class: 'button-row' }, randomize, this.mirror, zero)),
      section('World', count.el, species.el, seedRow),
      section('Physics', ...physics.map((c) => c.el)),
      section('Pointer', toolRow),
      h(
        'footer',
        { class: 'panel-foot' },
        h('span', { text: 'Press ? for shortcuts' }),
        h('a', { href: 'https://github.com/AutumnTrace/tidepool', target: '_blank', rel: 'noopener' }, icon(ICONS.github, 14), 'Source'),
      ),
    );
    this.el = h('aside', { class: 'panel', 'aria-label': 'Controls' }, head, body);
    if (window.innerWidth < 720) this.el.classList.add('collapsed');
    app.subscribe(() => this.sync());
    this.sync();
  }

  toggle(force?: boolean): void {
    const collapsed = force === undefined ? !this.el.classList.contains('collapsed') : !force;
    this.el.classList.toggle('collapsed', collapsed);
  }

  get visible(): boolean {
    return !this.el.classList.contains('collapsed');
  }

  sync(): void {
    const app = this.app;
    this.playBtn.replaceChildren(icon(app.running ? ICONS.pause : ICONS.play));
    const playLabel = app.running ? 'Pause (Space)' : 'Play (Space)';
    this.playBtn.setAttribute('aria-label', playLabel);
    this.playBtn.title = playLabel;
    for (const [id, b] of this.presetButtons) b.classList.toggle('active', id === app.presetId);
    const preset = this.presets.find((x) => x.id === app.presetId);
    this.blurb.textContent = preset ? preset.blurb : 'Your own rules. The URL keeps them.';
    this.mirror.setAttribute('aria-pressed', String(app.symmetric));
    for (const [tool, b] of this.tools) b.setAttribute('aria-checked', String(tool === app.tool));
    if (document.activeElement !== this.seedInput) this.seedInput.value = String(app.state.seed);
    for (const c of this.controls) c.sync();
  }
}
