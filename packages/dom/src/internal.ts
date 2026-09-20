/**
 * The compiler/runtime protocol (ARCHITECTURE section 1.1).
 *
 * The compiler has no privileged access to runtime internals: it emits calls
 * against exactly this surface, which is also importable by hand. That is what
 * makes "no benchmark-only runtime" an enforceable property rather than a
 * promise — the benchmark, the examples and the tests all go through here.
 *
 * Breaking changes to this surface bump `PROTOCOL_VERSION`, and the compiler
 * emits a version assertion so a mismatched pair fails loudly at build time.
 */

export const PROTOCOL_VERSION = 1;

export { template, path } from './template.js';
export { insert, applyChild, reconcile, part } from './insert.js';
export type { DynamicChild, ChildSlot } from './insert.js';
export {
  setAttribute,
  setAttributeNS,
  setProperty,
  setBoolean,
  setClass,
  setClassList,
  setStyle,
  setStyleObject,
} from './attributes.js';
export { on, off } from './events.js';
export { applyProp, spread, mergeProps, rest } from './props.js';
export { bind } from '@firsthandjs/core';
// Emitted by the compiler's `devtools` option only, which a production build
// never turns on; the production copy of this module returns its argument.
export { label } from './dev.js';
export { list } from './list.js';
export { createComponent, isComponent, COMPONENT } from './component.js';
