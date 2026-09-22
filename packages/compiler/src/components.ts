/**
 * What a `component(...)` call gains on the way through (ADR-0004).
 *
 * A stable build id, a display name, props rewritten into live reads, and —
 * under the `devtools` option only — a label on each cell the module creates.
 */

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

import { declaredName, isFirsthandImport } from './nodes.js';

import type { FirsthandPluginOptions } from './options.js';

import { rewritePropsDestructuring } from './props.js';

import { checkDecidedOnce, checkKeptReads, checkRunBody } from './strict.js';

import { runtime, type State } from './state.js';

/**
 * Gives every `component(...)` call a stable build id and a display name, and
 * rejects props destructuring.
 */
export function annotateComponent(
  path: NodePath<t.CallExpression>,
  state: State,
  options: FirsthandPluginOptions,
): void {
  const callee = path.node.callee;
  if (!t.isIdentifier(callee, { name: 'component' }) || path.node.arguments.length > 2) {
    return;
  }
  const binding = path.scope.getBinding('component');
  if (binding === undefined || !isFirsthandImport(binding)) {
    return;
  }
  const setup = path.node.arguments[0];
  if (!t.isArrowFunctionExpression(setup) && !t.isFunctionExpression(setup)) {
    return;
  }
  const name = declaredName(path);
  rewritePropsDestructuring(path, name, state);
  if (options.strictReactivity !== false) {
    const setupPath = path.get('arguments.0') as NodePath<t.Function>;
    checkKeptReads(setupPath, name);
    checkDecidedOnce(setupPath, name);
    checkRunBody(setupPath, name);
  }
  path.node.arguments = [
    setup,
    path.node.arguments[1] ?? t.identifier('undefined'),
    t.stringLiteral(`${state.firsthand.moduleId}/${name}`),
    t.stringLiteral(name),
  ];
}

/** The factories whose result is worth naming after the variable holding it. */
const NAMED = new Map([
  ['signal', 'signal'],
  ['computed', 'computed'],
  ['deepSignal', 'signal'],
]);

/**
 * Labels `const count = signal(0)` with `count` and where it was written.
 *
 * Emitted only under the `devtools` option, so a production build is
 * byte-identical to one compiled without it. The label is wrapped around the
 * call rather than passed into it: `signal` keeps its signature, and a cell
 * created any other way is simply unnamed rather than special.
 */
export function nameCell(path: NodePath<t.VariableDeclarator>, state: State): void {
  const init = path.node.init;
  const target = path.node.id;
  if (!t.isCallExpression(init) || !t.isIdentifier(target) || !t.isIdentifier(init.callee)) {
    return;
  }
  const kind = NAMED.get(init.callee.name);
  if (kind === undefined) {
    return;
  }
  const binding = path.scope.getBinding(init.callee.name);
  if (binding === undefined || !isFirsthandImport(binding)) {
    return;
  }
  // Both are present for anything parsed from a file, which is the only way
  // this visitor is reached: Babel fills `loc` from the source, and the plugin
  // is always given a filename by the bundler and by the tests.
  const line = (init.loc as t.SourceLocation).start.line;
  const source = state.filename as string;
  const cut = Math.max(source.lastIndexOf('/'), source.lastIndexOf(String.fromCharCode(92)));
  const where = `${source.slice(cut + 1)}:${String(line)}`;
  const call = t.callExpression(runtime(state, 'label'), [
    init,
    t.stringLiteral(kind),
    t.stringLiteral(`${target.name} (${where})`),
  ]);
  path.node.init = call;
}
