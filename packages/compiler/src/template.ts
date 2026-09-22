/**
 * A host element, for the browser: one `<template>` per shape, plus the parts
 * that write into a clone of it (ADR-0009).
 */

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

import { VOID_ELEMENTS, escapeText } from './html.js';

import { emitAttribute } from './attributes.js';

import { generated } from './marks.js';

import { planChildren, type ChildEntry } from './nodes.js';

import { attributeName, attributeValue, canInlineAttribute, isStaticValue } from './nodes.js';

import { expressionStatement, thunk } from './positions.js';

import { canRetain, dependsOnRun, enclosingRun } from './runs.js';

import {
  pushEach,
  pushOnce,
  runtime,
  type Build,
  type Host,
  type RunContext,
  type State,
} from './state.js';

export function compileTemplate(path: NodePath<t.JSXElement>, state: State): t.Expression {
  const build = newBuild(path, state);
  const root = t.identifier('_el$');
  emitElement(path.node, build, root, state);
  const templateId = registerTemplate(build, state);
  // `build.run` is set exactly when the site is kept.
  const body =
    build.run === null
      ? freshForm(root, templateId, build)
      : keptForm(root, templateId, build, state);
  return t.callExpression(generated(t.arrowFunctionExpression([], t.blockStatement(body))), []);
}

/**
 * The lists a template is emitted into, and whether it will be kept.
 *
 * A site is kept between runs when everything the run has to put into it is
 * something this compiler can write. Decided before anything is emitted, so
 * that what is emitted is all of one kind: where a site is built once, `once`
 * and `each` are separate lists; where it is not, all three are the same one
 * and everything simply happens in the order it was written.
 */
function newBuild(path: NodePath<t.JSXElement>, state: State): Build {
  let names = 0;
  const statements: t.Statement[] = [];
  const build: Build = {
    html: [],
    statements,
    once: statements,
    each: statements,
    run: null,
    at: path,
    next: (() => {
      let n = 0;
      return () => t.identifier(`_el$${String(++n)}`);
    })(),
    name: (prefix: string) => t.identifier(`${prefix}${String(++names)}`),
  };
  const run = enclosingRun(path, state);
  if (run !== null) {
    // Set before the question is asked, not after it is answered: `canRetain`
    // decides by asking whether values belong to *this* run, and with no run in
    // the build the answer is always "no" and every site looks retainable.
    build.run = run;
    if (canRetain(path.node, build)) {
      build.once = [];
      build.each = [];
    } else {
      build.run = null;
    }
  }
  return build;
}

/** Declares the template at module scope and hands back the name to clone. */
function registerTemplate(build: Build, state: State): t.Identifier {
  const templateId = t.identifier(`_tmpl$${String(++state.firsthand.counter)}`);
  state.firsthand.templates.push(
    t.variableDeclarator(
      templateId,
      t.addComment(
        t.callExpression(runtime(state, 'template'), [t.stringLiteral(build.html.join(''))]),
        'leading',
        '#__PURE__',
      ),
    ),
  );
  return templateId;
}

/** Built every time it is reached: clone, fill, hand back. */
function freshForm(root: t.Identifier, templateId: t.Identifier, build: Build): t.Statement[] {
  return [
    t.variableDeclaration('const', [
      t.variableDeclarator(root, t.callExpression(t.cloneNode(templateId), [])),
    ]),
    ...build.statements,
    t.returnStatement(t.cloneNode(root)),
  ];
}

/**
 * Built once: the node and everything made with it exist for the life of the
 * instance, and each run walks back to them and writes what has changed.
 */
function keptForm(
  root: t.Identifier,
  templateId: t.Identifier,
  build: Build,
  state: State,
): t.Statement[] {
  const kept: Kept = {
    root,
    templateId,
    slot: build.name('_site$'),
    fresh: build.name('_new$'),
    held: build.name('_own$'),
    owner: build.run as RunContext,
  };
  return [
    ...keptPrologue(kept, state),
    ...build.statements,
    t.ifStatement(
      t.cloneNode(kept.fresh),
      t.blockStatement([
        ...build.once,
        expressionStatement(t.callExpression(runtime(state, 'close'), [t.cloneNode(kept.held)])),
      ]),
    ),
    ...build.each,
    t.returnStatement(t.cloneNode(kept.root)),
  ];
}

/** The names a kept site needs, and the run that owns it. */
type Kept = {
  root: t.Identifier;
  templateId: t.Identifier;
  /** The store slot the node is remembered in. */
  slot: t.Identifier;
  /** Whether this run is the one that made it. */
  fresh: t.Identifier;
  /** The scope what the site makes belongs to. */
  held: t.Identifier;
  owner: RunContext;
};

/** Finds the site, and makes it if this is the run that gets to. */
function keptPrologue(kept: Kept, state: State): t.Statement[] {
  const { root, slot, fresh, held, owner, templateId } = kept;
  return [
    t.variableDeclaration('const', [
      t.variableDeclarator(
        slot,
        t.callExpression(runtime(state, 'site'), [
          t.cloneNode(owner.store),
          t.numericLiteral(owner.next()),
        ]),
      ),
    ]),
    t.variableDeclaration('let', [
      t.variableDeclarator(root, t.memberExpression(t.cloneNode(slot), t.identifier('node'))),
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        fresh,
        t.binaryExpression('===', t.cloneNode(root), t.identifier('undefined')),
      ),
    ]),
    t.variableDeclaration('let', [t.variableDeclarator(held)]),
    t.ifStatement(
      t.cloneNode(fresh),
      t.blockStatement([
        // What this site makes belongs to the instance. A run's own scope is
        // cleared before it runs again, and a part left there would be disposed
        // by the very next run.
        expressionStatement(
          t.assignmentExpression(
            '=',
            t.cloneNode(held),
            t.callExpression(runtime(state, 'open'), [t.cloneNode(owner.store), t.cloneNode(slot)]),
          ),
        ),
        expressionStatement(
          t.assignmentExpression(
            '=',
            t.cloneNode(root),
            t.assignmentExpression(
              '=',
              t.memberExpression(t.cloneNode(slot), t.identifier('node')),
              t.callExpression(t.cloneNode(templateId), []),
            ),
          ),
        ),
      ]),
    ),
  ];
}

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
    entry.kind === 'list' ? expression : thunk(expression),
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
