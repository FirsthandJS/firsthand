/**
 * Which function a piece of markup belongs to, and what that function owns.
 *
 * Two passes run before anything is compiled — `collectViews` and
 * `collectRuns` — because both answer questions that must not depend on the
 * order Babel happens to walk in. Everything else here is asked later, of one
 * node at a time, and answered from what those two found.
 */

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

import { GENERATED, isKeyedList } from './marks.js';

import { attributeName, declaredName, isComponentTag, isFirsthandImport } from './nodes.js';

import { runtime, type Build, type RunContext, type State } from './state.js';

/**
 * Finds every function this module writes markup inside, before anything is
 * compiled.
 *
 * This is the line between a view of ours and a component of somebody else's,
 * and it is drawn where it can actually be seen: **which compiler turned the
 * markup into code.** A function that builds its result with another
 * framework's `createElement` contains no markup for this compiler to
 * translate, so it is not ours and is left to the adapter — even though it is
 * a local function that returns something renderable.
 *
 * A pass of its own rather than a note taken while compiling, because a tag
 * can stand above the function it names and the answer must not depend on the
 * order Babel happens to walk in.
 *
 * Every enclosing function is recorded, not only the innermost: a view that
 * builds its markup in a helper closure is still a view.
 */
export function collectViews(program: NodePath<t.Program>, state: State): void {
  const { views, viewNodes } = state.firsthand;
  const record = (path: NodePath): void => {
    let fn = path.getFunctionParent();
    while (fn !== null) {
      viewNodes.add(fn.node);
      const named = moduleLevelName(fn);
      if (named !== null) {
        views.set(named, t.identifier(named));
      }
      fn = fn.getFunctionParent();
    }
  };
  program.traverse({
    JSXElement: record,
    JSXFragment: record,
  });
}

/**
 * The name a function is declared under at module level, if it is.
 *
 * Asked of the scope rather than of the parent chain: a declaration reached
 * through an `export` has one more node above it, and a block inside a
 * function has one more again. The scope a name belongs to answers both at
 * once, and a name that belongs to the module's scope is one another module
 * can import.
 */
function moduleLevelName(fn: NodePath<t.Function>): string | null {
  if (fn.isFunctionDeclaration()) {
    const id = fn.node.id;
    // `export default function () {}` has no name to mark.
    if (id === null || id === undefined) {
      return null;
    }
    return t.isProgram(fn.parentPath.scope.block) ? id.name : null;
  }
  // Anything else is only nameable through the variable it is assigned to,
  // which also rules out an object method and a class method.
  const declarator = fn.parentPath;
  if (!declarator.isVariableDeclarator() || !t.isIdentifier(declarator.node.id)) {
    return null;
  }
  return t.isProgram(declarator.scope.block) ? declarator.node.id.name : null;
}

/**
 * Whether a tag names a plain function declared in this module.
 *
 * Then the compiler knows what it is — it compiled the markup inside it — and
 * emits the call itself. Nothing is looked up at runtime, so an installed
 * adapter for another framework never sees it, and the decision cannot be
 * wrong. An imported name is left to `createComponent`, which reads the mark.
 */
export function isLocalView(path: NodePath<t.JSXElement>, state: State): boolean {
  const name = path.node.openingElement.name;
  if (!t.isJSXIdentifier(name)) {
    return false;
  }
  const binding = path.scope.getBinding(name.name);
  // An import, or a name reassigned somewhere: the value at the call site is
  // not necessarily the function that was declared.
  if (binding === undefined || binding.kind === 'module' || binding.constantViolations.length > 0) {
    return false;
  }
  if (binding.path.isFunctionDeclaration()) {
    return state.firsthand.viewNodes.has(binding.path.node);
  }
  if (!binding.path.isVariableDeclarator()) {
    return false;
  }
  const init = binding.path.node.init;
  // `const Counter = component(...)` is a call, and stays one.
  if (!t.isArrowFunctionExpression(init) && !t.isFunctionExpression(init)) {
    return false;
  }
  return state.firsthand.viewNodes.has(init);
}

/**
 * Finds the functions that run again as a whole, and gives each one a store.
 *
 * A render function is the one a setup returns. The setup runs once per
 * instance, so a `const` declared there is per instance too — which is exactly
 * what a store has to be, and why this needs no registry and no ambient state.
 */
export function collectRuns(program: NodePath<t.Program>, state: State): void {
  program.traverse({
    CallExpression(call: NodePath<t.CallExpression>) {
      giveStores(call, state);
    },
  });
}

