/**
 * The marks the compiler leaves on nodes it wrote.
 *
 * Three symbols and the predicates that read them. A symbol rather than a
 * property name because these travel on Babel nodes, which are shared with
 * every other plugin in the pipeline: a name could collide, and a mark that
 * collided would silently change what the compiler decides about a node.
 */

import * as t from '@babel/types';

/**
 * Marks an arrow the compiler wrote for a child slot.
 *
 * Whatever sits directly in one is already inside a reactive scope, so a view
 * function there can be called where it stands instead of being wrapped in a
 * part of its own.
 */
export const CHILD_THUNK = Symbol('firsthand.childThunk');

/**
 * Marks a wrapper the compiler wrote, which is not a scope of anyone's.
 *
 * A template compiles to an immediately invoked arrow, and that arrow is a
 * function — so walking up from markup inside it would stop there and lose the
 * run it belongs to. It is machinery, not a boundary, and is walked through.
 */
export const GENERATED = Symbol('firsthand.generated');

export function generated(arrow: t.ArrowFunctionExpression): t.ArrowFunctionExpression {
  (arrow as unknown as Record<symbol, boolean>)[GENERATED] = true;
  return arrow;
}

/** Marks a call the map rewrite produced, so it is not wrapped in a thunk. */
export const LIST_CALL = Symbol('firsthand.list');

/** Whether an expression is the keyed-list call `rewriteKeyedMaps` produced. */
export function isKeyedList(node: t.Node): boolean {
  return t.isCallExpression(node) && LIST_CALL in node;
}
