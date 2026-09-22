/**
 * Where a JSX node goes: a component call, a server's markup, or a template.
 *
 * `compileNode` is the fork, and the two branches below it are the whole of
 * what a component needs — its props as accessors, and the machinery that lets
 * a run keep the child it made last time.
 */

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

import { CHILD_THUNK, generated } from './marks.js';

import { compileMarkup } from './markup.js';

import {
  attributeName,
  attributeValue,
  isComponentTag,
  isPure,
  isStaticValue,
  planChildren,
  propertyKey,
  tagExpression,
} from './nodes.js';

import { expressionStatement, takePosition, thunk } from './positions.js';

import { dependsOnRun, enclosingRun, isLocalView } from './runs.js';

import { runtime, type RunContext, type State } from './state.js';

import { compileTemplate } from './template.js';

export function compileNode(
  path: NodePath<t.JSXElement | t.JSXFragment>,
  state: State,
): t.Expression {
  if (path.isJSXFragment()) {
    return t.arrayExpression(compileChildren(path.node.children, state));
  }
  const node = path.node;
  if (isComponentTag(node)) {
    return compileComponent(path, state);
  }
  return state.firsthand.ssr ? compileMarkup(path, state) : compileTemplate(path, state);
}

function compileComponent(path: NodePath<t.JSXElement>, state: State): t.Expression {
  const node = path.node;
  const run = enclosingRun(path, state);
  const props = componentProps(path, run, state);
  const children = compileChildren(node.children, state);
  if (children.length > 0) {
    const returned =
      children.length === 1 ? (children[0] as t.Expression) : t.arrayExpression(children);
    props.properties.push(
      t.objectMethod(
        'get',
        t.identifier('children'),
        [],
        t.blockStatement([t.returnStatement(returned)]),
      ),
    );
  }
  const tag = tagExpression(node.openingElement.name as t.JSXIdentifier | t.JSXMemberExpression);
  const local = isLocalView(path, state);
  const make = local
    ? t.callExpression(tag, [t.objectExpression(props.properties)])
    : t.callExpression(runtime(state, 'createComponent'), [
        tag,
        t.objectExpression(props.properties),
      ]);

  if (run !== null) {
    return keptChild(state, run, make, props.cells);
  }
  return local ? asScope(make, path, state) : make;
}

/**
 * Where a local view's call needs a reactive scope of its own.
 *
 * A view is a reactive scope. In a child slot the surrounding thunk is already
 * one, so the call goes there as it stands; anywhere else — a return, a
 * variable — it gets a part. A server render has neither: the call stands where
 * it is and its markup is the answer, because a scope is a scope that can run
 * again and this one cannot.
 */
function asScope(make: t.Expression, path: NodePath<t.JSXElement>, state: State): t.Expression {
  if (state.firsthand.ssr) {
    return make;
  }
  const parent = path.parentPath;
  if (
    parent.isArrowFunctionExpression() &&
    parent.node.body === path.node &&
    CHILD_THUNK in parent.node
  ) {
    return make;
  }
  return t.callExpression(runtime(state, 'part'), [t.arrowFunctionExpression([], make)]);
}

/** A component's props, and the cells a run has to write before making it. */
type Props = {
  properties: (t.ObjectProperty | t.ObjectMethod | t.SpreadElement)[];
  /** Declarations that must run before the child is made, and on every run. */
  cells: t.Statement[];
};

function componentProps(path: NodePath<t.JSXElement>, run: RunContext | null, state: State): Props {
  const props: Props = { properties: [], cells: [] };
  for (const attribute of path.node.openingElement.attributes) {
    if (t.isJSXSpreadAttribute(attribute)) {
      props.properties.push(t.spreadElement(attribute.argument));
      continue;
    }
    const name = attributeName(attribute);
    const value = attributeValue(attribute);
    if (state.firsthand.ssr && name === 'key') {
      // An instruction to the reconciler, and a server has nothing to
      // reconcile. The DOM path consumes it in `rewriteKeyedMaps`, which a
      // server render does not run — so it would otherwise arrive as a prop
      // nobody reads, one accessor per row.
      continue;
    }
    if (value === null || isStaticValue(value)) {
      props.properties.push(t.objectProperty(propertyKey(name), value ?? t.booleanLiteral(true)));
      continue;
    }
    const held = dependsOnRun(value, run, path)
      ? throughCell(value, run as RunContext, props, state)
      : value;
    props.properties.push(dynamicProp(name, value, held, state));
  }
  return props;
}

/**
 * One dynamic prop.
 *
 * Dynamic props are accessors, so the child reads them live and its setup
 * function is never re-run (ADR-0005). The `return` carries the position of the
 * expression, so that the line the prop was written on is a line a debugger can
 * stop on — it is where the read that ties a child to a signal actually happens.
 */
