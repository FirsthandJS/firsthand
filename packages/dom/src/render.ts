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
  let dispose!: Dispose;
  createRoot((stop) => {
    dispose = stop;
    const result = untrack(view);
    if (typeof result === 'function') {
      // A component whose setup returned a render function. It is a reactive
      // scope, so it is bound rather than called once — `insert` owns the
      // nodes it produces and removes them on disposal.
      insert(container, result);
      return;
    }
    let slot: ChildSlot = null;
    slot = applyChild(container, null, null, result);
    onCleanup(() => {
      applyChild(container, null, slot, null);
    });
  });
  return dispose;
}
