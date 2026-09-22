/**
 * A host element: the markup that goes into the `<template>`, and the parts
 * that write into a clone of it (ADR-0009).
 *
 * Where that clone lives between runs — built every time, or built once and
 * written into — is `site.ts`.
 */

import * as t from '@babel/types';

import { VOID_ELEMENTS, escapeText } from './html.js';

import { emitAttribute } from './attributes.js';

import {
  attributeName,
  attributeValue,
  canInlineAttribute,
  isStaticValue,
  planChildren,
  type ChildEntry,
} from './nodes.js';

import { expressionStatement, thunk } from './positions.js';

import { dependsOnRun } from './runs.js';

import {
  pushEach,
  pushOnce,
  runtime,
  type Build,
  type Host,
  type RunContext,
  type State,
} from './state.js';

export function emitElement(
  node: t.JSXElement,
  build: Build,
  self: t.Identifier,
  state: State,
): void {
  const name = node.openingElement.name;
  if (!t.isJSXIdentifier(name)) {
    // A member-expression tag is always a component, so only a namespaced name
    // can reach this point.
    const namespaced = name as t.JSXNamespacedName;
    throw new Error(
      `Namespaced element names are not supported: <${namespaced.namespace.name}:` +
        `${namespaced.name.name}>. Write the element without a ` +
        'namespace; SVG children are resolved by the parser.',
    );
  }
  const tag = name.name;
  build.html.push(`<${tag}`);
  const host: Host = { build, self, state, deferred: [], tag };
  for (const attribute of node.openingElement.attributes) {
    emitAttribute(attribute, host);
  }
  build.html.push('>');
  // Now the node exists, so the work that needed it can happen.
  for (const emit of host.deferred) {
    emit();
  }
  emitChildren(node.children, host);
  if (!VOID_ELEMENTS.has(tag)) {
    build.html.push(`</${tag}>`);
  }
}

function emitChildren(children: t.JSXElement['children'], host: Host): void {
  const entries = planChildren(children);
  const cursor: Cursor = { previous: null, previousIndex: 0, index: 0 };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as ChildEntry;
    if (entry.kind === 'text') {
      host.build.html.push(escapeText(entry.text as string));
    } else if (entry.kind === 'element') {
      const element = entry.element as t.JSXElement;
      // An element with nothing dynamic in it needs no variable, so it is
      // emitted against a name nothing will ever read.
      const self = needsReference(element) ? reference(cursor, host) : t.identifier('_unused$');
      emitElement(element, host.build, self, host.state);
    } else {
      emitChildPart(entry, i === entries.length - 1, cursor, host);
    }
    cursor.index++;
  }
}

/** How far through an element's children the walk has got. */
type Cursor = {
  /** The last child that was given a name, if any. */
  previous: t.Identifier | null;
  previousIndex: number;
  index: number;
};

/** Names the child the cursor is on, so a part can be bound to it. */
function reference(cursor: Cursor, host: Host): t.Identifier {
  const id = host.build.next();
  host.build.statements.push(
    t.variableDeclaration('const', [t.variableDeclarator(id, navigate(cursor, host))]),
  );
  cursor.previous = id;
  cursor.previousIndex = cursor.index;
  return id;
}

/**
 * A dynamic child: written by the run that owns it, or given a part of its own.
 *
 * A child that is not last gets a marker comment after it, because its content
 * has a length the template does not — the next part has to be able to find
 * where it begins. The last one needs none: the element's end is where it stops.
 */
function emitChildPart(entry: ChildEntry, isLast: boolean, cursor: Cursor, host: Host): void {
  const { build, self, state } = host;
  const expression = entry.expression as t.Expression;
  let marker: t.Expression | null = null;
  if (!isLast) {
    build.html.push('<!>');
    marker = t.cloneNode(reference(cursor, host));
  }
  if (entry.kind !== 'list' && dependsOnRun(expression, build.run, build.at)) {
    // Written by the run, into the place it wrote last time.
    const run = build.run as RunContext;
    pushEach(
      build,
      expressionStatement(
        t.callExpression(runtime(state, 'writeChild'), [
          t.cloneNode(run.store),
          t.numericLiteral(run.next()),
          t.cloneNode(self),
          marker ?? t.nullLiteral(),
          expression,
        ]),
      ),
    );
    return;
  }
  const args: t.Expression[] = [
    t.cloneNode(self),
    // A list part is already a thunk that owns its rows; wrapping it would
    // rebuild the whole list on every evaluation.
    entry.kind === 'list' ? listFedByRun(expression as t.CallExpression, host) : thunk(expression),
  ];
  if (marker !== null) {
    args.push(marker);
  }
  // The call is deliberately left without a position, and only the thunk inside
  // it carries one. Both would map to `{value}`, and a debugger takes the first
  // location on a line — which would be this call, and it runs once, when the
  // part is created. The thunk runs on every update, which is where a
  // breakpoint on that expression is expected to stop.
  pushOnce(build, expressionStatement(t.callExpression(runtime(state, 'insert'), args)));
}

