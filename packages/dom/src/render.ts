import { createRoot, onCleanup, untrack, type Dispose } from '@firsthandjs/core';
import type { View } from './component.js';
import { applyChild, insert, type ChildSlot } from './insert.js';

/**
 * Mounts a view and returns its disposer.
 *
 * The container defaults to `document.body`, so an application needs no
 * element lookup and no cast to start. Everything the view creates belongs to
 * this root, so `dispose()` unsubscribes every effect, runs every cleanup and
 * removes exactly the nodes that were inserted — not the container's other
 * children.
 */
export function render(view: () => View, container: ParentNode = document.body): Dispose {
  return mount(view, container, null);
}

/**
 * The whole of mounting, with one hole in it.
 *
 * `around` is how `@firsthandjs/dom/hydrate` gets in: it wraps the run so that
 * what the view builds is adopted rather than created. `render` passes
 * nothing, which is why a build without a server contains neither the wrapper
 * nor anything it would have called.
 */
export function mount(
  view: () => View,
  container: ParentNode,
  around: ((body: () => void) => void) | null,
): Dispose {
  let dispose!: Dispose;
  createRoot((stop) => {
    dispose = stop;
    const run = (): void => {
      attach(container, untrack(view), around !== null);
    };
    if (around === null) {
      run();
    } else {
      around(run);
    }
  });
  return dispose;
}

function attach(container: ParentNode, result: View, adopting: boolean): void {
  if (typeof result === 'function') {
    // A component whose setup returned a render function. It is a reactive
    // scope, so it is bound rather than called once — `insert` owns the nodes
    // it produces and removes them on disposal.
    insert(container, result);
    return;
  }
  // The nodes a hydrating run returns are the container's own children
  // already, so handing them in as the current slot makes the first apply a
  // comparison rather than a move. One child is handed over as itself rather
  // than as a list of one, because that is the comparison `applyChild` makes
  // for a single node — a list would be cleared and re-inserted, which is the
  // same tree and a removal nobody asked for.
  let slot: ChildSlot = null;
  if (adopting) {
    const children = [...container.childNodes];
    slot = children.length === 1 ? (children[0] as Node) : children;
  }
  slot = applyChild(container, null, slot, result);
  onCleanup(() => {
    applyChild(container, null, slot, null);
  });
}
