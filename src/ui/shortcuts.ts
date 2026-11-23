import type { App } from '../app';
import { PARAM_LIMITS } from '../sim/params';
import type { Preset } from '../sim/presets';

export interface UiHooks {
  presets: readonly Preset[];
  togglePanel(): void;
  toggleHelp(force?: boolean): void;
  helpOpen(): boolean;
  copyLink(): void;
  toast(message: string): void;
}

export interface Shortcut {
  /** Values of KeyboardEvent.key that trigger it. */
  keys: string[];
  /** How the help overlay shows the keys. */
  show: string[];
  label: string;
  run(app: App, ui: UiHooks, key: string): void;
}

/** Single source of truth for the key handler and the help overlay. */
export const SHORTCUTS: Shortcut[] = [
  { keys: [' '], show: ['Space'], label: 'Play / pause', run: (app) => app.togglePause() },
  { keys: ['.', '>'], show: ['.'], label: 'Step once', run: (app) => app.stepOnce() },
  {
    keys: ['r'],
    show: ['R'],
    label: 'New random rules',
    run: (app, ui) => {
      app.randomizeMatrix();
      ui.toast('New rules');
    },
  },
  { keys: ['n'], show: ['N'], label: 'Respawn with a new seed', run: (app) => app.respawn() },
  {
    keys: ['m'],
    show: ['M'],
    label: 'Symmetric rules on / off',
    run: (app, ui) => {
      app.setSymmetric(!app.symmetric);
      ui.toast(app.symmetric ? 'Symmetric: on' : 'Symmetric: off');
    },
  },
  {
    keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    show: ['1', '–', '9'],
    label: 'Presets',
    run: (app, ui, key) => {
      const p = ui.presets[Number(key) - 1];
      if (p) {
        app.applyPreset(p);
        ui.toast(p.name);
      }
    },
  },
  {
    keys: ['[', ']'],
    show: ['[', ']'],
    label: 'Halve / double the particles',
    run: (app, _ui, key) => {
      const n = app.state.params.count;
      const next = key === ']' ? n * 2 : n / 2;
      if (next >= PARAM_LIMITS.count.min && next <= PARAM_LIMITS.count.max) app.setParam('count', next);
    },
  },
  {
    keys: ['-', '=', '+'],
    show: ['-', '='],
    label: 'Fewer / more species',
    run: (app, _ui, key) => {
      const k = app.state.params.species + (key === '-' ? -1 : 1);
      if (k >= PARAM_LIMITS.species.min && k <= PARAM_LIMITS.species.max) app.setParam('species', k);
    },
  },
  { keys: ['0'], show: ['0'], label: 'Reset the camera', run: (app) => app.resetCamera() },
  { keys: ['p'], show: ['P'], label: 'Show / hide the panel', run: (_app, ui) => ui.togglePanel() },
  { keys: ['d'], show: ['D'], label: 'GPU timings', run: (app) => app.hud.toggle() },
  { keys: ['c'], show: ['C'], label: 'Copy a link to this setup', run: (_app, ui) => ui.copyLink() },
  {
    keys: ['f'],
    show: ['F'],
    label: 'Fullscreen',
    run: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    },
  },
  { keys: ['?', 'h'], show: ['?'], label: 'This help', run: (_app, ui) => ui.toggleHelp() },
];

export const POINTER_HELP: [string, string][] = [
  ['Drag', 'Pull particles in (or push, with the Push tool)'],
  ['Right-drag', 'The opposite force'],
  ['Middle-drag, Alt-drag', 'Pan around the torus'],
  ['Wheel, pinch', 'Zoom'],
  ['Two fingers', 'Pan and zoom'],
];

export function installShortcuts(app: App, ui: UiHooks): void {
  const table = new Map<string, Shortcut>();
  for (const s of SHORTCUTS) for (const k of s.keys) table.set(k, s);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      if (target.getAttribute('type') !== 'range') return;
    }
    if (e.key === 'Escape' && ui.helpOpen()) {
      ui.toggleHelp(false);
      return;
    }
    const shortcut = table.get(e.key.length === 1 ? e.key.toLowerCase() : e.key) ?? table.get(e.key);
    if (!shortcut) return;
    // Space on a focused button would click it as well; one action is enough.
    e.preventDefault();
    shortcut.run(app, ui, e.key);
  });
}
