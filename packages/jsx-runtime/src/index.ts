/**
 * Runtime JSX.
 *
 * This is the fallback path for environments where the Firsthand compiler is not
 * configured (a REPL, a test that imports TSX directly, a tool that transpiles
 * with `jsxImportSource`). It produces real DOM through the same protocol as
 * the compiled output — there is no second semantics and no second runtime.
 *
 * What it cannot do is hoist static markup into a `<template>`: it creates
 * elements one at a time. The compiled path is what the performance claims are
 * measured against, and the README says so.
 *
 * One convention exists only here: a **function value** in an attribute or
 * child position is treated as a dynamic thunk, because a runtime JSX call has
 * already evaluated its arguments and cannot see the expression. The compiler
 * produces those thunks itself, so compiled code never relies on this.
 */

import { applyProp, createComponent, insert, isComponent, part } from '@firsthandjs/dom/internal';
import { bind } from '@firsthandjs/core';

export const Fragment: unique symbol = Symbol.for('firsthand.fragment');

type Props = Record<string, unknown>;

export function jsx(type: unknown, props: Props): unknown {
  if (typeof type === 'string') {
    return element(type, props);
  }
  if (type === Fragment) {
    const children = props['children'];
    // Same treatment as the compiled path: a dynamic child of a fragment
    // carries the scope it was written in, so context and disposal follow the
    // code rather than whoever inserts the array.
    if (Array.isArray(children)) {
      return (children as unknown[]).map((child) =>
        typeof child === 'function' ? part(child as () => unknown) : child,
      );
    }
    return typeof children === 'function' ? part(children as () => unknown) : (children ?? null);
  }
  if (isComponent(type)) {
    return createComponent(type as never, props as never);
  }
  if (typeof type === 'function') {
    // A plain function used as a component: supported so that helper factories
    // work, with the same single-call semantics.
    return (type as (props: Props) => unknown)(props);
  }
  throw new TypeError(`Not a valid JSX element type: ${String(type)}`);
}

export const jsxs = jsx;
export const jsxDEV = jsx;

function element(tag: string, props: Props): Element {
  const node = document.createElement(tag);
  for (const name in props) {
    const value = props[name];
    if (name === 'children') {
      continue;
    }
    if (typeof value === 'function' && !name.startsWith('on') && name !== 'ref') {
      bind(() => {
        applyProp(node, name, (value as () => unknown)());
      });
    } else {
      applyProp(node, name, value);
    }
  }
  const children = props['children'];
  if (children !== undefined) {
    appendChildren(node, children);
  }
  return node;
}

function appendChildren(node: Element, children: unknown): void {
  if (Array.isArray(children)) {
    for (let i = 0; i < children.length; i++) {
      appendChild(node, children[i]);
    }
    return;
  }
  appendChild(node, children);
}

function appendChild(node: Element, child: unknown): void {
  if (typeof child === 'function') {
    // A dynamic position needs a stable anchor, because static siblings may
    // follow it.
    const marker = document.createTextNode('');
    node.appendChild(marker);
    insert(node, child, marker);
    return;
  }
  if (child == null || typeof child === 'boolean') {
    return;
  }
  if (Array.isArray(child)) {
    appendChildren(node, child);
    return;
  }
  if (typeof child === 'object' && typeof (child as Node).nodeType === 'number') {
    node.appendChild(child as Node);
    return;
  }
  node.appendChild(document.createTextNode(String(child as string | number)));
}

// ---------------------------------------------------------------------------
// JSX typings
//
// Declared here rather than in a separate `.d.ts`, because a declaration file
// that is an *input* is neither emitted nor referenced by `tsc`: the published
// package would have had no JSX types at all, which is exactly the bug this
// moved to fix. Living in the entry module, they are emitted with it and
// cannot be lost.
// ---------------------------------------------------------------------------

/**
 * JSX typings for Firsthand.
 *
 * Three things make TSX behave here without casts at the use site:
 *
 * - `JSX.Element` is the runtime's own `View` type, so what a component returns
 *   and what the runtime accepts are the same type rather than two
 *   descriptions of each other.
 * - `JSX.IntrinsicAttributes` carries `key`, which every element may take and
 *   which the list part consumes — it never reaches a component as a prop.
 * - Every attribute explicitly admits `undefined`, because the project compiles
 *   with `exactOptionalPropertyTypes` and `class={active ? 'on' : undefined}`
 *   has to be ordinary code.
 *
 * Intrinsic elements are typed from the DOM lib, so `value`, `disabled` and
 * friends keep their real types and their completions.
 */

