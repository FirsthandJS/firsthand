/**
 * Instantiating a component where there is no DOM.
 *
 * The twin of `createComponent` in `@firsthandjs/dom`, and deliberately the
 * same shape: props are frozen and handed over untouched, the setup runs once
 * under its own owner, and what it returns is the view. The only difference is
 * what a view *is* — markup rather than nodes.
 *
 * The symbols are `Symbol.for`, so this recognises a component and a view
 * function without importing the DOM package at all. A server that never
 * touches `@firsthandjs/dom` cannot accidentally reach for a `document`.
 */

import { deferOwner, getOwner, handleError, restoreOwner } from '@firsthandjs/core';
import { attribute } from './html.js';
import { child, Markup } from './markup.js';

const COMPONENT: unique symbol = Symbol.for('firsthand.component') as never;
const VIEW: unique symbol = Symbol.for('firsthand.view') as never;

type Declared = {
  readonly [COMPONENT]?: true;
  readonly [VIEW]?: true;
  readonly setup?: (props: unknown) => unknown;
  readonly name?: string;
  tag?: string | undefined;
  readonly options?: { readonly shadow?: boolean } | undefined;
};

/** Emitted by the compiler for a module-level function it compiled markup into. */
export function view<T>(target: T): T {
  (target as Record<symbol, boolean>)[VIEW] = true;
  return target;
}

export function createComponent(target: Declared, props: unknown): unknown {
  if (target.setup === undefined) {
    if (VIEW in target) {
      // A view function is a reactive scope in the browser. Here there is one
      // run and no reason to defer it.
      return (target as unknown as (props: unknown) => unknown)(props);
    }
    // Named the way the browser names it, so one mistake reads the same
    // wherever it is made.
    const name =
      typeof target === 'function' && (target as { name?: string }).name !== ''
        ? (target as { name?: string }).name
        : 'The value';
    throw new Error(
      `${String(name)} is not a Firsthand component, and a server render has no adapter ` +
        'to hand it to. Declare it with component(), or render it in the browser only.',
    );
  }

  // The component's scope is described rather than created: most components
  // on a server are a function that reads its props and returns markup, and
  // those need no scope at all. The first `provide`, `onCleanup`, `signal` or
  // `catchError` makes one, with the right parent.
  const previous = deferOwner();
  try {
    // Called directly rather than through `untrack`: a server render happens
    // in no effect, so there is nothing tracking for a read to be attributed
    // to, and the closure `untrack` needs is one allocation per component.
    const result = target.setup(props);
    restoreOwner(previous);
    return target.tag === undefined ? result : host(target, result);
  } catch (error) {
    // Asked for here so that the boundary this is reported to is the one
    // above this component, whether or not it ever had a scope of its own.
    const owner = getOwner();
    restoreOwner(previous);
    handleError(error, owner);
    return null;
  }
}

/**
 * A component hosted in a custom element, as the markup for that element.
 *
 * The browser creates the element and mounts into it; the server writes the
 * element and puts the same content inside, so the tree the parser builds is
 * the tree `defineElement` would have. A shadow root is written as a
 * declarative one, which is the only way a server can express it.
 */
function host(target: Declared, content: unknown): Markup {
  const tag = target.tag as string;
  const inner = child(content);
  const body =
    target.options?.shadow === true ? `<template shadowrootmode="open">${inner}</template>` : inner;
  return new Markup(`<${tag}>${body}</${tag}>`);
}

/**
 * `{...props}` as markup.
 *
 * `spread` in the browser applies whatever it is given by the same rules the
 * named attributes follow, so this has to as well — including leaving out the
 * things a server cannot write: handlers, refs and properties with no
 * attribute behind them.
 */
export function spread(values: Record<string, unknown>): string {
  let out = '';
  for (const name in values) {
    if (name === 'ref' || name === 'children' || isHandler(name)) {
      continue;
    }
    const value = values[name];
    if (name === 'class' || name === 'className') {
      out += attribute('class', typeof value === 'string' ? value : classFrom(value));
      continue;
    }
    if (name === 'style' && typeof value === 'object') {
      continue;
    }
    out += attribute(name, value);
  }
  return out;
}

function isHandler(name: string): boolean {
  return name.startsWith('on') && name.length > 2 && /[A-Z:]/.test(name[2] as string);
}

function classFrom(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    const names: string[] = [];
    for (const name in value as Record<string, unknown>) {
      if ((value as Record<string, unknown>)[name] === true) {
        names.push(name);
      }
    }
    return names.join(' ');
  }
  return String(value);
}