/** Gives every render function one `component(...)` call returns its own store. */
function giveStores(call: NodePath<t.CallExpression>, state: State): void {
  if (!isComponentCall(call)) {
    return;
  }
  const setup = call.get('arguments.0') as NodePath;
  if (!setup.isArrowFunctionExpression() && !setup.isFunctionExpression()) {
    return;
  }
  const found = returnedFunctions(setup);
  if (found.length === 0) {
    return;
  }
  // An expression body has nowhere to declare a store, so it becomes a block.
  // Nothing else about it changes.
  setup.ensureBlock();
  const block = setup.get('body') as NodePath<t.BlockStatement>;
  for (const run of found) {
    const store = setup.scope.generateUidIdentifier('store');
    block.unshiftContainer(
      'body',
      t.variableDeclaration('const', [
        t.variableDeclarator(
          store,
          t.callExpression(runtime(state, 'store'), [t.stringLiteral(declaredName(call))]),
        ),
      ]),
    );
    let index = 0;
    state.firsthand.runs.set(run.node, { node: run.node, store, next: () => index++ });
    closeRun(run, store, state);
  }
}

/** The functions a setup hands back — its render functions, if it has any. */
function returnedFunctions(setup: NodePath<t.Function>): NodePath<t.Function>[] {
  const found: NodePath<t.Function>[] = [];
  const body = setup.get('body') as NodePath;
  if (!body.isBlockStatement()) {
    if (body.isArrowFunctionExpression() || body.isFunctionExpression()) {
      found.push(body);
    }
    return found;
  }
  body.traverse({
    // A handler or a callback returns its own things; only what the setup
    // itself hands back is the view.
    Function(nested: NodePath<t.Function>) {
      nested.skip();
    },
    ReturnStatement(statement: NodePath<t.ReturnStatement>) {
      const argument = statement.get('argument') as NodePath;
      if (argument.isArrowFunctionExpression() || argument.isFunctionExpression()) {
        found.push(argument);
      }
    },
  });
  return found;
}

/**
 * Marks the end of a run, wherever it ends.
 *
 * Every `return` hands its value through `ran`, which is where a branch the
 * run has stopped taking is disposed. Wrapping the whole body instead would
 * have been one call rather than several, and would have put a frame between
 * the run and whoever asked for it — this way the stack a debugger shows is
 * the one the source describes.
 */
function closeRun(run: NodePath<t.Function>, store: t.Identifier, state: State): void {
  const body = run.get('body') as NodePath;
  if (!body.isBlockStatement()) {
    body.replaceWith(
      t.callExpression(runtime(state, 'ran'), [t.cloneNode(store), body.node as t.Expression]),
    );
    return;
  }
  const returns: NodePath<t.ReturnStatement>[] = [];
  body.traverse({
    Function(nested: NodePath<t.Function>) {
      nested.skip();
    },
    ReturnStatement(statement: NodePath<t.ReturnStatement>) {
      returns.push(statement);
    },
  });
  for (const statement of returns) {
    statement.node.argument = t.callExpression(runtime(state, 'ran'), [
      t.cloneNode(store),
      statement.node.argument ?? t.identifier('undefined'),
    ]);
  }
}

function isComponentCall(path: NodePath<t.CallExpression>): boolean {
  if (!t.isIdentifier(path.node.callee, { name: 'component' })) {
    return false;
  }
  const binding = path.scope.getBinding('component');
  return binding !== undefined && isFirsthandImport(binding);
}

/** The run this markup belongs to, or `null` when it is built once. */
export function enclosingRun(path: NodePath, state: State): RunContext | null {
  let fn = path.getFunctionParent();
  // The nearest function the *author* wrote decides. Markup inside a callback
  // — a list row, a handler, a part the compiler wrapped — belongs to that
  // callback, which is made once and is not this run. A wrapper the compiler
  // wrote is not a boundary and is stepped over.
  while (fn !== null && GENERATED in fn.node) {
    fn = fn.getFunctionParent();
  }
  if (fn === null) {
    return null;
  }
  return state.firsthand.runs.get(fn.node) ?? null;
}

/**
 * Whether an expression needs a value that belongs to one run of the function.
 *
 * This is the whole classification, and it is forced rather than chosen: an
 * expression that names nothing from the run can be given a scope of its own
 * and left to update itself, and one that names something from the run cannot
 * — that value belongs to the call that produced it, so the run must write it.
 */
