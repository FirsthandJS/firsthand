/**
 * Devtools read the graph the framework already keeps.
 *
 * The test that matters is the last one: the chain a person asks for when a
 * button is disabled and nobody knows why.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computed, effect, signal } from '@firsthandjs/core';
import { deepSignal } from '@firsthandjs/deep';
import { component } from '@firsthandjs/dom';
import { render } from '@firsthandjs/dom';
import { label } from '@firsthandjs/dom/internal';
import {
  attach,
  causeOf,
  cells,
  chain,
  detach,
  inspect,
  stack,
  timeline,
} from '@firsthandjs/devtools';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  attach();
});

afterEach(() => {
  detach();
});

describe('attaching', () => {
  it('installs the hook once, and removes it again', () => {
    expect(globalThis.__FIRSTHAND_DEVTOOLS__?.attached).toBe(true);
    attach(); // a second call is a no-op rather than a second hook
    expect(globalThis.__FIRSTHAND_DEVTOOLS__?.attached).toBe(true);

    detach();
    expect(globalThis.__FIRSTHAND_DEVTOOLS__).toBeUndefined();
  });

  it('records nothing once detached', () => {
    detach();
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);

    expect(cells()).toEqual([]);
  });
});

describe('what it can see', () => {
  it('lists the computeds and effects that are alive', () => {
    const count = signal(1);
    render(() => {
      const doubled = computed(() => count.value * 2);
      effect(() => void doubled.value);
      return <p>{doubled.value}</p>;
    }, host);

    const found = cells();
    expect(found.some((node) => node.kind === 'computed')).toBe(true);
    expect(found.some((node) => node.kind === 'effect' || node.kind === 'part')).toBe(true);
  });

  it('names a signal by where it was created when nothing else named it', () => {
    const count = signal(1);
    render(() => <p>{count.value}</p>, host);

    const [part] = inspect(host.querySelector('p') as Node);
    const source = part?.dependencies[0];
    expect(source?.kind).toBe('signal');
    expect(source?.name).toMatch(/devtools\.test\.tsx:\d+:\d+/);
  });

  it('names a part by the node and property it writes', () => {
    const disabled = signal(true);
    render(() => <button disabled={disabled.value}>Save</button>, host);

    const [part] = inspect(host.querySelector('button') as Node);
    expect(part?.name).toBe('button.disabled');
    expect(part?.kind).toBe('part');
  });

  it('carries the current value of a signal', () => {
    const count = signal(41);
    render(() => <p>{count.value}</p>, host);

    const [part] = inspect(host.querySelector('p') as Node);
    expect(part?.dependencies[0]?.value).toBe(41);
  });

  it('says so plainly when nothing reactive writes a node', () => {
    render(() => <p>static</p>, host);
    expect(chain(host.querySelector('p') as Node)).toBe('Nothing reactive writes this node.');
    expect(inspect(host.querySelector('p') as Node)).toEqual([]);
  });
});

describe('why an effect ran', () => {
  it('names the dependency that scheduled it', () => {
    const status = signal('draft');
    render(() => <button disabled={status.value === 'sent'}>Save</button>, host);
    const button = host.querySelector('button') as Node;

    expect(causeOf(button)).toBeNull(); // nothing has changed yet

    status.value = 'sent';

    expect(causeOf(button)).toMatch(/devtools\.test\.tsx:\d+:\d+/);
  });

  it('has nothing to say about a node it does not write', () => {
    render(() => <p>static</p>, host);
    expect(causeOf(host.querySelector('p') as Node)).toBeNull();
  });
});

describe('the chain', () => {
  it('draws the path from the sources down to the DOM node', () => {
    const order = { status: signal('draft') };
    // Named by its function rather than by its variable, because that is what
    // a runtime can see; the compiler option that reads the variable name is
    // the next step.
    const editable = computed(function isEditable() {
      return order.status.value === 'draft';
    });

    const Button = component(() => <button disabled={!editable.value}>Save</button>);
    render(() => <Button />, host);

    const drawn = chain(host.querySelector('button') as Node);

    // The shape of the answer, which is the whole point of the package:
    //   <source>
    //      ↓
    //   computed(isEditable)
    //      ↓
    //   button.disabled
    expect(drawn).toContain('computed(isEditable)');
    expect(drawn).toContain('button.disabled');
    expect(drawn.indexOf('computed(isEditable)')).toBeLessThan(drawn.indexOf('button.disabled'));
    expect(drawn.split('\n   ↓\n')).toHaveLength(3);
  });

  it('draws one path when a part reads several sources', () => {
    const first = signal('a');
    const second = signal('b');
    render(() => <p>{first.value + second.value}</p>, host);

    const drawn = chain(host.querySelector('p') as Node);

    // A chain is a story, so it tells one. `inspect` still returns both
    // dependencies for anything that wants the whole shape.
    expect(drawn.split('\n   ↓\n')).toHaveLength(2);
    expect(inspect(host.querySelector('p') as Node)[0]?.dependencies).toHaveLength(2);
  });

  it('follows both directions of the graph', () => {
    const status = signal('draft');
    const isEditable = computed(() => status.value === 'draft');
    render(() => <button disabled={!isEditable.value}>Save</button>, host);

    const [part] = inspect(host.querySelector('button') as Node);
    const middle = part?.dependencies[0];
    expect(middle?.kind).toBe('computed');
    expect(middle?.dependencies[0]?.kind).toBe('signal');
  });
});

describe('deep state', () => {
  it('names a property by its path through the tree', () => {
    const state = deepSignal({ user: { address: { city: 'Cambridge' } } });
    render(() => <p>{state.user.address.city}</p>, host);

    const [part] = inspect(host.querySelector('p') as Node);
    expect(part?.dependencies.map((d) => d.name)).toContain('user.address.city');
  });

  it('calls the which-keys-exist subscription `keys`', () => {
    const state = deepSignal<Record<string, string>>({ a: '1' });
    render(() => <p>{Object.keys(state).length}</p>, host);

    // `Object.keys`, `for…in` and spreading all subscribe to one thing: whether
    // the set of keys changed. It is a symbol internally; a panel should not
    // have to show that.
    expect(inspect(host.querySelector('p') as Node)[0]?.dependencies[0]?.name).toBe('keys');
  });

  it('names a top-level property without a prefix', () => {
    const state = deepSignal({ title: 'Draft' });
    render(() => <p>{state.title}</p>, host);

    expect(inspect(host.querySelector('p') as Node)[0]?.dependencies[0]?.name).toBe('title');
  });

  it('names an array length, and shows both subscriptions the read made', () => {
    const state = deepSignal({ todos: ['write'] });
    render(() => <p>{state.todos.length}</p>, host);

    // Reading `state.todos.length` subscribes twice: to the `todos` property of
    // the root, and to the array's own `length`. Both are in the graph, so both
    // are shown — which is the answer to "why did this update when I replaced
    // the whole array?".
    expect(inspect(host.querySelector('p') as Node)[0]?.dependencies.map((d) => d.name)).toEqual([
      'todos',
      'todos.length',
    ]);
  });
});

describe('the component stack', () => {
  it('names the components a part lives inside, outermost first', () => {
    const count = signal(1);
    const Leaf = component(() => <p>{count.value}</p>, undefined, 'pkg/Leaf', 'Leaf');
    const Middle = component(() => <section>{Leaf({})}</section>, undefined, 'pkg/Mid', 'Middle');
    const Outer = component(() => <div>{Middle({})}</div>, undefined, 'pkg/Out', 'Outer');

    render(() => Outer({}), host);

    expect(stack(host.querySelector('p') as Node)).toEqual(['Outer', 'Middle', 'Leaf']);
  });

  it('has nothing to say about a node no part writes', () => {
    render(() => <p>static</p>, host);
    expect(stack(host.querySelector('p') as Node)).toEqual([]);
  });
});

describe('the timeline', () => {
  it('records what was written and what ran because of it', () => {
    const status = signal('draft');
    render(() => <button disabled={status.value === 'sent'}>Save</button>, host);

    expect(timeline()).toEqual([]); // nothing has been written yet

    status.value = 'sent';

    const [update] = timeline();
    expect(update?.source).toMatch(/devtools\.test\.tsx:\d+:\d+/);
    expect(update?.ran).toEqual(['button.disabled']);
    expect(typeof update?.at).toBe('number');
  });

  it('keeps them in order, and can be asked about one node', () => {
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
    first.value = 'z';

    expect(timeline()).toHaveLength(3);
    // Only the two that ran *this* node's part. Both paragraphs' parts are
    // called `p.text`, so this has to compare identities rather than names —
    // which is what the first version of it got wrong.
    expect(timeline(host.querySelector('#one') as Node)).toHaveLength(2);
  });

  it('has nothing to say about a node no part writes', () => {
    render(() => <p>static</p>, host);
    expect(timeline(host.querySelector('p') as Node)).toEqual([]);
  });
});

describe('names the compiler supplied', () => {
  it('uses the variable name and the line that was written', () => {
    // `label` is what the compiler emits under its `devtools` option. The
    // position matters: `error.stack` reports the compiled line, not this one.
    const count = signal(0);
    label(count, 'signal', 'count (order.ts:12)');
    render(() => <p>{count.value}</p>, host);

    expect(inspect(host.querySelector('p') as Node)[0]?.dependencies[0]?.name).toBe(
      'count (order.ts:12)',
    );
  });

  it('hands back what it was given, and ignores a primitive', () => {
    const cell = signal(1);
    expect(label(cell, 'signal', 'x')).toBe(cell);
    expect(label(42, 'signal', 'x')).toBe(42);
    expect(label(null, 'signal', 'x')).toBeNull();
  });
});
