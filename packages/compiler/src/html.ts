/** Static tables and escaping used while building a template's HTML. */

/** Elements that must not be closed. */
export const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** Attributes written as boolean DOM properties rather than attributes. */
export const BOOLEAN_PROPERTIES = new Set([
  'checked',
  'disabled',
  'multiple',
  'muted',
  'readOnly',
  'selected',
  'autofocus',
  'autoplay',
  'controls',
  'loop',
  'open',
  'required',
]);

/**
 * Attributes whose dynamic form must be a DOM property.
 *
 * `value` is the canonical example: setting the attribute does not change what
 * the user sees once the field has been edited.
 */
export const DOM_PROPERTIES = new Set([
  'value',
  'textContent',
  'innerHTML',
  'innerText',
  'scrollTop',
  'scrollLeft',
  'volume',
  'currentTime',
  'playbackRate',
  'srcObject',
]);

/** SVG elements, so the compiler can emit namespaced templates. */
export const SVG_ELEMENTS = new Set([
  'svg',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'g',
  'defs',
  'use',
  'text',
  'tspan',
  'symbol',
  'mask',
  'pattern',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
  'filter',
]);

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** `onPointerDown` -> `pointerdown`. */
export function eventName(attribute: string): string {
  return attribute.slice(2).toLowerCase();
}

/**
 * Whether an attribute name is a listener.
 *
 * `onClick` and `on:sl-change` are both listeners; `once` and `onwards` are
 * not, which is what the third character decides — a capital or a colon after
 * `on` is the only thing that makes the rest a type name.
 *
 * One definition rather than two, because the browser path and the server path
 * both need it and have to agree: a name the server skips and the browser
 * attaches would be a listener nobody could reach.
 */
export function isEventName(name: string): boolean {
  return name.startsWith('on') && name.length > 2 && /[A-Z:]/.test(name[2] as string);
}