/**
 * A keyed list whose data belongs to the run, made once and fed afterwards.
 *
 * The list is created inside the `if (_new$)` block, so its source thunk would
 * close over the first run's value and never see another. The value goes
 * through a cell instead — declared where the navigation is, so it is written
 * on every run — and the list reads the cell. Writing a cell wakes exactly what
 * read it, so a run that produces the same data reconciles nothing.
 *
 * Left alone when the data is not the run's: then the source thunk is already
 * live, and a cell would be a signal in the way of a read.
 */
function listFedByRun(call: t.CallExpression, host: Host): t.Expression {
  const { build, state } = host;
  const source = call.arguments[0];
  if (build.run === null || !t.isExpression(source) || !dependsOnRun(source, build.run, build.at)) {
    return call;
  }
  const run = build.run;
  const holder = build.name('_data$');
  build.statements.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        holder,
        t.callExpression(runtime(state, 'cell'), [
          t.cloneNode(run.store),
          t.numericLiteral(run.next()),
          // What the cell holds is the data itself, not a thunk over it: a
          // list's source is a value, unlike a child, which is a reading that
          // belongs to the part displaying it (ADR-0026).
          //
          // `rewriteKeyedMaps` always writes the source as `() => <data>`, so
          // the body is the data and there is no other shape to answer for.
          (source as t.ArrowFunctionExpression).body as t.Expression,
        ]),
      ),
    ]),
  );
  call.arguments[0] = t.arrowFunctionExpression(
    [],
    t.memberExpression(t.cloneNode(holder), t.identifier('value')),
  );
  return call;
}

/** Whether this element needs a variable: it has parts, or a descendant does. */
function needsReference(element: t.JSXElement): boolean {
  if (element.openingElement.attributes.some(attributeNeedsReference)) {
    return true;
  }
  for (const entry of planChildren(element.children)) {
    if (entry.kind === 'dynamic' || entry.kind === 'list') {
      return true;
    }
    if (entry.kind === 'element' && needsReference(entry.element as t.JSXElement)) {
      return true;
    }
  }
  return false;
}

/** An attribute nothing can inline: a spread, a ref, a listener, a value. */
function attributeNeedsReference(attribute: t.JSXAttribute | t.JSXSpreadAttribute): boolean {
  if (t.isJSXSpreadAttribute(attribute)) {
    return true;
  }
  const name = attributeName(attribute);
  if (name === 'ref' || name.startsWith('on')) {
    return true;
  }
  const value = attributeValue(attribute);
  return value !== null && (!isStaticValue(value) || !canInlineAttribute(name));
}

/**
 * The step from one template node to the next.
 *
 * `.firstChild` and `.nextSibling` in an ordinary build: the template is a
 * clone and nothing has been inserted into it yet, so the shape the compiler
 * planned is the shape that is there.
 *
 * A build that can hydrate goes through `first` and `next` instead, because
 * then the nodes may be a server's and the dynamic children already have
 * content. The helpers step over a whole region in one move. Outside a
 * hydration they are the property reads, behind one comparison — which is why
 * this is an option and not the default: an application that never renders on
 * a server pays nothing for the one that does.
 */
function navigate(cursor: Cursor, host: Host): t.Expression {
  const { self, state } = host;
  const hydratable = state.firsthand.hydratable;
  const first = hydratable ? runtime(state, 'first') : null;
  const next = hydratable ? runtime(state, 'next') : null;
  let expression: t.Expression;
  let steps: number;
  if (cursor.previous === null) {
    expression = hydratable
      ? t.callExpression(first as t.Identifier, [t.cloneNode(self)])
      : t.memberExpression(t.cloneNode(self), t.identifier('firstChild'));
    steps = cursor.index;
  } else {
    expression = t.cloneNode(cursor.previous);
    steps = cursor.index - cursor.previousIndex;
  }
  for (let i = 0; i < steps; i++) {
    expression = hydratable
      ? t.callExpression(next as t.Identifier, [expression])
      : t.memberExpression(expression, t.identifier('nextSibling'));
  }
  return expression;
}
