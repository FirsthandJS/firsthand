import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, signal } from '@firsthandjs/core';
import { applyChild, FLAT, insert } from '@/insert.js';
import { reconcile } from '@/reconcile.js';
import { on, off, resetDelegation } from '@/events.js';
import { path, template } from '@/template.js';
import { applyProp, mergeProps, spread } from '@/props.js';
import { portal } from '@/portal.js';
import { render } from '@/render.js';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  resetDelegation();
});

describe('templates', () => {
  it('parses once and clones per instance', () => {
    const factory = template('<p class="x">hi</p>');
    const first = factory() as HTMLElement;
    const second = factory() as HTMLElement;
    expect(first).not.toBe(second);
    expect(first.outerHTML).toBe('<p class="x">hi</p>');
    expect(second.outerHTML).toBe(first.outerHTML);
  });

  it('can clone a whole fragment', () => {
    const factory = template('<i>a</i><b>b</b>', true);
    const fragment = factory() as DocumentFragment;
    expect(fragment.childNodes).toHaveLength(2);
  });

  it('descends by a chain of child indices', () => {
    const root = template('<div><i>0</i><i>1</i><i>2</i></div>')() as HTMLElement;
    expect((path(root, 2) as HTMLElement).textContent).toBe('2');
    expect((path(root, 0) as HTMLElement).textContent).toBe('0');
    expect(path(root) as HTMLElement).toBe(root);
  });
});

describe('child parts', () => {
  it('writes a text value in place on update', () => {
    const value = signal<unknown>('a');
    const stop = createRoot((dispose) => {
      insert(host, () => value.value);
      return dispose;
    });
    const text = host.firstChild;
    expect(host.textContent).toBe('a');
    value.value = 'b';
    expect(host.firstChild).toBe(text);
    expect(host.textContent).toBe('b');
    value.value = 42;
    expect(host.textContent).toBe('42');
    stop();
  });

  it('accepts a static value without keeping an effect', () => {
    insert(host, 'static');
    expect(host.textContent).toBe('static');
  });

  it('renders nothing for null, undefined and booleans', () => {
    const value = signal<unknown>('a');
    const stop = createRoot((dispose) => {
      insert(host, () => value.value);
      return dispose;
    });
    for (const empty of [null, undefined, true, false]) {
      value.value = empty;
      expect(host.textContent).toBe('');
    }
    stop();
  });

  it('swaps a node for a text value and back', () => {
    const value = signal<unknown>(document.createElement('span'));
    const stop = createRoot((dispose) => {
      insert(host, () => value.value);
      return dispose;
    });
    expect(host.firstChild?.nodeName).toBe('SPAN');
    value.value = 'text';
    expect(host.textContent).toBe('text');
    const replacement = document.createElement('em');
    value.value = replacement;
    expect(host.firstChild).toBe(replacement);
    stop();
  });

  it('keeps the same node when the thunk returns it again', () => {
    const tick = signal(0);
    const node = document.createElement('em');
    const stop = createRoot((dispose) => {
      insert(host, () => {
        tick.value;
        return node;
      });
      return dispose;
    });
    expect(host.firstChild).toBe(node);
    tick.value = 1;
    expect(host.firstChild).toBe(node);
    expect(host.childNodes).toHaveLength(1);
    stop();
  });

  it('unwraps nested thunks and stringifies foreign objects', () => {
    // Through `insert`, a thunk that returns a thunk becomes a nested part with
    // its own effect — that is what keeps a list inside a conditional stable.
    insert(host, () => () => 'nested');
    expect(host.textContent).toBe('nested');

    // Called directly — as `render` and the element host do — `applyChild`
    // evaluates a thunk in place.
    const other = document.createElement('div');
    const slot = applyChild(other, null, null, () => 'evaluated');
    expect(other.textContent).toBe('evaluated');
    applyChild(other, null, slot, { toString: () => 'object' });
    expect(other.textContent).toBe('object');
  });

  it('flattens arrays, including nested ones and thunks', () => {
    const value = signal<unknown>(['a', ['b', () => 'c'], null, false]);
    const stop = createRoot((dispose) => {
      insert(host, () => value.value);
      return dispose;
    });
    expect(host.textContent).toBe('abc');
    value.value = [];
    expect(host.textContent).toBe('');
    stop();
  });

  it('respects a marker so later siblings keep their position', () => {
    const marker = document.createTextNode('');
    const tail = document.createElement('b');
    tail.textContent = 'tail';
    host.append(marker, tail);
    const value = signal('x');
    const stop = createRoot((dispose) => {
      insert(host, () => value.value, marker);
      return dispose;
    });
    expect(host.textContent).toBe('xtail');
    value.value = 'y';
    expect(host.textContent).toBe('ytail');
    stop();
  });

  it('replaces an array with a single node and vice versa', () => {
    const a = document.createElement('i');
    const b = document.createElement('b');
    const value = signal<unknown>([a, b]);
    const stop = createRoot((dispose) => {
      insert(host, () => value.value);
      return dispose;
    });
    expect(host.childNodes).toHaveLength(2);
    value.value = a;
    expect(host.childNodes).toHaveLength(1);
    value.value = [a, b];
    expect(host.childNodes).toHaveLength(2);
    stop();
  });
});

