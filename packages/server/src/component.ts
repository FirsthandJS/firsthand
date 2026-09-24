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
/**
 * A name an attribute may have.
 *
 * The XML-ish grammar a browser accepts from `setAttribute`: a letter, an
 * underscore or a colon, then word characters, dots, colons and dashes. What
 * it excludes is the point — a space opens a second attribute, a quote closes
 * the value, and `>` closes the tag.
 */
const NAME = /^[a-zA-Z_:][\w.:-]*$/u;

/**
 * `on` followed by letters, which is what an event handler content attribute
 * looks like and what an inline script arrives as.
 *
 * A component's own handler never comes through here: `onClick={…}` is a
 * listener the DOM layer attaches and the server has nothing to serialize for
 * it. So refusing this costs nothing that works, and a name a spread cannot
 * distinguish from `onerror` is a name it should not write. An attribute
 * genuinely called `onboarding` has to be spelled `data-onboarding`, which is
 * where a custom attribute belongs anyway.
 */
const HANDLER = /^on/iu;

/** Whether a runtime key may be written as an attribute name at all. */
function writable(name: string): boolean {
  return NAME.test(name) && !HANDLER.test(name);
}

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
    // Everything above this line is a name the framework chose. Below it, the
    // name came from the object being spread, and an application does not
    // always know what is in one — a row from a database, a query string, a
    // JSON body. A value has always been escaped; a name was interpolated as
    // it arrived, and `{'x onmouseover': 'alert(1)'}` was two attributes.
    if (!writable(name)) {
      // Said out loud, always. This is a server, where a warning costs
      // nothing and silence costs somebody an afternoon — and a refused name
      // is usually the first sign that a dictionary reaching the markup is
      // not the dictionary its author thought.
      console.warn(
        `[firsthand] a spread will not write the attribute name ${JSON.stringify(name)}: ` +
          'it is not a name a browser would accept, or it is an event handler. ' +
          'A custom attribute belongs under `data-`.',
      );
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
