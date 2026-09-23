/**
 * The Babel plugin: the visitors, and the order the passes run in.
 *
 * Two passes run on `Program` before anything is compiled, because both answer
 * questions that must not depend on the order Babel walks in. Everything the
 * module accumulates — templates, imports, view registrations — is written
 * back out on the way past `Program` again.
 */

import type { PluginObject } from '@babel/core';

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

import { stableId } from './ids.js';

import { annotateComponent, nameCell } from './components.js';

import { compileNode } from './jsx.js';

import { CHILD_THUNK, KEPT, THROUGH_RUN } from './marks.js';

import { rewriteKeyedMaps } from './lists.js';

import type { FirsthandPluginOptions } from './options.js';

import { expressionStatement } from './positions.js';

import { collectRuns, collectViews } from './runs.js';

import { runtime, type State } from './state.js';

export default function firsthandPlugin(
  _api: unknown,
  options: FirsthandPluginOptions = {},
): PluginObject {
  return {
    name: 'firsthand',
    visitor: {
      Program: {
        enter(path: NodePath<t.Program>, state: State) {
          enterProgram(path, state, options);
        },
        exit(path: NodePath<t.Program>, state: State) {
          exitProgram(path, state);
        },
      },

      // Babel enters the outermost JSX node first. Its nested elements are
      // folded into the template and discarded; the nodes that survive (a
      // component's children, a dynamic expression) are re-visited later, by
      // which time they are no longer inside JSX.
      JSXElement(path: NodePath<t.JSXElement>, state: State) {
        if (!state.firsthand.ssr) {
          // A keyed list is a DOM concern: on the server the rows are strings
          // in an array, in order, and nothing has an identity to keep.
          rewriteKeyedMaps(path, state);
        }
        path.replaceWith(compileNode(path, state));
        hoistKept(path);
      },

      JSXFragment(path: NodePath<t.JSXFragment>, state: State) {
        if (!state.firsthand.ssr) {
          rewriteKeyedMaps(path, state);
        }
        path.replaceWith(compileNode(path, state));
      },

      CallExpression(path: NodePath<t.CallExpression>, state: State) {
        annotateComponent(path, state, options);
      },

      VariableDeclarator(path: NodePath<t.VariableDeclarator>, state: State) {
        // Not for a server render: devtools is a panel in a browser, and a
        // name emitted here would be a call into a runtime that has no reason
        // to carry one.
        if (options.devtools === true && options.ssr !== true) {
          nameCell(path, state);
        }
      },
    },
  };
}

/**
 * The two passes that must finish before any node is compiled.
 *
 * Both answer a question about the module as a whole — which functions write
 * markup, and which of them run again — and the answer must not depend on the
 * order Babel happens to walk in.
 */
function enterProgram(
  path: NodePath<t.Program>,
  state: State,
  options: FirsthandPluginOptions,
): void {
  state.firsthand = {
    imports: new Map(),
    templates: [],
    counter: 0,
    moduleId: stableId(options.packageName ?? 'app', state.filename ?? 'module'),
    views: new Map(),
    viewNodes: new Set(),
    runs: new Map(),
    ssr: options.ssr === true,
    hydratable: options.hydratable === true && options.ssr !== true,
  };
  collectViews(path, state);
  if (options.ssr !== true) {
    // A run keeps its sites between runs. A server render has one.
    collectRuns(path, state);
  }
}

/** Writes back what compiling the module accumulated: views, templates, imports. */
function exitProgram(path: NodePath<t.Program>, state: State): void {
  const { imports, templates, views } = state.firsthand;
  // After the declarations, because a `const` view is not initialised until its
  // statement runs. Function declarations are hoisted and do not care.
  for (const [, local] of views) {
    path.node.body.push(
      expressionStatement(t.callExpression(runtime(state, 'view'), [t.cloneNode(local)])),
    );
  }
  if (templates.length > 0) {
    path.node.body.unshift(t.variableDeclaration('const', templates));
  }
  for (const [source, names] of groupBySource(imports)) {
    path.node.body.unshift(
      t.importDeclaration(
        names.map(([exported, local]) => t.importSpecifier(local, t.identifier(exported))),
        t.stringLiteral(source),
      ),
    );
  }
}

function groupBySource(imports: Map<string, t.Identifier>): Map<string, [string, t.Identifier][]> {
  const grouped = new Map<string, [string, t.Identifier][]>();
  for (const [key, local] of imports) {
    const separator = key.indexOf('#');
    const source = key.slice(0, separator);
    const exported = key.slice(separator + 1);
    const bucket = grouped.get(source);
    if (bucket === undefined) {
      grouped.set(source, [[exported, local]]);
    } else {
      bucket.push([exported, local]);
    }
  }
  return grouped;
}

/**
 * Takes the thunk off a child a run keeps.
 *
 * `compileChildren` wraps every dynamic child in `part(() => …)`, which is
 * right for an expression and one wrapper too many for a kept child: that is
 * already a part, and the thunk only defers it.
 *
 * Deferring it is a bug rather than an inefficiency. The site is looked up
 * when the thunk runs, and the thunk runs after `ran` has ended the run that
 * made it — so the site is stamped with the *next* generation, and the next
 * `ran` sees a branch the run has left as one it has just reached. The branch
 * is never disposed and stays in the page beside the new one.
 *
 * Unwrapped, the site is looked up while the run is running, which is when it
 * happened.
 */
function hoistKept(path: NodePath): void {
  if (!(KEPT in path.node)) {
    return;
  }
  const thunk = path.parentPath;
  if (
    !thunk.isArrowFunctionExpression() ||
    !(CHILD_THUNK in thunk.node) ||
    !(THROUGH_RUN in thunk.node) ||
    thunk.node.body !== path.node
  ) {
    return;
  }
  const wrapper = thunk.parentPath;
  if (wrapper.isCallExpression() && wrapper.node.arguments.length === 1) {
    wrapper.replaceWith(path.node);
  }
}
