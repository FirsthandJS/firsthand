/**
 * The timeline tab: what happened, in order, and what each entry says.
 *
 * The graph answers "what depends on this". The timeline answers "what
 * happened", which is the question when something updated and nobody expected
 * it to.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signal } from '@firsthandjs/core';

import { render } from '@firsthandjs/dom';

import { attach, detach } from '@firsthandjs/devtools';

import { close, open, refresh, show } from '@/panel.js';

import { all, body, done, fresh, one, press, root } from './harness.js';

let host: HTMLElement;

beforeEach(() => {
  host = fresh();
});

afterEach(done);

describe('the timeline tab', () => {
  it('says when nothing has happened', () => {
    open();
    press('[data-tab="timeline"]');

    expect(body()).toContain('Nothing has changed yet');
  });

  it('lists what was written and what ran, newest first', () => {
    const first = signal('a');
    const second = signal('b');
    render(
      () => (
        <div>
          <p id="one">{first.value}</p>
          <p id="two">{second.value}</p>
        </div>
      ),
      host,
    );

    first.value = 'x';
    second.value = 'y';

    open();
    press('[data-tab="timeline"]');

    // A row per update, newest first, each with a bar for how much it woke.
    expect(all('.tick .when').length).toBeGreaterThanOrEqual(2);
    expect(all('.tick .who').some((who) => who.includes('timeline.test'))).toBe(true);

    // Clicking one shows what it woke.
    (one('.tick') as HTMLElement).click();
    expect(all('.detail .ran')).toContain('p.text');
  });

  it('shows a write that nothing reacted to, which is often the answer', () => {
    const orphan = signal('nobody reads me');
    orphan.value = 'still nobody';

    open();
    press('[data-tab="timeline"]');

    // The row is there with a grey bar: the write happened and woke no part.
    // "Why did nothing update?" — because nothing was reading.
    expect(one('.tick .bar.none')).not.toBeNull();
  });

  it('goes back to the graph from the timeline', () => {
    open();
    press('[data-tab="timeline"]');
    press('[data-tab="graph"]');

    expect(body()).toContain('Nothing selected');
  });
});

describe('being found at all', () => {
  it('says it is there, once, and how to open it', () => {
    detach();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    attach();

    expect(info).toHaveBeenCalledTimes(1);
    const said = String(info.mock.calls[0]?.[0]);
    expect(said).toContain('Ctrl+Shift+F');
    expect(said).toContain('__FIRSTHAND__.panel()');
    info.mockRestore();
  });

  it('opens and closes on the shortcut', async () => {
    const press = (): void => {
      globalThis.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true }),
      );
    };

    press();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-firsthand-devtools]')).not.toBeNull();

    press();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-firsthand-devtools]')).toBeNull();
  });

  it('ignores the key once detached', async () => {
    detach();
    globalThis.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-firsthand-devtools]')).toBeNull();
  });

  it('leaves an ordinary keystroke alone', async () => {
    globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('[data-firsthand-devtools]')).toBeNull();
  });
});

describe('narrowing the timeline', () => {
  it('offers a chip per source, and filters to one', () => {
    const first = signal('a');
    const second = signal('b');
    render(
      () => (
        <div>
          <p id="one">{first.value}</p>
          <p id="two">{second.value}</p>
        </div>
      ),
      host,
    );

    first.value = 'x';
    second.value = 'y';
    second.value = 'z';

    open();
    press('[data-tab="timeline"]');
    expect(all('.chip')).toHaveLength(2);
    expect(body()).toContain('3 of 3 updates');

    // Narrow to the second signal: two of the three.
    (root().querySelectorAll('.chip')[1] as HTMLElement).click();
    expect(body()).toContain('2 of 3 updates');

    // And clicking it again widens back out.
    (root().querySelectorAll('.chip')[1] as HTMLElement).click();
    expect(body()).toContain('3 of 3 updates');
  });

  it('closes a detail when the same row is clicked twice', () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);
    count.value = 2;

    open();
    press('[data-tab="timeline"]');
    (one('.tick') as HTMLElement).click();
    expect(body()).toContain('Written from');

    (one('.tick') as HTMLElement).click();
    expect(body()).not.toContain('Written from');
  });
});

describe('a write with nowhere to point', () => {
  it('shows the detail without a stack section', () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);

    // An engine that gives no stack: the detail still opens, with no frames.
    const RealError = globalThis.Error;
    const Fake = class extends RealError {
      constructor() {
        super();
        Object.defineProperty(this, 'stack', { value: undefined, configurable: true });
      }
    };
    globalThis.Error = Fake as unknown as ErrorConstructor;
    count.value = 2;
    globalThis.Error = RealError;

    open();
    press('[data-tab="timeline"]');
    (one('.tick') as HTMLElement).click();

    expect(body()).toContain('woke 1');
    expect(body()).not.toContain('Written from');
  });
});

describe('what a timeline row says', () => {
  it('says what the bar is drawn against', () => {
    const count = signal(1);
    render(
      () => (
        <>
          <p>{count.value}</p>
          <p>{count.value}</p>
        </>
      ),
      host,
    );
    count.value = 2;

    open();
    press('[data-tab="timeline"]');

    // A bar with no scale beside it is a shape, not a number.
    expect(one('.tick .bar')?.getAttribute('title')).toBe('woke 2 of 2');
  });

  it('names where the write came from, not only what was written', () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);

    const RealError = globalThis.Error;
    const Fake = class extends RealError {
      constructor() {
        super();
        Object.defineProperty(this, 'stack', {
          value: 'Error\n    at tick (/src/app.tsx:31:7)',
          configurable: true,
        });
      }
    };
    globalThis.Error = Fake as unknown as ErrorConstructor;
    count.value = 2;
    globalThis.Error = RealError;

    open();
    press('[data-tab="timeline"]');

    // The name beside it answers "what changed"; this answers "from where",
    // and without it a row only says where the signal was declared.
    expect(one('.tick .where')?.textContent).toBe('app.tsx:31:7');
  });
});

describe('a frame served by a development server', () => {
  it('drops the cache-busting query from the file name', () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);

    // Vite serves `main.tsx?v=8f1c2d`, which changes on every restart and
    // says nothing about where the write came from.
    const RealError = globalThis.Error;
    const Fake = class extends RealError {
      constructor() {
        super();
        Object.defineProperty(this, 'stack', {
          value: 'Error\n    at trigger (/src/app.tsx?v=8f1c2d:31:7)',
          configurable: true,
        });
      }
    };
    globalThis.Error = Fake as unknown as ErrorConstructor;
    count.value = 2;
    globalThis.Error = RealError;

    open();
    press('[data-tab="timeline"]');
    (one('.tick') as HTMLElement).click();

    expect(body()).toContain('trigger (app.tsx:31:7)');
    expect(body()).not.toContain('v=8f1c2d');
  });
});

describe('where the detail sits', () => {
  it('keeps the detail out of the scrolling list', () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);
    for (let i = 0; i < 30; i++) {
      count.value = i;
    }

    open();
    press('[data-tab="timeline"]');
    (one('.tick') as HTMLElement).click();

    // The list scrolls; the detail is pinned beside it rather than below
    // thirty rows, where the call stack could only be reached by scrolling
    // past the whole log.
    const detail = one('.detail') as HTMLElement;
    expect(detail.classList.contains('pinned')).toBe(true);
    expect(detail.closest('.scroll')).toBeNull();
    expect(one('.scroll .tick')).not.toBeNull();
  });
});

describe('holding still while something is open', () => {
  it('closes the detail from its own button', () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);
    count.value = 2;

    open();
    press('[data-tab="timeline"]');
    (one('.tick') as HTMLElement).click();
    expect(one('.detail')).not.toBeNull();

    press('[aria-label="Close detail"]');
    expect(one('.detail')).toBeNull();
  });

  it('does not redraw underneath an open entry', async () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);
    count.value = 2;

    open();
    press('[data-tab="timeline"]');
    (one('.tick') as HTMLElement).click();
    const before = all('.tick .when').length;

    // More updates arrive; the list stays as it was, so the row under the
    // pointer does not move away from it.
    count.value = 3;
    count.value = 4;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    expect(all('.tick .when')).toHaveLength(before);

    // Closing it lets the list catch up on the next update — closing itself
    // does not rebuild it either, for the same reason opening does not.
    press('[aria-label="Close detail"]');
    count.value = 5;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    expect(all('.tick .when').length).toBeGreaterThan(before);
  });

  it('keeps the scroll position across a redraw', () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);
    for (let i = 0; i < 40; i++) {
      count.value = i;
    }

    open();
    press('[data-tab="timeline"]');
    const list = one('.scroll') as HTMLElement;
    list.scrollTop = 120;
    refresh();

    expect((one('.scroll') as HTMLElement).scrollTop).toBe(120);
  });
});

describe('selecting does not move the list', () => {
  it('leaves the row where it was, however many updates arrived', () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);
    for (let i = 0; i < 5; i++) {
      count.value = i;
    }

    open();
    press('[data-tab="timeline"]');
    const rows = [...root().querySelectorAll('.tick')] as HTMLElement[];
    const third = rows[2] as HTMLElement;
    const labelBefore = third.textContent;

    // More arrive between drawing the list and clicking a row — which is the
    // ordinary case at two updates a second.
    count.value = 99;
    count.value = 100;
    third.click();

    const after = [...root().querySelectorAll('.tick')] as HTMLElement[];
    expect(after[2]?.textContent).toBe(labelBefore);
    expect(after[2]?.getAttribute('aria-selected')).toBe('true');
    expect(one('.detail')).not.toBeNull();
  });
});

describe('an open entry across the panel', () => {
  it('stays open when the tab changes, on both tabs', () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);
    count.value = 2;

    open();
    press('[data-tab="timeline"]');
    (one('.tick') as HTMLElement).click();
    expect(one('.pinned')).not.toBeNull();

    // The graph tab shows the same detail, beside its own list.
    press('[data-tab="graph"]');
    show(host.querySelector('p') as Node);
    expect(one('.pinned')).not.toBeNull();
    expect((one('.pinned') as HTMLElement).closest('.scroll')).toBeNull();

    // And back again.
    press('[data-tab="timeline"]');
    expect(one('.pinned')).not.toBeNull();
  });

  it('ignores a click on a row that outlived the panel', () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);
    count.value = 2;

    open();
    press('[data-tab="timeline"]');
    const row = one('.tick') as HTMLElement;
    close();

    expect(() => {
      row.click();
    }).not.toThrow();
  });
});
