import {
  setAttribute,
  setClass,
  setClassList,
  setProperty,
  setStyle,
  setStyleObject,
} from './attributes.js';
import { on } from './events.js';

/**
 * The generic property applier.
 *
 * The compiler emits specialised setters wherever it knows the kind of a part,
 * so this function is only reached by `class`/`style` (which genuinely accept
 * several shapes), by spread attributes, and by the runtime JSX path. It is
 * deliberately not on any hot path the compiler controls.
 */
export function applyProp(node: Element, name: string, value: unknown): void {
  if (name === 'class' || name === 'className') {
    if (value !== null && typeof value === 'object') {
      setClassList(node, value as Record<string, unknown>, remember(node, 'class', value));
    } else {
      setClass(node, value);
    }
    return;
  }
  if (name === 'style') {
    if (value !== null && typeof value === 'object') {
      setStyleObject(
        node as unknown as ElementCSSInlineStyle,
        value as Record<string, string>,
        remember(node, 'style', value) as Record<string, string> | undefined,
      );
    } else {
      setStyle(node as unknown as ElementCSSInlineStyle, value);
    }
    return;
  }
  if (name === 'ref') {
    (value as (element: Element) => void)(node);
    return;
  }
  if (name.startsWith('prop:')) {
    setProperty(node, name.slice(5), value);
    return;
  }
  if (name.startsWith('attr:')) {
    setAttribute(node, name.slice(5), value);
    return;
  }
  if (name.startsWith('on') && name.length > 2 && /[A-Z:]/.test(name[2] as string)) {
    applyEvent(node, name, value);
    return;
  }
  if (name in node && typeof value !== 'string') {
    setProperty(node, name, value);
    return;
  }
  setAttribute(node, name, value);
}

/**
 * `onClick`, `onClick:capture`, and `on:sl-change` for a literal event name.
 *
 * The camel-case form lowercases, which is right for every DOM event and
 * wrong for the ones component libraries invent: Shoelace dispatches
 * `sl-change`, Vaadin `value-changed`, and no casing of an identifier
 * produces a hyphen. `on:` takes what follows verbatim, so those work without
 * a ref and an `addEventListener` by hand.
 */
export function applyEvent(node: Element, name: string, value: unknown): void {
  const parts = name.slice(2).split(':');
  // A leading `:` means the name is literal: `on:sl-change` -> `sl-change`.
  const literal = parts[0] === '';
  const type = literal ? (parts[1] as string) : (parts[0] as string).toLowerCase();
  const modifier = parts[literal ? 2 : 1];
  if (modifier === undefined) {
    on(node, type, value as (event: Event) => void);
  } else if (modifier === 'native') {
    on(node, type, value as (event: Event) => void, true);
  } else {
    on(node, type, value as (event: Event) => void, { [modifier]: true });
  }
}

/** Applies a spread of props to an element. */
export function spread(node: Element, props: Record<string, unknown>): void {
  for (const name in props) {
    if (name !== 'children') {
      applyProp(node, name, props[name]);
    }
  }
}

/**
 * Merges prop sources without flattening their accessors.
 *
 * `{...a} {...b}` must not snapshot: every key becomes a getter that delegates
 * to the source, so a reactive prop stays reactive through a spread.
 */
export function mergeProps(...sources: Record<string, unknown>[]): Record<string, unknown> {
  const target: Record<string, unknown> = {};
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i] as Record<string, unknown>;
    for (const name of Object.keys(source)) {
      Object.defineProperty(target, name, {
        enumerable: true,
        configurable: true,
        get: () => source[name],
      });
    }
  }
  return target;
}

/**
 * The remaining props, as live reads.
 *
 * `component(({ a, ...rest }) => ...)` compiles to a call to this. The result
 * delegates every key back to the original props object, so a prop that
 * changes is still seen through `rest` — copying the values instead would
 * reintroduce exactly the snapshot the rewrite exists to remove.
 */
export function rest(
  props: Record<string, unknown>,
  omit: readonly string[],
): Record<string, unknown> {
  const remaining: Record<string, unknown> = {};
  for (const name of Object.keys(props)) {
    if (!omit.includes(name)) {
      Object.defineProperty(remaining, name, {
        enumerable: true,
        get: () => props[name],
      });
    }
  }
  return Object.freeze(remaining);
}

/** Per-element memory for the diffing setters, allocated only when needed. */
const records = new WeakMap<Element, Record<string, Record<string, unknown>>>();

function remember(
  node: Element,
  slot: string,
  value: unknown,
): Record<string, unknown> | undefined {
  let record = records.get(node);
  if (record === undefined) {
    record = {};
    records.set(node, record);
  }
  const previous = record[slot];
  record[slot] = value as Record<string, unknown>;
  return previous;
}
