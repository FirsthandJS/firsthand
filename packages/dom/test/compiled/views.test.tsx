/**
 * Plain functions that return markup.
 *
 * A function is a reactive scope, so a view written as one is re-run when
 * something it read changes — no `component()`, no setup, no state. The
 * compiler resolves a tag that names a local function itself; a view from
 * another module carries a mark that `createComponent` reads instead.
 */
import { describe, expect, it } from 'vitest';
import { cleanup, mount } from '@firsthandjs/testing';
import { component, computed, render, signal } from '@firsthandjs/dom';
import { view } from '@firsthandjs/dom/internal';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

let plainRuns = 0;
function Plain({ value }: { value: string }) {
  plainRuns++;
  return (
    <div data-plain>
      <h1>Value: {value}</h1>
    </div>
  );
}

function Static() {
  return <b data-static>Hello</b>;
}

describe('a view function', () => {
  it('runs again when what it read changes', () => {
    plainRuns = 0;
    const count = signal(0);
    const App = component(() => (
      <section>
        <Plain value={String(count.value)} />
      </section>
    ));
    const host = mount(() => <App />);

    expect(host.text()).toContain('Value: 0');
    expect(plainRuns).toBe(1);

    count.value = 1;
    expect(host.text()).toContain('Value: 1');
    expect(plainRuns).toBe(2);
  });

  it('costs nothing after the first run when it reads nothing', () => {
    const count = signal(0);
    let runs = 0;
    function Counted() {
      runs++;
      return <i>fixed</i>;
    }
    const App = component(() => (
      <section>
        <Counted />
        <span>{count.value}</span>
      </section>
    ));
    const host = mount(() => <App />);

    expect(runs).toBe(1);
    count.value = 1;
    count.value = 2;
    // Nothing reactive was read, so no effect was retained for it.
    expect(runs).toBe(1);
    expect(host.text()).toContain('2');
  });

  it('works where a component is the whole return', () => {
    const count = signal(0);
    const App = component(() => <Plain value={String(count.value)} />);
    const host = mount(() => <App />);

    expect(host.text()).toContain('Value: 0');
    count.value = 3;
    expect(host.text()).toContain('Value: 3');
  });

  it('is disposed with the branch that held it', () => {
    const shown = signal(true);
    const App = component(() => <div>{shown.value ? <Static /> : null}</div>);
    const host = mount(() => <App />);

    expect(host.all('[data-static]')).toHaveLength(1);
    shown.value = false;
    expect(host.all('[data-static]')).toHaveLength(0);
    shown.value = true;
    expect(host.all('[data-static]')).toHaveLength(1);
  });

  it('works as a row of a keyed list', () => {
    const items = signal([1, 2]);
    const App = component(() => (
      <ul>
        {items.value.map((n) => (
          <li key={n}>
            <Plain value={String(n)} />
          </li>
        ))}
      </ul>
    ));
    const host = mount(() => <App />);

    expect(host.text()).toContain('Value: 1');
    expect(host.text()).toContain('Value: 2');
    items.value = [2];
    expect(host.text()).not.toContain('Value: 1');
  });

  it('is recognised across a module boundary by its mark', () => {
    const count = signal(0);
    // What the compiler emits for a module-level view, applied by hand: the
    // tag below cannot be resolved statically, so the runtime reads the mark.
    const Imported = view(function Badge(props: { readonly value: string }) {
      return <em data-badge>{props.value}</em>;
    });
    const App = component(() => (
      <section>
        <Imported value={String(count.value)} />
      </section>
    ));
    const host = mount(() => <App />);

    expect(host.get('[data-badge]').textContent).toBe('0');
    count.value = 5;
    expect(host.get('[data-badge]').textContent).toBe('5');
  });

  it('may be called instead of written as a tag', () => {
    const made = Static();
    const App = component(() => <div>{made}</div>);
    const host = mount(() => <App />);
    expect(host.all('[data-static]')).toHaveLength(1);
  });

  it('may be produced by a computed', () => {
    const count = signal(0);
    const chosen = computed(() => (count.value > 1 ? <b data-high>high</b> : <i data-low>low</i>));
    const App = component(() => <div>{chosen.value}</div>);
    const host = mount(() => <App />);

    expect(host.all('[data-low]')).toHaveLength(1);
    count.value = 2;
    expect(host.all('[data-high]')).toHaveLength(1);
  });
});

describe('a setup that returns a render function', () => {
  it('is bound at the root of render()', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const open = signal(true);
    const App = component(() => () => (open.value ? <b data-open>open</b> : <i data-shut>shut</i>));

    const dispose = render(() => <App />, container);

    expect(container.querySelectorAll('[data-open]')).toHaveLength(1);
    open.value = false;
    expect(container.querySelectorAll('[data-shut]')).toHaveLength(1);

    dispose();
    expect(container.innerHTML).toBe('');
  });

  it('may be a view function at the root of render()', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const count = signal(0);

    const dispose = render(() => <Plain value={String(count.value)} />, container);
    expect(container.textContent).toContain('Value: 0');
    count.value = 2;
    expect(container.textContent).toContain('Value: 2');
    dispose();
  });
});

describe('a part writes only what changed', () => {
  it('leaves the text node alone when the value is the same', () => {
    const tick = signal(0);
    // The text depends on `tick` only through a value that does not move.
    const App = component(() => <p>{tick.value > 100 ? 'high' : 'low'}</p>);
    const host = mount(() => <App />);
    const text = host.get('p').firstChild as Text;

    let writes = 0;
    let held = text.data;
    Object.defineProperty(text, 'data', {
      configurable: true,
      get: () => held,
      set: (next: string) => {
        writes++;
        held = next;
      },
    });

    tick.value = 1;
    tick.value = 2;
    tick.value = 3;
    // The part ran three times and wrote nothing: the string it produced was
    // the one already there.
    expect(writes).toBe(0);
    expect(held).toBe('low');

    tick.value = 200;
    expect(writes).toBe(1);
    expect(held).toBe('high');
  });
});
