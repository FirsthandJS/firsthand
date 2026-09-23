/**
 * `@firsthandjs/core` — the reactive graph, the owner tree and context.
 *
 * This package knows nothing about the DOM: it must load unchanged in a worker
 * or on a server.
 */

export { signal } from './signal.js';
export { computed } from './computed.js';
export { effect } from './effect.js';
export { batch, snapshot, untrack } from './core.js';
export { setStrictReactivity } from './dev.js';
export { onCleanup, createRoot, catchError, runWithOwner, getOwner } from './lifecycle.js';
export { task } from './task.js';
export type { Task, TaskContext } from './task.js';
export { createContext, provide, useContext } from './context.js';
export type { Context } from './context.js';
export {
  FirsthandCycleError,
  FirsthandContextError,
  FirsthandReadonlyError,
  FirsthandSupersededError,
} from './errors.js';
export type {
  CellOptions,
  DeepReadonly,
  DevtoolsHook,
  Dispose,
  ReadonlyCell,
  ReadonlyProps,
  Signal,
} from './types.js';
export type { Owner } from './core.js';

/** Internal surface used by `@firsthandjs/dom`; not part of the public contract. */
export { createEffect, bind, setRendering, isRendering } from './effect.js';
export { devEnterSetup, devExitSetup } from './dev.js';
export { Cell } from './cell.js';
export {
  createOwner,
  disposeOwner,
  disposeCell,
  handleError,
  own,
  setOwner,
  deferOwner,
  restoreOwner,
} from './core.js';