describe('reconcile', () => {
  const nodes = (count: number): HTMLElement[] =>
    Array.from({ length: count }, (_, i) => {
      const element = document.createElement('i');
      element.textContent = String(i);
      return element;
    });

  const text = (): string => [...host.childNodes].map((node) => node.textContent).join('');

  it('inserts into an empty parent', () => {
    const all = nodes(3);
    reconcile(host, null, [], all);
    expect(text()).toBe('012');
  });

  it('removes everything', () => {
    const all = nodes(3);
    reconcile(host, null, [], all);
    reconcile(host, null, all, []);
    expect(host.childNodes).toHaveLength(0);
  });

  it('appends, prepends and removes from the middle', () => {
    const all = nodes(5);
    reconcile(host, null, [], all.slice(0, 3));
    reconcile(host, null, all.slice(0, 3), all.slice(0, 4));
    expect(text()).toBe('0123');
    reconcile(host, null, all.slice(0, 4), [all[4] as Node, ...all.slice(0, 4)]);
    expect(text()).toBe('40123');
    const withoutMiddle = [all[4] as Node, all[0] as Node, all[2] as Node, all[3] as Node];
    reconcile(host, null, [all[4] as Node, ...all.slice(0, 4)], withoutMiddle);
    expect(text()).toBe('4023');
  });

  it('reverses while keeping every node', () => {
    const all = nodes(4);
    reconcile(host, null, [], all);
    const reversed = [...all].reverse();
    reconcile(host, null, all, reversed);
    expect(text()).toBe('3210');
    expect([...host.childNodes]).toEqual(reversed);
  });

  it('mixes new nodes into a reordered middle', () => {
    const all = nodes(5);
    const extra = nodes(2);
    extra[0]!.textContent = 'x';
    extra[1]!.textContent = 'y';
    reconcile(host, null, [], all);
    // Survivors out of order, with new nodes interleaved: the subsequence pass
    // has to skip the new ones while still moving the right survivors.
    const next = [
      all[0] as Node,
      extra[0] as Node,
      all[3] as Node,
      all[1] as Node,
      extra[1] as Node,
      all[4] as Node,
    ];
    reconcile(host, null, all, next);
    expect(text()).toBe('0x31y4');
    expect([...host.childNodes]).toEqual(next);
  });

  it('replaces a middle that has no survivors at all', () => {
    const all = nodes(3);
    const fresh = nodes(2);
    fresh[0]!.textContent = 'x';
    fresh[1]!.textContent = 'y';
    reconcile(host, null, [], all);
    // Prefix and suffix survive, the middle is entirely new: there is no
    // increasing subsequence to keep.
    const next = [all[0] as Node, fresh[0] as Node, fresh[1] as Node, all[2] as Node];
    reconcile(host, null, all, next);
    expect(text()).toBe('0xy2');
    expect([...host.childNodes]).toEqual(next);
  });

  it('keeps trailing siblings after the marker', () => {
    const marker = document.createElement('hr');
    host.appendChild(marker);
    const all = nodes(2);
    reconcile(host, marker, [], all);
    expect(host.lastChild).toBe(marker);
  });
});

