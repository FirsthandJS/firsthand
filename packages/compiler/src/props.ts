/**
 * Destructured props, rewritten into live reads (ADR-0005).
 *
 * The one pass that changes what the author wrote rather than adding to it,
 * and the reasoning for that is under `rewritePropsDestructuring`.
 */

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

import { located } from './positions.js';

import { runtime, type State } from './state.js';

/**
 * Rewrites destructured props into live reads.
 *
 * `component(({ todo }) => ...)` is the shape people want to write, and it is
 * also the shape that silently snapshots: the binding is captured once, at
 * setup, and never changes again. The compiler makes it mean what it looks
 * like instead — every reference to `todo` becomes `props.todo`, which is a
 * live read that subscribes only the part performing it.
 *
 * The rewrite is a rename, not a wrapper: there is no runtime cost, and the
 * emitted code is what a developer would have written by hand. What cannot be
 * rewritten soundly is still an error rather than a guess — assigning to a
 * destructured prop, or an array pattern, which props are not.
 */
export function rewritePropsDestructuring(
  call: NodePath<t.CallExpression>,
  name: string,
  state: State,
): void {
  // `annotateComponent` has already established that the first argument is a
  // function expression.
  const setup = call.get('arguments.0') as NodePath<
    t.ArrowFunctionExpression | t.FunctionExpression
  >;
  const params = setup.get('params') as NodePath[];
  const param = params[0];
  if (param === undefined || param.isIdentifier()) {
    return;
  }
  if (!param.isObjectPattern()) {
    throw call.buildCodeFrameError(
      `${name}: a component's props parameter must be an object pattern or a plain ` +
        'identifier. Props are an object, so an array pattern cannot destructure them.',
    );
  }

  const propsId = setup.scope.generateUidIdentifier('props');
  const collected: Collected = { reads: [], rests: [], call, name };
  collectPattern(param.node, t.cloneNode(propsId), collected);

  // Bindings are collected before the parameter is replaced, because replacing
  // it removes them from the scope.
  setup.scope.crawl();
  const references = referencesOf(setup, propsId, collected);

  param.replaceWith(propsId);

  for (const entry of references) {
    for (const reference of entry.paths) {
      if (entry.access !== propsId) {
        // The position of the identifier being replaced, so `{v}` still points
        // at `{v}` once it has become `props.inner.v`.
        reference.replaceWith(located(t.cloneNode(entry.access), reference.node));
      }
    }
  }

  hoistRests(setup, propsId, collected.rests, state);
}

/** One destructured name, and the expression that reads it from `props`. */
type Read = { local: string; access: t.Expression };

/** One rest element: a name, and the keys the pattern already took. */
type Rest = { local: string; omit: string[] };

/**
 * Where each destructured name is used, refusing any that is assigned to.
 *
 * A rest name keeps its binding rather than becoming an access, which is why
 * it arrives here without one and leaves pointing at `props` itself.
 */
function referencesOf(
  setup: NodePath<t.Function>,
  propsId: t.Identifier,
  collected: Collected,
): { paths: NodePath[]; access: t.Expression }[] {
  const { call, name } = collected;
  const references: { paths: NodePath[]; access: t.Expression }[] = [];
  for (const entry of [...collected.reads, ...collected.rests] as (Read | Rest)[]) {
    const access = 'access' in entry ? entry.access : propsId;
    // A destructured parameter always has a binding in its own function scope.
    const binding = setup.scope.getBinding(entry.local) as {
      constantViolations: unknown[];
      referencePaths: NodePath[];
    };
    if (binding.constantViolations.length > 0) {
      throw call.buildCodeFrameError(
        `${name}: \`${entry.local}\` is destructured from props and then assigned to. Props are ` +
          'readonly; assign to a signal instead.',
      );
    }
    references.push({ paths: binding.referencePaths, access });
  }
  return references;
}

/**
 * A rest element needs an object, so it becomes one statement at the top of the
 * body rather than an expression repeated at every use site.
 */
function hoistRests(
  setup: NodePath<t.ArrowFunctionExpression | t.FunctionExpression>,
  propsId: t.Identifier,
  rests: Rest[],
  state: State,
): void {
  if (rests.length === 0) {
    return;
  }
  if (!setup.get('body').isBlockStatement()) {
    const body = setup.node.body as t.Expression;
    setup.node.body = t.blockStatement([t.returnStatement(body)]);
  }
  const block = setup.get('body') as NodePath<t.BlockStatement>;
  for (const rest of rests) {
    block.node.body.unshift(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(rest.local),
          t.callExpression(runtime(state, 'rest'), [
            t.cloneNode(propsId),
            t.arrayExpression(rest.omit.map((key) => t.stringLiteral(key))),
          ]),
        ),
      ]),
    );
  }
}

/** What walking a pattern fills in, and what it needs to refuse one. */
type Collected = {
  reads: Read[];
  rests: Rest[];
  call: NodePath<t.CallExpression>;
  name: string;
};

/**
 * Walks an object pattern, recording how to reach each binding from `props`.
 *
 * `{ todo }` gives `props.todo`; `{ user: { name } }` gives `props.user.name`;
 * `{ count = 0 }` gives `props.count === undefined ? 0 : props.count`, which
 * re-applies the default on every read exactly as the language would - and
 * defaults on `undefined` alone, also as the language does. `??` would have
 * been shorter and answers for `null` too, so a parent passing `null` for
 * "known to be empty" would have got the default back instead.
 */
function collectPattern(pattern: t.ObjectPattern, base: t.Expression, into: Collected): void {
  const { reads, rests, call, name } = into;
  const seen: string[] = [];
  for (const property of pattern.properties) {
    if (t.isRestElement(property)) {
      // The grammar only allows an identifier as an object rest target, so the
      // parser has already rejected anything else.
      rests.push({ local: (property.argument as t.Identifier).name, omit: [...seen] });
      continue;
    }
    if (property.computed || !t.isIdentifier(property.key)) {
      throw call.buildCodeFrameError(
        `${name}: props can only be destructured by plain key. A computed key would have to be ` +
          'resolved at setup time, which is exactly the snapshot this rewrite avoids.',
      );
    }
    seen.push(property.key.name);
    const access: t.Expression = t.memberExpression(
      t.cloneNode(base),
      t.identifier(property.key.name),
    );
    const value = property.value;
    if (t.isIdentifier(value)) {
      reads.push({ local: value.name, access });
    } else if (t.isAssignmentPattern(value) && t.isIdentifier(value.left)) {
      reads.push({
        local: value.left.name,
        access: t.conditionalExpression(
          t.binaryExpression('===', access, t.identifier('undefined')),
          value.right,
          t.cloneNode(access),
        ),
      });
    } else if (t.isObjectPattern(value)) {
      collectPattern(value, access, into);
    } else {
      throw call.buildCodeFrameError(
        `${name}: this destructuring pattern cannot be rewritten into live reads. Take the ` +
          'props object and read from it where you need the value.',
      );
    }
  }
}
