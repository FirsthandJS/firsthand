/**
 * The compiler/runtime protocol for a server render.
 *
 * The twin of `@firsthandjs/dom/internal`: the compiler emits calls against
 * exactly this surface when it is asked for server output, and against the
 * DOM one otherwise. Two surfaces, one set of semantics — which is a promise
 * that has to be kept by measurement, not by care, and is: the parity suite
 * renders every shape both ways and compares the markup.
 */

export const PROTOCOL_VERSION = 1;

export { ssr, child, Markup } from './markup.js';
export { createComponent, spread, view } from './component.js';
export {
  attribute,
  attribute as setAttribute,
  booleanAttribute as setBoolean,
  classValue as setClass,
  escapeAttribute,
  escapeText,
  property as setProperty,
  styleValue as setStyle,
} from './html.js';