function dynamicProp(
  name: string,
  value: t.Expression,
  held: t.Expression,
  state: State,
): t.ObjectProperty | t.ObjectMethod {
  if (state.firsthand.ssr && isPure(value)) {
    // On a server a prop is read once and nothing can change under it, so an
    // accessor buys only one thing: not evaluating an expression the child
    // never reads. That is worth keeping where evaluating early could be
    // *observed* — a call, an assignment, an await — and worth nothing where it
    // cannot. Reading a name or a member chain cannot, so it is written as a
    // value, which is three times cheaper to build.
    return t.objectProperty(propertyKey(name), held);
  }
  const read = t.returnStatement(held);
  takePosition(read, value);
  return t.objectMethod('get', propertyKey(name), [], t.blockStatement([read]));
}

/**
 * A value that belongs to one run, handed to a child through a cell.
 *
 * The cell is what lets the child keep its instance while what it is shown
 * changes: the run writes the cell, and only the parts that read that prop wake
 * up.
 */
function throughCell(
  value: t.Expression,
  run: RunContext,
  props: Props,
  state: State,
): t.Expression {
  const holder = t.identifier(`_cell$${String(run.next())}`);
  props.cells.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        holder,
        t.callExpression(runtime(state, 'cell'), [
          t.cloneNode(run.store),
          t.numericLiteral(run.next()),
          value,
        ]),
      ),
    ]),
  );
  return t.memberExpression(t.cloneNode(holder), t.identifier('value'));
}

/**
 * A child a run keeps.
 *
 * The child is made once and handed back unchanged on every run, so it keeps
 * its instance, its state and its place. What the run has to say to it goes
 * through the cells its props read — written before the child exists on the
 * first run, and written again afterwards, which wakes exactly the parts that
 * read the prop that moved.
 */
function keptChild(
  state: State,
  run: RunContext,
  make: t.Expression,
  cells: t.Statement[],
): t.Expression {
  const slot = t.identifier(`_kept$${String(run.next())}`);
  const held = t.identifier(`_own$${String(run.next())}`);
  const made = (): t.MemberExpression =>
    t.memberExpression(t.cloneNode(slot), t.identifier('last'));
  const body: t.Statement[] = [
    ...cells,
    t.variableDeclaration('const', [
      t.variableDeclarator(
        slot,
        t.callExpression(runtime(state, 'site'), [
          t.cloneNode(run.store),
          t.numericLiteral(run.next()),
        ]),
      ),
    ]),
    t.ifStatement(
      t.binaryExpression('===', made(), t.identifier('undefined')),
      t.blockStatement([
        t.variableDeclaration('const', [
          t.variableDeclarator(
            held,
            t.callExpression(runtime(state, 'open'), [t.cloneNode(run.store), t.cloneNode(slot)]),
          ),
        ]),
        expressionStatement(
          t.assignmentExpression(
            '=',
            made(),
            t.callExpression(runtime(state, 'part'), [t.arrowFunctionExpression([], make)]),
          ),
        ),
        expressionStatement(t.callExpression(runtime(state, 'close'), [t.cloneNode(held)])),
      ]),
    ),
    t.returnStatement(made()),
  ];
  return t.callExpression(generated(t.arrowFunctionExpression([], t.blockStatement(body))), []);
}

/**
 * Compiles the children of a fragment, or of a component that takes children.
 *
 * A dynamic child becomes a `part(...)`, not a bare thunk. An array has no
 * parent element, so its dynamic children cannot be bound where they are
 * written — and deferring them to insertion time would evaluate them under
 * whoever inserts the array, which loses the scope they belong to and does not
 * make them reactive at all. `part` carries that scope along with an anchor,
 * and the runtime binds it once the array is in the DOM.
 */
export function compileChildren(children: t.JSXElement['children'], state: State): t.Expression[] {
  const result: t.Expression[] = [];
  for (const entry of planChildren(children)) {
    if (entry.kind === 'text') {
      result.push(t.stringLiteral(entry.text as string));
    } else if (entry.kind === 'element') {
      result.push(entry.element as unknown as t.Expression);
    } else if (state.firsthand.ssr) {
      // A part is a place something can be written again. A server render
      // writes once, so the expression stands where it is and `child()`
      // renders whatever it turns out to be.
      result.push(entry.expression as t.Expression);
    } else if (entry.kind === 'list') {
      result.push(t.callExpression(runtime(state, 'part'), [entry.expression as t.Expression]));
    } else {
      result.push(
        t.callExpression(runtime(state, 'part'), [thunk(entry.expression as t.Expression)]),
      );
    }
  }
  return result;
}