type EventHandler<E extends Element, Ev extends Event> = (
  event: Ev & { currentTarget: E; target: Element },
) => void;

type StyleValue = string | Record<string, string | number | null | undefined>;
type ClassValue = string | Record<string, unknown>;

/** A value, or a thunk producing it (runtime JSX), or absent. */
type Attribute<T> = T | (() => T) | undefined;

/** Like `Partial<T>`, but explicit `undefined` is allowed and thunks are too. */
type OptionalAttributes<T> = { [K in keyof T]?: Attribute<T[K]> };

interface FirsthandAttributes<E extends Element> {
  /**
   * Consumed by the keyed list part; it never reaches a component as a prop.
   *
   * Declared here as well as in `JSX.IntrinsicAttributes` because TypeScript
   * only consults the latter for value-based elements.
   */
  key?: string | number | bigint | undefined;
  class?: Attribute<ClassValue>;
  className?: Attribute<ClassValue>;
  style?: Attribute<StyleValue>;
  id?: Attribute<string>;
  title?: Attribute<string>;
  role?: Attribute<string>;
  tabindex?: Attribute<number | string>;
  hidden?: Attribute<boolean>;
  /** Receives the element once it exists. */
  ref?: ((element: E) => void) | undefined;
  children?: unknown;
  onClick?: EventHandler<E, MouseEvent> | undefined;
  onDblClick?: EventHandler<E, MouseEvent> | undefined;
  onInput?: EventHandler<E, InputEvent> | undefined;
  onChange?: EventHandler<E, Event> | undefined;
  onSubmit?: EventHandler<E, SubmitEvent> | undefined;
  onKeyDown?: EventHandler<E, KeyboardEvent> | undefined;
  onKeyUp?: EventHandler<E, KeyboardEvent> | undefined;
  onFocusIn?: EventHandler<E, FocusEvent> | undefined;
  onFocusOut?: EventHandler<E, FocusEvent> | undefined;
  onPointerDown?: EventHandler<E, PointerEvent> | undefined;
  onPointerUp?: EventHandler<E, PointerEvent> | undefined;
  onMouseOver?: EventHandler<E, MouseEvent> | undefined;
  onMouseOut?: EventHandler<E, MouseEvent> | undefined;
}

/** DOM properties of the element that Firsthand does not already describe. */
type DomAttributes<E extends Element> = OptionalAttributes<
  Omit<E, keyof FirsthandAttributes<E> | 'style' | 'children' | keyof Node | keyof Element>
>;

type Escapes = {
  [key: `prop:${string}`]: unknown;
  [key: `attr:${string}`]: unknown;
  [key: `on${string}:${string}`]: (event: Event) => void;
  [key: `data-${string}`]: Attribute<string | number | boolean | null>;
  [key: `aria-${string}`]: Attribute<string | number | boolean | null>;
};

declare global {
  namespace JSX {
    /**
     * What a component or a dynamic expression may produce. Aliased to the
     * runtime's own `View`, so TSX and the runtime agree by construction.
     */
    type Element = import('@firsthandjs/dom').View;

    /**
     * Element types from another framework.
     *
     * Empty here, and deliberately an interface: a package that teaches Firsthand
     * to render something it does not own — `@firsthandjs/react/auto`, say — adds
     * its own key by declaration merging, and only a project that imports that
     * package sees it. `keyof` an empty interface is `never`, so this
     * contributes nothing until somebody opts in, and no framework is named in
     * this file.
     */
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface ForeignElementTypes {}

    /**
     * What TSX accepts as an element type.
     *
     * Declared rather than left to TypeScript's default so that the foreign
     * types above can be part of it.
     */
    type ElementType =
      | keyof IntrinsicElements
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | ((props: any) => Element)
      | ForeignElementTypes[keyof ForeignElementTypes];

    /** Available on every element, including components. Consumed by the list part. */
    interface IntrinsicAttributes {
      key?: string | number | bigint | undefined;
    }

    interface ElementChildrenAttribute {
      children: unknown;
    }

    type IntrinsicElements = {
      [K in keyof HTMLElementTagNameMap]: FirsthandAttributes<HTMLElementTagNameMap[K]> &
        DomAttributes<HTMLElementTagNameMap[K]> &
        Escapes;
    } & {
      [K in keyof SVGElementTagNameMap]: FirsthandAttributes<SVGElementTagNameMap[K]> & Escapes;
    } & {
      /** Custom elements, including the ones `defineElement` registers. */
      [tag: `${string}-${string}`]: FirsthandAttributes<HTMLElement> & Escapes;
    };
  }
}
