import { POINTER_HELP, SHORTCUTS } from './shortcuts';
import { h } from './dom';

export class HelpOverlay {
  readonly el: HTMLElement;

  constructor() {
    const keys = h('dl', { class: 'help-list' });
    for (const s of SHORTCUTS) {
      keys.append(
        h('dt', {}, ...s.show.map((k) => (k === '–' ? k : h('kbd', { text: k })))),
        h('dd', { text: s.label }),
      );
    }
    const pointer = h('dl', { class: 'help-list' });
    for (const [what, does] of POINTER_HELP) pointer.append(h('dt', { text: what }), h('dd', { text: does }));

    const card = h(
      'div',
      { class: 'help-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts' },
      h('h2', { text: 'Shortcuts' }),
      h('div', { class: 'help-cols' }, h('div', {}, h('h3', { text: 'Keyboard' }), keys), h('div', {}, h('h3', { text: 'Pointer' }), pointer)),
      h('p', { class: 'help-foot', text: 'Esc or ? to close.' }),
    );
    this.el = h('div', { class: 'help', hidden: true }, card);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.toggle(false);
    });
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(force?: boolean): void {
    this.el.hidden = !(force ?? this.el.hidden);
  }
}

export class Toast {
  readonly el: HTMLElement;
  private timer = 0;

  constructor() {
    this.el = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
  }

  show(message: string): void {
    this.el.textContent = message;
    this.el.classList.add('visible');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('visible'), 1400);
  }
}
