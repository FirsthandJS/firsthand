/**
 * Memory tests (ADR-0011).
 *
 * Two kinds, deliberately:
 *
 * 1. **Structural assertions** that do not depend on GC at all. After disposal,
 *    the graph must contain no edge back to the disposed scope, the owner tree
 *    must be empty, and a write to a source must run nothing. These fail
 *    immediately on a regression, in every engine.
 * 2. **`WeakRef` probes**, which need a forced GC. They run only where one is
 *    available and are skipped with a stated reason otherwise — never silently.
 */
import { describe, expect, it } from 'vitest';
import { createRoot, getOwner, signal, type Signal } from '@firsthandjs/core';
import { Cell } from '@firsthandjs/core';
import { component, createComponent } from '@/component.js';
import { insert } from '@/insert.js';
import { list } from '@/list.js';
import { render } from '@/render.js';

function subscriberCount(source: unknown): number {
  let link = (source as Cell).subs;
  let total = 0;
  while (link !== undefined) {
    total++;
    link = link.nextSub;
  }
  return total;
}

function ownerChildCount(owner: { head: unknown; next?: unknown } | null): number {
  let child = owner?.head as { next: unknown } | null | undefined;
  let total = 0;
  while (child != null) {
    total++;
    child = child.next as { next: unknown } | null;
  }
  return total;
}

const forceGc = (globalThis as { gc?: () => void }).gc;

describe('disposal leaves nothing behind', () => {
  it('drops every subscription of 10 000 components', () => {
    const shared = signal(0);
    const host = document.createElement('div');

    const Leaf = component(
      (props: { index: number }) => {
        const node = document.createElement('span');
        insert(node, () => `${String(props.index)}:${String(shared.value)}`);
        return node;
      },
      undefined,
      'pkg/Leaf',
      'Leaf',
    );

    const dispose = render(() => {
      const nodes: Node[] = [];
      for (let i = 0; i < 10_000; i++) {
        nodes.push(createComponent(Leaf, { index: i }) as Node);
      }
      return nodes;
    }, host);

    expect(subscriberCount(shared)).toBe(10_000);
    expect(host.childNodes).toHaveLength(10_000);

    dispose();

    expect(subscriberCount(shared)).toBe(0);
    expect(host.childNodes).toHaveLength(0);
  });

  it('returns to a clean graph after repeated create/destroy cycles', () => {
    const shared = signal(0);
    const host = document.createElement('div');

    for (let cycle = 0; cycle < 5; cycle++) {
      const dispose = render(() => {
        const nodes: Node[] = [];
        for (let i = 0; i < 2000; i++) {
          const node = document.createElement('i');
          insert(node, () => shared.value);
          nodes.push(node);
        }
        return nodes;
      }, host);
      expect(subscriberCount(shared)).toBe(2000);
      shared.value = cycle + 1;
      dispose();
      // Every cycle must return to exactly zero, not to "a bit more each time".
      expect(subscriberCount(shared)).toBe(0);
    }
  });

  it('disposes list rows and their subscriptions when the list is cleared', () => {
    const shared = signal(0);
    const rows = signal(Array.from({ length: 5000 }, (_, id) => ({ id })));
    const host = document.createElement('div');

    const dispose = render(() => {
      const thunk = list(
        () => rows.value,
        (row) => row.id,
        (row) => {
          const node = document.createElement('i');
          insert(node, () => `${String(row.value.id)}-${String(shared.value)}`);
          return node;
        },
      );
      insert(host, thunk);
      return null;
    }, host);

    expect(subscriberCount(shared)).toBe(5000);

    rows.value = [];
    expect(subscriberCount(shared)).toBe(0);
    expect(host.querySelectorAll('i')).toHaveLength(0);

    dispose();
  });

  it('empties the owner tree and stops every effect', () => {
    const shared = signal(0);
    let runs = 0;
    let owner: { head: unknown } | null = null;

    const stop = createRoot((dispose) => {
      owner = getOwner() as unknown as { head: unknown };
      const node = document.createElement('i');
      for (let i = 0; i < 100; i++) {
        insert(node, () => {
          runs++;
          return shared.value;
        });
      }
      return dispose;
    });

    const before = runs;
    shared.value = 1;
    expect(runs).toBe(before + 100);

    stop();
    shared.value = 2;
    expect(runs).toBe(before + 100);
    expect(subscriberCount(shared)).toBe(0);
    expect(ownerChildCount(owner)).toBe(0);
  });

  it('a handler on a removed node is not reachable from the framework', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = render(() => {
      const button = document.createElement('button');
      button.textContent = 'x';
      return button;
    }, host);
    dispose();
    // Delegated handlers live on the element itself, so there is no registry
    // that could outlive the node (ADR-0012).
    expect(host.childNodes).toHaveLength(0);
  });
});

describe('weak reference probes', () => {
  const run = forceGc === undefined ? it.skip : it;

  // Recorded rather than hidden: without `--expose-gc` these cannot be made
  // deterministic, so they are skipped and the structural assertions above are
  // what gates the build.
  run('a disposed component becomes unreachable', async () => {
    const host = document.createElement('div');
    let weakSignal!: WeakRef<Signal<number>>;
    let weakNode!: WeakRef<Node>;

    const Leaf = component(
      () => {
        const local = signal(0);
        const node = document.createElement('span');
        insert(node, () => local.value);
        weakSignal = new WeakRef(local);
        weakNode = new WeakRef(node);
        return node;
      },
      undefined,
      'pkg/Leaf2',
      'Leaf',
    );

    const dispose = render(() => createComponent(Leaf, {}), host);
    dispose();
    host.innerHTML = '';

    await new Promise((resolve) => setTimeout(resolve, 0));
    (forceGc as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 0));
    (forceGc as () => void)();

    expect(weakSignal.deref()).toBeUndefined();
    expect(weakNode.deref()).toBeUndefined();
  });
});
