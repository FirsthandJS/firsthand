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

/**
 * Marks a child thunk that is written again on every run (#47).
 *
 * A thunk is the compiler's own wrapper, so it is never a scope the author
 * wrote — but it is not always a place a run reaches either. In a kept
 * template the part around it is made on the first run and never again, and
 * what is inside it belongs to that part. In a fragment a run returns, the
 * array and every part in it are built afresh each time, so the thunk *is*
 * reached on every run and the markup in it belongs to the run rather than to
 * the wrapper.
 *
 * Only the second kind carries this mark, and only `enclosingRun` reads it.
 */
export const THROUGH_RUN = Symbol('firsthand.throughRun');

/**
 * Marks the thunk inside a compiled child, if it has one.
 *
 * Takes the child a `compileChildren` produced — `part(() => …)`, `part(list)`
 * or a plain string — and finds the thunk to mark, because a keyed list has no
 * thunk to see through and a static child has nothing in it to keep. An arrow
 * in that position is always the thunk: `compileChildren` puts nothing else
 * there.
 */
export function throughRun(child: t.Expression): void {
  if (!t.isCallExpression(child)) {
    return;
  }
  const [argument] = child.arguments;
  if (t.isArrowFunctionExpression(argument)) {
    (argument as unknown as Record<symbol, boolean>)[THROUGH_RUN] = true;
  }
}

/**
 * Marks the expression `keptChild` produces: a child a run keeps.
 *
 * It is a `part` already, so the thunk `compileChildren` puts around a dynamic
 * child is one wrapper too many — and not merely wasteful. The wrapper defers
 * the site lookup until after `ran` has ended the run that made it, which
 * stamps the site with the *next* run's generation and makes a branch the run
 * has left look like one it just reached. `hoistKept` takes the wrapper off.
 */
export const KEPT = Symbol('firsthand.kept');

export function kept(expression: t.Expression): t.Expression {
  (expression as unknown as Record<symbol, boolean>)[KEPT] = true;
  return expression;
}

/** Marks a call the map rewrite produced, so it is not wrapped in a thunk. */
export const LIST_CALL = Symbol('firsthand.list');

/** Whether an expression is the keyed-list call `rewriteKeyedMaps` produced. */
export function isKeyedList(node: t.Node): boolean {
  return t.isCallExpression(node) && LIST_CALL in node;
}
