/**
 * A host element, for a server render: the static chunks and the values
 * between them.
 *
 * The structure has to be the structure the browser would have built, node for
 * node, or hydration walks into the wrong place. Every decision here mirrors
 * one in `template.ts`.
 */

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

import {
  BOOLEAN_PROPERTIES,
  DOM_PROPERTIES,
  VOID_ELEMENTS,
  escapeAttribute,
  escapeText,
  isEventName,
} from './html.js';

import {
  attributeName,
  attributeValue,
  isStaticValue,
  planChildren,
  staticLiteral,
  type ChildEntry,
} from './nodes.js';

import { runtime, type State } from './state.js';

/** What a server-rendered element is built from. */
type Markup = {
  /** The static chunks. Always one more than there are values. */
  parts: string[];
  values: t.Expression[];
};

function pushText(markup: Markup, text: string): void {
  // There is always a last part: the list starts with one and every hole adds
  // another after it.
  markup.parts[markup.parts.length - 1] = (markup.parts[markup.parts.length - 1] as string) + text;
}

function pushHole(markup: Markup, value: t.Expression): void {
  markup.values.push(value);
  markup.parts.push('');
}

/**
 * Compiles an element to the markup a server sends.
 *
 * The structure has to be **the same structure** the browser would have built,
 * node for node, or hydration walks into the wrong place: the client navigates
 * a template by `firstChild` and `nextSibling`, and a comment the server left
 * out is a step the client takes anyway. So the decisions here mirror
 * `emitChildren` exactly, including the marker comment after a dynamic child
 * that is not the last one.
 *
 * That mirroring is a promise between two files, which is the kind of promise
 * that rots. It is held by `packages/server/test/parity.test.tsx`, which
 * renders every shape both ways and compares what comes out.
 */
export function compileMarkup(path: NodePath<t.JSXElement>, state: State): t.Expression {
  const markup: Markup = { parts: [''], values: [] };
  emitMarkupElement(path.node, markup, state);
  if (markup.values.length === 0) {
    // Nothing dynamic: one string, made once, at module scope.
    return t.callExpression(runtime(state, 'ssr'), [
      t.arrayExpression([t.stringLiteral(markup.parts[0] as string)]),
    ]);
  }
  return t.callExpression(runtime(state, 'ssr'), [
    t.arrayExpression(markup.parts.map((part) => t.stringLiteral(part))),
    ...markup.values,
  ]);
}

function emitMarkupElement(node: t.JSXElement, markup: Markup, state: State): void {
  const name = node.openingElement.name;
  if (!t.isJSXIdentifier(name)) {
    const namespaced = name as t.JSXNamespacedName;
    throw new Error(
      `Namespaced element names are not supported: <${namespaced.namespace.name}:` +
        `${namespaced.name.name}>. Write the element without a ` +
        'namespace; SVG children are resolved by the parser.',
    );
  }
  const tag = name.name;
  pushText(markup, `<${tag}`);
  for (const attribute of node.openingElement.attributes) {
    emitMarkupAttribute(attribute, markup, state);
  }
  pushText(markup, '>');
  emitMarkupChildren(node.children, markup, state);
  if (!VOID_ELEMENTS.has(tag)) {
    pushText(markup, `</${tag}>`);
  }
}

function emitMarkupAttribute(
  attribute: t.JSXAttribute | t.JSXSpreadAttribute,
  markup: Markup,
  state: State,
): void {
  if (t.isJSXSpreadAttribute(attribute)) {
    pushHole(markup, t.callExpression(runtime(state, 'spread'), [attribute.argument]));
    return;
  }

  const name = attributeName(attribute);
  const value = attributeValue(attribute);

  // A ref wants a node and a handler wants a click. Neither exists yet; both
  // are attached when the client takes over.
  if (name === 'ref' || isEventName(name)) {
    return;
  }

  // `key` is an instruction to the reconciler, not an attribute. The DOM path
  // consumes it in `rewriteKeyedMaps`, which a server render does not run —
  // there is one render and nothing to reconcile — so it is dropped here.
  if (name === 'key') {
    return;
  }

  if (value === null) {
    pushText(markup, ` ${name}=""`);
    return;
  }

  if (isStaticValue(value)) {
    const literal = staticLiteral(value);
    if (literal !== null) {
      pushText(markup, ` ${name}="${escapeAttribute(literal)}"`);
    }
    return;
  }

  pushHole(markup, markupAttributeCall(name, value, state));
}

/** The server twin of `dynamicAttributeCall`, kind for kind. */
function markupAttributeCall(name: string, value: t.Expression, state: State): t.Expression {
  if (name.startsWith('prop:')) {
    return t.callExpression(runtime(state, 'setProperty'), [t.stringLiteral(name.slice(5)), value]);
  }
  if (name.startsWith('attr:')) {
    return t.callExpression(runtime(state, 'setAttribute'), [
      t.stringLiteral(name.slice(5)),
      value,
    ]);
  }
  if (name === 'class' || name === 'className') {
    return t.callExpression(runtime(state, 'setClass'), [value]);
  }
  if (name === 'style') {
    return t.callExpression(runtime(state, 'setStyle'), [value]);
  }
  if (BOOLEAN_PROPERTIES.has(name)) {
    return t.callExpression(runtime(state, 'setBoolean'), [t.stringLiteral(name), value]);
  }
  if (DOM_PROPERTIES.has(name)) {
    return t.callExpression(runtime(state, 'setProperty'), [t.stringLiteral(name), value]);
  }
  return t.callExpression(runtime(state, 'setAttribute'), [t.stringLiteral(name), value]);
}

function emitMarkupChildren(
  children: t.JSXElement['children'],
  markup: Markup,
  state: State,
): void {
  const entries = planChildren(children);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as ChildEntry;
    if (entry.kind === 'text') {
      pushText(markup, escapeText(entry.text as string));
      continue;
    }
    if (entry.kind === 'element') {
      emitMarkupElement(entry.element as t.JSXElement, markup, state);
      continue;
    }
    // Where a dynamic child starts cannot always be read off the markup — its
    // content has a length the template does not — so the server says so with
    // `<!--[-->`, which the client removes once it has adopted the region.
    //
    // Except when the child is the whole of its element's content. Then the
    // region is the element's children, which the client can see for itself,
    // and the marker would be a comment in every `<td>` on the page for
    // nothing. It has to be the *whole* content and not merely the first of
    // it: a template with something after the child has a marker there, and
    // the client walks to that marker by stepping over this region — which it
    // can only do if it can see where the region begins.
    //
    // The closing side is the marker the browser's own template has here; a
    // child that is last has none, and the element's end is where it stops.
    if (entries.length > 1) {
      pushText(markup, '<!--[-->');
    }
    pushHole(markup, t.callExpression(runtime(state, 'child'), [entry.expression as t.Expression]));
    if (i !== entries.length - 1) {
      pushText(markup, '<!---->');
    }
  }
}
