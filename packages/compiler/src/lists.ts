/**
 * `items.map(row => <Row key={row.id} />)` becomes a keyed list part.
 *
 * A rewrite rather than a compilation: what comes out is still JSX, and the
 * passes after this one compile it without knowing a list was involved. The
 * mark `LIST_CALL` is how they find out where it matters.
 */

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

import { LIST_CALL } from './marks.js';

import { runtime, type State } from './state.js';

/**
 * Rewrites `items.map(item => <Row key={item.id} .../>)` into a keyed list part.
 *
 * The callback's item parameter becomes a reactive cell and every reference to
 * it becomes a live read, so a row whose data changes updates in place instead
 * of being re-created. The key expression is extracted first, because it is
 * computed from the raw item, once per reconcile.
 *
 * A `.map()` without a `key` stays an ordinary array child: it is reconciled by
 * node identity, which for freshly created nodes means "replace". That is the
 * documented cost of leaving the key out.
 */
export function rewriteKeyedMaps(path: NodePath<t.JSXElement | t.JSXFragment>, state: State): void {
  path.traverse({
    CallExpression(call: NodePath<t.CallExpression>) {
      const keyed = keyedMap(call);
      if (keyed !== null) {
        rewriteOne(call, keyed, state);
      }
    },
  });
}

/** A `.map` whose callback returns keyed markup, in a position that takes one. */
type KeyedMap = {
  /** What is being mapped over, as written. */
  source: t.Expression;
  callback: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>;
  item: t.Identifier;
  /** The callback's second parameter, when it declared one. */
  index: t.Identifier | undefined;
  root: KeyedRoot;
};

/**
 * Whether a call is the shape this rewrite applies to, and its parts if it is.
 *
 * Every refusal here leaves an ordinary array child, which is correct and
 * merely slower — so each one can be read as "not worth the machinery" rather
 * than as an error.
 */
function keyedMap(call: NodePath<t.CallExpression>): KeyedMap | null {
  if (!isChildPosition(call)) {
    return null;
  }
  const callee = call.node.callee;
  if (
    !t.isMemberExpression(callee) ||
    callee.computed ||
    !t.isIdentifier(callee.property, { name: 'map' }) ||
    call.node.arguments.length !== 1
  ) {
    return null;
  }
  const callback = call.get('arguments.0') as NodePath;
  if (!callback.isArrowFunctionExpression() && !callback.isFunctionExpression()) {
    return null;
  }
  const [item, index] = callback.node.params;
  if (!t.isIdentifier(item) || (index !== undefined && !t.isIdentifier(index))) {
    return null;
  }
  const root = keyedRoot(callback);
  if (root === null) {
    return null;
  }
  return { source: callee.object as t.Expression, callback, item, index, root };
}

/**
 * Turns one such call into `list(source, key, row)`.
 *
 * The key expression is taken from the raw item before the parameters become
 * cells, because the key is computed once per reconcile from the value itself
 * — not from the cell the row will read.
 */
function rewriteOne(call: NodePath<t.CallExpression>, keyed: KeyedMap, state: State): void {
  const { callback, item, index, root } = keyed;
  const keyExpression = t.cloneNode(root.key);
  root.element.openingElement.attributes = root.element.openingElement.attributes.filter(
    (attribute) => attribute !== root.attribute,
  );

  const itemCell = callback.scope.generateUidIdentifier('item');
  const indexCell = callback.scope.generateUidIdentifier('index');
  callback.scope.crawl();
  liveRead(callback, item.name, itemCell);
  if (index !== undefined) {
    liveRead(callback, index.name, indexCell);
  }
  callback.node.params = [itemCell, indexCell];

  const listCall = t.callExpression(runtime(state, 'list'), [
    t.arrowFunctionExpression([], keyed.source),
    t.arrowFunctionExpression(
      [t.cloneNode(item), index ?? callback.scope.generateUidIdentifier('i')],
      keyExpression,
    ),
    callback.node,
  ]);
  (listCall as unknown as Record<symbol, boolean>)[LIST_CALL] = true;
  call.replaceWith(listCall);
  call.skip();
}

/**
 * Whether a call's value flows directly into a JSX child slot.
 *
 * Directly inside the container is the common case, but `{cond ? a.map(...) :
 * b.map(...)}` and `{cond && rows.map(...)}` are child positions too, and they
 * are what people actually write. Only checking the immediate parent meant a
 * keyed list inside a conditional silently stayed an unkeyed array — which then
 * made the conditional depend on the list's data and rebuild every row on every
 * change.
 *
 * The walk is deliberately narrow. A list part is a *thunk*, not an array, so
 * rewriting `{wrap(rows.map(...))}` would hand `wrap` something it cannot use.
 * Only the branches of conditionals and the right-hand side of logical
 * operators are traversed: those positions hand their value straight to the
 * child slot.
 */
function isChildPosition(call: NodePath<t.CallExpression>): boolean {
  let child: NodePath = call;
  // The traversal that reaches this function only visits nodes inside a JSX
  // element, so the walk always terminates at a container or at a node that is
  // not a pass-through.
  let parent = child.parentPath as NodePath;
  while (!parent.isJSXExpressionContainer()) {
    const key = child.key;
    const throughConditional =
      parent.isConditionalExpression() && (key === 'consequent' || key === 'alternate');
    const throughLogical = parent.isLogicalExpression() && key === 'right';
    if (!throughConditional && !throughLogical) {
      return false;
    }
    child = parent;
    parent = parent.parentPath;
  }
  const holder = parent.parentPath;
  return holder.isJSXElement() || holder.isJSXFragment();
}

type KeyedRoot = {
  element: t.JSXElement;
  attribute: t.JSXAttribute;
  key: t.Expression;
};

/** Finds the `key` attribute on the JSX element a map callback returns. */
function keyedRoot(
  callback: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
): KeyedRoot | null {
  const body = callback.node.body;
  let element: t.Node | null = null;
  if (t.isJSXElement(body)) {
    element = body;
  } else if (t.isBlockStatement(body)) {
    const last = body.body[body.body.length - 1];
    if (t.isReturnStatement(last) && t.isJSXElement(last.argument)) {
      element = last.argument;
    }
  }
  if (element === null || !t.isJSXElement(element)) {
    return null;
  }
  for (const attribute of element.openingElement.attributes) {
    if (
      t.isJSXAttribute(attribute) &&
      t.isJSXIdentifier(attribute.name, { name: 'key' }) &&
      t.isJSXExpressionContainer(attribute.value)
    ) {
      return { element, attribute, key: attribute.value.expression as t.Expression };
    }
  }
  return null;
}

/** Turns every reference to `name` inside `scopePath` into `cell.value`. */
function liveRead(scopePath: NodePath, name: string, cell: t.Identifier): void {
  // A parameter always has a binding in its own function scope.
  const binding = scopePath.scope.getBinding(name) as { referencePaths: NodePath[] };
  for (const reference of binding.referencePaths) {
    reference.replaceWith(t.memberExpression(t.cloneNode(cell), t.identifier('value')));
  }
}