export function dependsOnRun(node: t.Node, run: RunContext | null, at: NodePath): boolean {
  if (run === null) {
    return false;
  }
  const names = new Set<string>();
  collectNames(node, names);
  for (const name of names) {
    const binding = at.scope.getBinding(name);
    if (binding === undefined) {
      continue;
    }
    if (
      binding.scope.block === run.node ||
      binding.path.findParent((parent) => parent.node === run.node) !== null
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Every name an expression mentions.
 *
 * Deliberately generous: a name that turns out not to be a reference only
 * makes the answer more cautious, and being cautious means writing a value
 * that could have updated itself — slower, never wrong.
 */
function collectNames(node: t.Node, into: Set<string>): void {
  if (t.isIdentifier(node)) {
    into.add(node.name);
    return;
  }
  for (const key of t.VISITOR_KEYS[node.type] as readonly string[]) {
    if (isSpelling(node, key)) {
      continue;
    }
    const value = (node as unknown as Record<string, unknown>)[key];
    for (const child of Array.isArray(value) ? value : [value]) {
      if (typeof child === 'object' && child !== null) {
        collectNames(child as t.Node, into);
      }
    }
  }
}

/**
 * Whether a key under a node is a name written down rather than a name used.
 *
 * `a.b` and `{ b: 1 }` both contain the identifier `b`, and in neither case is
 * it a reference to anything — so counting it would tie the expression to a
 * binding that has nothing to do with it.
 */
function isSpelling(node: t.Node, key: string): boolean {
  if (t.isMemberExpression(node)) {
    return !node.computed && key === 'property';
  }
  if (t.isObjectProperty(node) || t.isObjectMethod(node)) {
    return !node.computed && key === 'key';
  }
  return false;
}

/**
 * Whether a site can be kept between runs.
 *
 * Everything a run needs to write has to be something this compiler knows how
 * to write. A spread, a `ref` or a keyed list is made once by its nature, and
 * making one once out of a value that belongs to a single run would hold that
 * run's value for ever — so such a site is built afresh instead, which is what
 * happens today and is never wrong.
 */
export function canRetain(node: t.JSXElement, build: Build): boolean {
  for (const attribute of node.openingElement.attributes) {
    if (madeOncePerRun(attribute, build)) {
      return false;
    }
  }
  for (const child of node.children) {
    if (t.isJSXElement(child)) {
      if (!isComponentTag(child) && !canRetain(child, build)) {
        return false;
      }
      continue;
    }
    if (
      t.isJSXExpressionContainer(child) &&
      !t.isJSXEmptyExpression(child.expression) &&
      isKeyedList(child.expression) &&
      listHoldsRunValue(child.expression as t.CallExpression, build)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Whether keeping a keyed list would freeze one run's value inside it.
 *
 * A list is made once and reconciles afterwards, so anything it closes over is
 * closed over for the life of the site. Its **data** is not a problem: the
 * emitter routes a run-owned source through a cell the run writes, which is how
 * every other run-owned value reaches something that outlives the run
 * (`cell`, ADR-0026). Its **key function and its row** are, because those are
 * called with the row rather than with the run, and a run local inside one
 * would stay at whatever the first run saw.
 *
 * Before this, any keyed list over a run local refused the whole site, and the
 * enclosing template was rebuilt on every run — every row of it, losing
 * component state and DOM identity. That is issue #40, and it fired on the
 * shape people actually write: compute at the top of the run, render below.
 */
function listHoldsRunValue(call: t.CallExpression, build: Build): boolean {
  // `list(source, keyOf, row)`, as `rewriteKeyedMaps` emits it. The first
  // argument is the data and is handled by the emitter; the rest are not.
  return call.arguments.slice(1).some((argument) => dependsOnRun(argument, build.run, build.at));
}

/** A spread or a `ref` the run owns: made once by its nature, so not kept. */
function madeOncePerRun(attribute: t.JSXAttribute | t.JSXSpreadAttribute, build: Build): boolean {
  if (t.isJSXSpreadAttribute(attribute)) {
    return dependsOnRun(attribute.argument, build.run, build.at);
  }
  const value = attribute.value;
  return (
    attributeName(attribute) === 'ref' &&
    t.isJSXExpressionContainer(value) &&
    !t.isJSXEmptyExpression(value.expression) &&
    dependsOnRun(value.expression, build.run, build.at)
  );
}
