/** Remaining edge cases, kept apart so the behavioural suites stay readable. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, signal, type ReadonlyCell } from '@firsthandjs/core';
import { applyChild, insert } from '@/insert.js';
import { reconcile } from '@/reconcile.js';
import { applyProp } from '@/props.js';
import { list } from '@/list.js';
import { component, createComponent } from '@/component.js';
import { render } from '@/render.js';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

describe('child slot edges', () => {
  it('replaces a single node in place', () => {
    const first = document.createElement('i');
    const second = document.createElement('b');
    const slot = applyChild(host, null, null, first);
    applyChild(host, null, slot, second);
    expect(host.childNodes).toHaveLength(1);
    expect(host.firstChild).toBe(second);
  });

  it('clears a node that something else already took out of the document', () => {
    const node = document.createElement('i');
    const slot = applyChild(host, null, null, node);
    // A host element relocated by a third party, or a portal that moved its
    // content: disposal still has to finish rather than throw.
    node.remove();

    expect(applyChild(host, null, slot, null)).toBeNull();
    expect(host.childNodes).toHaveLength(0);
  });

  it('removes nodes that did not survive a reconcile', () => {
    const nodes = Array.from({ length: 4 }, () => document.createElement('i'));
    reconcile(host, null, [], nodes);
    // Drop one from the middle while also reordering, so the removal pass runs.
    reconcile(host, null, nodes, [nodes[3] as Node, nodes[1] as Node, nodes[0] as Node]);
    expect(host.childNodes).toHaveLength(3);
    expect([...host.childNodes]).toEqual([nodes[3], nodes[1], nodes[0]]);
  });
});

describe('generic prop application', () => {
  it('prefers a DOM property when the value is not a string', () => {
    const node = document.createElement('input');
    applyProp(node, 'checked', true);
    expect(node.checked).toBe(true);
    applyProp(node, 'id', 'as-attribute');
    expect(node.getAttribute('id')).toBe('as-attribute');
  });
});

describe('list rows', () => {
  it('accepts rows that render arrays, primitives and nothing', () => {
    const items = signal([1, 2, 3]);
    const stop = createRoot((dispose) => {
      insert(
        host,
        list(
          () => items.value,
          (item) => item,
          (item: ReadonlyCell<number>) => {
            const value = item.peek();
            if (value === 1) {
              return [document.createElement('i'), 'text'];
            }
            if (value === 2) {
              return 'plain';
            }
            return null;
          },
        ),
      );
      return dispose;
    });
    expect(host.textContent).toBe('textplain');
    expect(host.querySelectorAll('i')).toHaveLength(1);
    items.value = [3];
    expect(host.textContent).toBe('');
    stop();
  });

  it('restores the scope when a row body throws, and reports the failure', () => {
    const scheduled: (() => void)[] = [];
    const spy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((callback: () => void) => void scheduled.push(callback));
    const items = signal([1]);
    createRoot((dispose) => {
      insert(
        host,
        list(
          () => items.value,
          (item) => item,
          () => {
            throw new Error('row failed');
          },
        ),
      );
      dispose();
    });
    expect(scheduled).toHaveLength(1);
    expect(() => scheduled[0]?.()).toThrow('row failed');
    spy.mockRestore();
  });
});

describe('component props', () => {
  it('accepts a component with no options and no children', () => {
    const Leaf = component(
      () => {
        const node = document.createElement('p');
        node.textContent = 'leaf';
        return node;
      },
      undefined,
      'pkg/Leaf',
      'Leaf',
    );
    const dispose = render(() => createComponent(Leaf, {}), host);
    expect(host.textContent).toBe('leaf');
    dispose();
  });
});

describe('component declaration edges', () => {
  it('is callable: Counter(props) does what <Counter /> compiles to', () => {
    const Leaf = component(
      (props: { label: string }) => {
        const node = document.createElement('em');
        node.textContent = props.label;
        return node;
      },
      undefined,
      'pkg/Callable',
      'Callable',
    );
    const dispose = render(() => Leaf({ label: 'called directly' }), host);
    expect(host.textContent).toBe('called directly');
    dispose();
  });

  it('falls back to a generic display name for an anonymous setup', () => {
    const anonymous = component((() => null) as () => null, undefined, 'pkg/x', undefined);
    expect(anonymous.name).toBe('Component');
  });

  it('hosts an element when only shadow is requested', () => {
    const Shadow = component(
      () => {
        const node = document.createElement('span');
        node.textContent = 'shadowed';
        return node;
      },
      { shadow: true },
      'pkg/ShadowOnly',
      'ShadowOnly',
    );
    expect(Shadow.tag).toBe('firsthand-shadow-only');
    const dispose = render(() => createComponent(Shadow, {}), host);
    expect((host.firstElementChild as HTMLElement).shadowRoot?.textContent).toBe('shadowed');
    dispose();
  });

  it('accepts an explicit element tag name', () => {
    const Named = component(
      () => {
        const node = document.createElement('span');
        node.textContent = 'explicit';
        return node;
      },
      { tag: 'my-explicit-tag' },
      'pkg/Named',
      'Named',
    );
    expect(Named.tag).toBe('my-explicit-tag');
    const dispose = render(() => createComponent(Named, {}), host);
    expect(host.firstElementChild?.tagName.toLowerCase()).toBe('my-explicit-tag');
    dispose();
  });
});
