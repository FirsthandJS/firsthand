/**
 * A write a run performs, guarded by what it last put there.
 *
 * Its own module because two callers need it and neither should import the
 * other: an attribute is written this way, and so is a child.
 */

import * as t from '@babel/types';

import { expressionStatement } from './positions.js';

import { pushEach, runtime, type Build, type RunContext, type State } from './state.js';

/**
 * A write the run performs, guarded by what it last put there.
 *
 * ```js
 * const _w$1 = _$site(_store, 3), _x$1 = u.kind;
 * if (_w$1.last !== _x$1) { _w$1.last = _x$1; _$applyProp(_el$, "class", _x$1); }
 * ```
 *
 * The comparison is against a remembered value rather than against the DOM:
 * reading an attribute or a text node back costs more than writing it, which
 * is the one thing measuring this changed my mind about.
 */
export function guardedWrite(
  build: Build,
  state: State,
  value: t.Expression,
  write: (held: t.Identifier) => t.Expression,
): void {
  const run = build.run as RunContext;
  const slot = build.name('_w$');
  const held = build.name('_x$');
  const last = (): t.MemberExpression =>
    t.memberExpression(t.cloneNode(slot), t.identifier('last'));
  pushEach(
    build,
    t.variableDeclaration('const', [
      t.variableDeclarator(
        slot,
        t.callExpression(runtime(state, 'site'), [
          t.cloneNode(run.store),
          t.numericLiteral(run.next()),
        ]),
      ),
      t.variableDeclarator(held, value),
    ]),
  );
  pushEach(
    build,
    t.ifStatement(
      t.binaryExpression('!==', last(), t.cloneNode(held)),
      t.blockStatement([
        expressionStatement(t.assignmentExpression('=', last(), t.cloneNode(held))),
        expressionStatement(t.callExpression(runtime(state, 'wrote'), [t.cloneNode(run.store)])),
        expressionStatement(write(t.cloneNode(held))),
      ]),
    ),
  );
}
