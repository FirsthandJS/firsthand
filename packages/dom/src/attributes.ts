/**
 * Specialised setters for the attribute-shaped parts of a template.
 *
 * Each kind has its own function rather than one generic `setAttribute(node,
 * name, value)` dispatcher, because the compiler already knows which kind it
 * emitted (ADR-0009). Nothing here inspects a value to decide what it is,
 * except where the public contract genuinely allows several shapes (`class`
 * and `style`).
 */

/** Attributes whose canonical form is a DOM property with a different name. */
const PROPERTY_ALIASES: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
};

export function setAttribute(node: Element, name: string, value: unknown): void {
  if (value == null || value === false) {
    node.removeAttribute(name);
  } else {
    node.setAttribute(name, value === true ? '' : String(value));
  }
}

export function setAttributeNS(node: Element, ns: string, name: string, value: unknown): void {
  if (value == null || value === false) {
    node.removeAttributeNS(ns, name);
  } else {
    node.setAttributeNS(ns, name, value === true ? '' : String(value));
  }
}

/** Writes a DOM property, which is what keeps object props out of strings. */
export function setProperty(node: Element, name: string, value: unknown): void {
  (node as unknown as Record<string, unknown>)[PROPERTY_ALIASES[name] ?? name] = value;
}

/** A boolean DOM property such as `disabled` or `checked`. */
export function setBoolean(node: Element, name: string, value: unknown): void {
  (node as unknown as Record<string, boolean>)[name] = !!value;
}

/** `class` as a string, replacing whatever was there. */
export function setClass(node: Element, value: unknown): void {
  if (value == null) {
    node.removeAttribute('class');
  } else {
    node.className = String(value);
  }
}

/**
 * `class` as a record of `{ name: enabled }`, toggling only what changed.
 *
 * `previous` is the record from the last run; the caller keeps it, so nothing
 * is allocated here.
 */
export function setClassList(
  node: Element,
  value: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
): void {
  const list = node.classList;
  if (previous !== undefined) {
    for (const name in previous) {
      if (!(name in value)) {
        list.remove(name);
      }
    }
  }
  for (const name in value) {
    const enabled = !!value[name];
    if (previous === undefined || !!previous[name] !== enabled) {
      list.toggle(name, enabled);
    }
  }
}

/** `style` as a string. */
export function setStyle(node: ElementCSSInlineStyle, value: unknown): void {
  if (value == null) {
    node.style.cssText = '';
  } else {
    node.style.cssText = String(value);
  }
}

/**
 * `style` as an object, diffed per property.
 *
 * Rewriting `cssText` would discard properties set elsewhere and force a full
 * re-parse of the declaration; setting only what changed does not.
 */
export function setStyleObject(
  node: ElementCSSInlineStyle,
  value: Record<string, string | number | null | undefined>,
  previous: Record<string, string | number | null | undefined> | undefined,
): void {
  const style = node.style;
  if (previous !== undefined) {
    for (const name in previous) {
      if (!(name in value)) {
        style.removeProperty(hyphenate(name));
      }
    }
  }
  for (const name in value) {
    const next = value[name];
    if (previous === undefined || previous[name] !== next) {
      if (next == null) {
        style.removeProperty(hyphenate(name));
      } else {
        style.setProperty(hyphenate(name), String(next));
      }
    }
  }
}

const HYPHENATE = /[A-Z]/g;
const hyphenateCache = new Map<string, string>();

/** `marginTop` -> `margin-top`, memoised: property names repeat constantly. */
function hyphenate(name: string): string {
  let result = hyphenateCache.get(name);
  if (result === undefined) {
    result = name.startsWith('--')
      ? name
      : name.replace(HYPHENATE, (letter) => `-${letter.toLowerCase()}`);
    hyphenateCache.set(name, result);
  }
  return result;
}
