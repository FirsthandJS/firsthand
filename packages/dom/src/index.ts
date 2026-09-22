/**
 * `@firsthandjs/dom` — DOM parts, components, portals and keyed lists.
 *
 * Re-exports the reactive core so that applications have one import site.
 */

export { component, defineElement, setElementPrefix, createComponent, view } from './component.js';
export { setComponentAdapter, FirsthandComponentError } from './adapter.js';
export type { ComponentAdapter } from './adapter.js';
export type { Component, ComponentOptions, AttributeCodec, View, Render } from './component.js';
export { render } from './render.js';
export { portal } from './portal.js';
export { list } from './list.js';
export { on, off } from './events.js';
export { mergeProps } from './props.js';

export {
  signal,
  computed,
  effect,
  batch,
  untrack,
  onCleanup,
  createRoot,
  catchError,
  runWithOwner,
  createContext,
  provide,
  useContext,
  FirsthandContextError,
  FirsthandCycleError,
  FirsthandReadonlyError,
} from '@firsthandjs/core';
export type {
  CellOptions,
  Context,
  DeepReadonly,
  Dispose,
  ReadonlyCell,
  ReadonlyProps,
  Signal,
} from '@firsthandjs/core';