describe('events', () => {
  it('delegates one document listener per type', () => {
    const clicks: string[] = [];
    const outer = document.createElement('div');
    const inner = document.createElement('button');
    outer.appendChild(inner);
    host.appendChild(outer);
    on(outer, 'click', () => clicks.push('outer'));
    on(inner, 'click', () => clicks.push('inner'));
    inner.click();
    expect(clicks).toEqual(['inner', 'outer']);
  });

  it('honours stopPropagation', () => {
    const clicks: string[] = [];
    const outer = document.createElement('div');
    const inner = document.createElement('button');
    outer.appendChild(inner);
    host.appendChild(outer);
    on(outer, 'click', () => clicks.push('outer'));
    on(inner, 'click', (event) => {
      event.stopPropagation();
      clicks.push('inner');
    });
    inner.click();
    expect(clicks).toEqual(['inner']);
  });

  it('reports the current target per step', () => {
    const targets: unknown[] = [];
    const outer = document.createElement('div');
    const inner = document.createElement('button');
    outer.appendChild(inner);
    host.appendChild(outer);
    on(outer, 'click', (event) => targets.push(event.currentTarget));
    on(inner, 'click', (event) => targets.push(event.currentTarget));
    inner.click();
    expect(targets).toEqual([inner, outer]);
  });

  it('attaches non-delegated types directly', () => {
    const seen = vi.fn();
    const node = document.createElement('div');
    host.appendChild(node);
    on(node, 'custom-thing', seen);
    node.dispatchEvent(new Event('custom-thing'));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('supports the native, once and capture escape hatches', () => {
    const native = vi.fn();
    const once = vi.fn();
    const node = document.createElement('button');
    host.appendChild(node);
    on(node, 'click', native, true);
    on(node, 'click', once, { once: true });
    node.click();
    node.click();
    expect(native).toHaveBeenCalledTimes(2);
    expect(once).toHaveBeenCalledTimes(1);
  });

  it('removes a delegated handler', () => {
    const seen = vi.fn();
    const node = document.createElement('button');
    host.appendChild(node);
    on(node, 'click', seen);
    off(node, 'click');
    node.click();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('generic prop application', () => {
  it('handles class, style, ref, prop:, attr: and events', () => {
    const node = document.createElement('input');
    host.appendChild(node);
    let captured: Element | undefined;
    applyProp(node, 'ref', (element: Element) => {
      captured = element;
    });
    applyProp(node, 'class', 'a');
    applyProp(node, 'class', { a: false, b: true });
    applyProp(node, 'style', 'color: red');
    applyProp(node, 'style', { marginTop: '3px' });
    applyProp(node, 'prop:value', 'typed');
    applyProp(node, 'attr:data-x', 'y');
    applyProp(node, 'title', 'hello');
    applyProp(node, 'aria-label', 'label');
    const clicked = vi.fn();
    applyProp(node, 'onClick', clicked);
    node.click();

    expect(captured).toBe(node);
    expect(node.classList.contains('b')).toBe(true);
    expect(node.style.marginTop).toBe('3px');
    expect(node.value).toBe('typed');
    expect(node.getAttribute('data-x')).toBe('y');
    expect(node.title).toBe('hello');
    expect(node.getAttribute('aria-label')).toBe('label');
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('routes capture and native event modifiers', () => {
    const node = document.createElement('button');
    host.appendChild(node);
    const native = vi.fn();
    const captured = vi.fn();
    applyProp(node, 'onClick:native', native);
    applyProp(node, 'onClick:capture', captured);
    node.click();
    expect(native).toHaveBeenCalledTimes(1);
    expect(captured).toHaveBeenCalledTimes(1);
  });

  it('takes a literal event name after `on:`, for custom elements', () => {
    const node = document.createElement('div');
    host.appendChild(node);
    const changed = vi.fn();
    const captured = vi.fn();
    // What a web-component library dispatches: a name no casing of an
    // identifier can produce.
    applyProp(node, 'on:sl-change', changed);
    applyProp(node, 'on:value-changed:capture', captured);

    node.dispatchEvent(new CustomEvent('sl-change', { bubbles: true }));
    node.dispatchEvent(new CustomEvent('value-changed', { bubbles: true }));

    expect(changed).toHaveBeenCalledTimes(1);
    expect(captured).toHaveBeenCalledTimes(1);
    // And the camel-case form still lowercases, as every DOM event needs.
    applyProp(node, 'onSlChange', changed);
    node.dispatchEvent(new CustomEvent('slchange', { bubbles: true }));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('spreads a props object, skipping children', () => {
    const node = document.createElement('div');
    host.appendChild(node);
    spread(node, { title: 'spread', children: 'ignored' });
    expect(node.title).toBe('spread');
    expect(node.textContent).toBe('');
  });

  it('merges prop sources without flattening accessors', () => {
    const value = signal('a');
    const merged = mergeProps(
      {
        get live() {
          return value.value;
        },
      },
      { fixed: 1 },
    );
    expect(merged['live']).toBe('a');
    value.value = 'b';
    expect(merged['live']).toBe('b');
    expect(merged['fixed']).toBe(1);
  });
});

describe('portal', () => {
  it('moves primitives and arrays, and cleans up on disposal', () => {
    const target = document.createElement('section');
    document.body.appendChild(target);
    const dispose = render(() => {
      portal(['text', null, false, document.createElement('b')], target);
      return 'local';
    }, host);
    expect(target.textContent).toBe('text');
    expect(target.querySelector('b')).not.toBeNull();
    expect(host.textContent).toBe('local');
    dispose();
    expect(target.childNodes).toHaveLength(0);
  });

  it('tolerates content that was already removed', () => {
    const target = document.createElement('section');
    document.body.appendChild(target);
    const dispose = render(() => portal(document.createElement('b'), target), host);
    target.innerHTML = '';
    expect(() => dispose()).not.toThrow();
  });
});

describe('an array a keyed list produced', () => {
  it('is placed as it stands, rather than walked again', () => {
    // The list has already done the walk: it has the nodes, it made the array,
    // and nobody else can reach it. `applyChild` handing the same array back
    // is how that is visible from here — an ordinary array is copied into a
    // new one, because it may hold nested arrays, thunks or text.
    const parent = document.createElement('div');
    const rows = Object.assign([document.createElement('p'), document.createElement('p')], {
      [FLAT]: true,
    });
    expect(applyChild(parent, null, null, rows)).toBe(rows);
    expect(parent.childNodes).toHaveLength(2);

    const ordinary = [document.createElement('b')];
    expect(applyChild(parent, null, rows, ordinary)).not.toBe(ordinary);
    expect(parent.childNodes).toHaveLength(1);
  });

  it('empties the slot when it is empty', () => {
    const parent = document.createElement('div');
    parent.append(document.createElement('p'), document.createElement('p'));
    const before = [...parent.childNodes];
    const empty = Object.assign([] as Node[], { [FLAT]: true });
    expect(applyChild(parent, null, before, empty)).toBe(null);
    expect(parent.childNodes).toHaveLength(0);
  });
});
