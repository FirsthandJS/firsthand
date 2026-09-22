/**
 * Source positions, for the debugger rather than for the compiler.
 *
 * None of this changes what the emitted code does. It decides which line a
 * breakpoint can be set on and which column a debugger draws a marker in,
 * which is the difference between a source map that is technically correct
 * and one somebody can work in. The reasoning is in the comments below,
 * because every one of these was arrived at by watching a debugger get it
 * wrong.
 */

import * as t from '@babel/types';

import { CHILD_THUNK } from './marks.js';

/**
 * Wraps an expression so a part can re-read it, and gives the wrapper its
 * position.
 *
 * The position moves from the expression to the thunk rather than being copied
 * to both. A debugger draws one marker per distinct original column on a line,
 * and an expression that kept its own position produced two — one where it
 * begins and one where it ends — which look identical and do the same thing.
 * With the wrapper owning the position, every breakable place inside it
 * reports the same column: one marker, on the expression, hit on the first
 * evaluation and on every later one.
 */
export function thunk(expression: t.Expression): t.ArrowFunctionExpression {
  const arrow = t.arrowFunctionExpression([], expression);
  (arrow as unknown as Record<symbol, boolean>)[CHILD_THUNK] = true;
  takePosition(arrow, expression);
  return arrow;
}

/**
 * Moves an expression's position onto the thing the compiler wrapped it in.
 *
 * A point rather than a range. The generator maps both ends of a node, and an
 * end one column along is a second marker that looks identical to the first
 * and does the same thing. A wrapper the compiler invented does not span
 * anything in the source anyway — it belongs where the expression begins.
 *
 * It matters for more than tidiness: a debugger offers a breakpoint on a line
 * only where a *statement* is mapped to it. An expression buried in a getter
 * the compiler wrote has no statement of its own, and the line it came from
 * cannot be stopped on at all until one carries its position.
 */
export function takePosition(target: t.Node, expression: t.Expression): void {
  const loc = expression.loc;
  if (loc !== null && loc !== undefined) {
    target.loc = { ...loc, end: loc.start };
    expression.loc = null;
  }
}

export function expressionStatement(expression: t.Expression): t.Statement {
  return located(t.expressionStatement(expression), expression);
}

/**
 * Gives a node the compiler built the position of the code it stands for.
 *
 * Without this the generated statement has no position at all, so the source
 * map has nothing to say about it — and a debugger cannot put a breakpoint on
 * a line it cannot find. `{v}` becoming `_$insert(el, () => props.v)` is the
 * case that matters: that call *is* the expression, and should be reachable
 * where the expression was written.
 */
export function located<T extends t.Node>(node: T, source: t.Node | null | undefined): T {
  if (source == null || source.loc == null) {
    // Generated from something generated: there is no original position to
    // pass on, and inventing one would point a debugger at the wrong line.
    return node;
  }
  // `loc` alone: the generator maps from it, and copying `start`/`end` as well
  // would mean two more assignments and two fallbacks that cannot be reached.
  node.loc = source.loc;
  return node;
}
