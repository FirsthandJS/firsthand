/**
 * The Firsthand TSX transform (ADR-0009).
 *
 * Static markup becomes one `<template>` per shape, created once and cloned per
 * instance. Every dynamic expression becomes a thunk handed to a specialised
 * DOM part, and the runtime decides by observation whether an effect needs to
 * be retained. The compiler never tries to decide statically whether an
 * expression is reactive — that question is undecidable in general, and being
 * wrong about it means silently missing updates.
 *
 * The transform emits calls against the published protocol in
 * `@firsthandjs/dom/internal` and has no privileged access to the runtime.
 */

import type { PluginObject, PluginPass } from '@babel/core';
import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  BOOLEAN_PROPERTIES,
  DOM_PROPERTIES,
  SVG_ELEMENTS,
  VOID_ELEMENTS,
  escapeAttribute,
  escapeText,
  eventName,
} from './html.js';
import { stableId } from './ids.js';

const RUNTIME = '@firsthandjs/dom/internal';
const SERVER_RUNTIME = '@firsthandjs/server/internal';
const CORE = '@firsthandjs/core';

type FirsthandState = {
  imports: Map<string, t.Identifier>;
  templates: t.VariableDeclarator[];
  counter: number;
  moduleId: string;
  /** Module-level functions markup was compiled into, in source order. */
  views: Map<string, t.Identifier>;
  /** Every function markup was written inside, for resolving tags locally. */
  viewNodes: Set<t.Node>;
  /** Whether this module is being compiled for a server render. */
  ssr: boolean;
  /** Whether this module's output has to be able to adopt server markup. */
  hydratable: boolean;
  /** Functions that run again as a whole, and where each keeps its sites. */
  runs: Map<t.Node, RunContext>;
};

/**
 * What a re-running function needs in order to keep its DOM.
 *
 * `store` is an array declared once per instance — in the setup, which runs
 * once — and every site inside the run takes a numbered place in it. The index
 * is fixed at compile time, so a site inside an `if` keeps its own place
 * whether or not the branch was taken: nothing depends on the order the run
 * happens to reach things in, which is the rule React needs for hooks and this
 * does not.
 */
type RunContext = {
  /** The function whose body re-runs. Bindings inside it belong to one run. */
  node: t.Node;
  store: t.Identifier;
  next: () => number;
};

/**
 * Marks an arrow the compiler wrote for a child slot.
 *
 * Whatever sits directly in one is already inside a reactive scope, so a view
 * function there can be called where it stands instead of being wrapped in a
 * part of its own.
 */
const CHILD_THUNK = Symbol('firsthand.childThunk');

/**
 * Marks a wrapper the compiler wrote, which is not a scope of anyone's.
 *
 * A template compiles to an immediately invoked arrow, and that arrow is a
 * function — so walking up from markup inside it would stop there and lose the
 * run it belongs to. It is machinery, not a boundary, and is walked through.
 */
const GENERATED = Symbol('firsthand.generated');

function generated(arrow: t.ArrowFunctionExpression): t.ArrowFunctionExpression {
  (arrow as unknown as Record<symbol, boolean>)[GENERATED] = true;
  return arrow;
}

declare module '@babel/core' {
  interface PluginPass {
    firsthand: FirsthandState;
  }
}

type State = PluginPass;

type Build = {
  html: string[];
  /** Navigation to the nodes a template's parts need. Runs every time. */
  statements: t.Statement[];
  /** Work done when the site is made: parts, listeners, refs. */
  once: t.Statement[];
  /** Writes the run performs into a site it already made. */
  each: t.Statement[];
  run: RunContext | null;
  /** Where to resolve names from, when deciding what belongs to the run. */
  at: NodePath;
  next: () => t.Identifier;
  name: (prefix: string) => t.Identifier;
};

function pushOnce(build: Build, statement: t.Statement): void {
  build.once.push(statement);
}

function pushEach(build: Build, statement: t.Statement): void {
  build.each.push(statement);
}

export type FirsthandPluginOptions = {
  /** Package name used when hashing stable component ids (ADR-0004). */
  packageName?: string;
  /**
   * Refuse to compile a value that is read once in a setup and then kept.
   *
   * **On by default.** The rule only sees declarations whose initialiser is
   * nothing but a read, which is the shape that is almost always a mistake;
   * anything containing a call is left alone. `false` turns it off for a
   * codebase that has such a read on purpose and would rather not mark it with
   * `snapshot()` — see `checkKeptReads` (ADR-0019).
   */
  strictReactivity?: boolean;
  /**
   * Name the cells a module creates, for devtools.
   *
   * A runtime cannot see that `const count = signal(0)` is called `count`, and
   * `new Error().stack` reports a position in the *compiled* module — the
   * browser does not apply source maps to `error.stack`, so the line it names
   * is not the line that was written. The compiler knows both, so it says so.
   *
   * Off by default and turned on by the Vite plugin while serving: a
   * production build emits nothing.
   */
  devtools?: boolean;
  /**
   * Compile for a server render.
   *
   * The same source, emitted against `@firsthandjs/server/internal` instead of
   * `@firsthandjs/dom/internal`: markup is built as a string rather than as
   * nodes, and the things a server cannot do — listeners, refs, retained
   * sites — are not emitted at all.
   *
   * The Vite plugin sets this from the bundler's own `ssr` flag, so an
   * application configures nothing.
   */
  ssr?: boolean;
  /**
   * Emit navigation that can walk server markup.
   *
   * An application that hydrates needs it; one that does not should leave it
   * off, because it turns two property reads per dynamic position into two
   * calls. The Vite plugin sets it for a project that has a server build.
   */
  hydratable?: boolean;
};

export default function firsthandPlugin(
  _api: unknown,
  options: FirsthandPluginOptions = {},
): PluginObject {
  return {
    name: 'firsthand',
    visitor: {
      Program: {
        enter(path: NodePath<t.Program>, state: State) {
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
        },
        exit(path: NodePath<t.Program>, state: State) {
          const { imports, templates, views } = state.firsthand;
          // After the declarations, because a `const` view is not initialised
          // until its statement runs. Function declarations are hoisted and do
          // not care.
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

function runtime(state: State, name: string, source?: string): t.Identifier {
  return runtimeFrom(state, name, source ?? (state.firsthand.ssr ? SERVER_RUNTIME : RUNTIME));
}

function runtimeFrom(state: State, name: string, source: string): t.Identifier {
  const key = `${source}#${name}`;
  let local = state.firsthand.imports.get(key);
  if (local === undefined) {
    local = t.identifier(`_$${name}`);
    state.firsthand.imports.set(key, local);
  }
  return t.cloneNode(local);
}

// ---------------------------------------------------------------------------
// Component declarations (ADR-0004)
// ---------------------------------------------------------------------------

/**
 * Gives every `component(...)` call a stable build id and a display name, and
 * rejects props destructuring.
 */
function annotateComponent(
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

/**
 * Rejects a value that is read once in a setup and then kept (ADR-0019).
 *
 * The setup runs one time per instance, so `const total = props.total` is a
 * number from the moment it is read and will not move again. Nothing throws at
 * runtime — the number is simply old — which is why this exists.
 *
 * Deliberately narrow, because a false positive here stops a build. Only a
 * declaration whose initialiser is *nothing but* a read is reported:
 * identifiers, member accesses, literals and the operators between them. A
 * call is never reported, which leaves `signal(props.initial)`, `peek()`,
 * `computed(...)` and every handler alone — including `snapshot(...)`, the way
 * to say that reading once is the point.
 */
function checkKeptReads(setup: NodePath<t.Function>, name: string): void {
  const parameter = setup.node.params[0];
  const propsName = t.isIdentifier(parameter) ? parameter.name : null;
  const body = setup.get('body');
  if (!body.isBlockStatement()) {
    // An expression body declares nothing, so there is nothing to keep.
    return;
  }
  body.traverse({
    Function(nested: NodePath<t.Function>) {
      // A handler, an effect, a computed: those bodies run again, so a read
      // inside one is a live read rather than a kept value.
      nested.skip();
    },
    VariableDeclarator(declarator: NodePath<t.VariableDeclarator>) {
      const init = declarator.node.init;
      if (init === null || init === undefined || !readsOnly(init, propsName)) {
        return;
      }
      const target = declarator.node.id;
      const label = t.isIdentifier(target) ? `\`${target.name}\`` : 'This value';
      throw declarator.buildCodeFrameError(
        `${name}: ${label} is read once, here, and then kept. A setup runs one time ` +
          'per instance, so this value will not change again.\n\n' +
          'Move the read into the part, handler, effect or computed that should ' +
          're-read it — or wrap it in snapshot(() => …) if reading once is what ' +
          'you meant.',
      );
    },
  });
}

/**
 * Rejects a view chosen once, in the setup, from something that changes.
 *
 * ```tsx
 * // Decided while the component was built, and never again:
 * return open.value ? <Form /> : <Button />;
 *
 * // A part, re-evaluated when `open` changes:
 * return <>{open.value ? <Form /> : <Button />}</>;
 * ```
 *
 * The two look the same and behave completely differently, because a setup
 * runs once per instance: the first form freezes whichever branch was true at
 * setup, and nothing throws — the screen is simply wrong, later, in a way that
 * reads as a broken button.
 *
 * Only the **returned expression** is examined, and only when a signal decides
 * which view it produces. A read *inside* JSX is a part and is left alone; so
 * is a return with no JSX in it at all, which is somebody's helper rather than
 * a view.
 *
 * Deliberately narrow, because a false positive here stops a build. A `.value`
 * read is reported and a **prop read is not**: a signal exists in order to
 * change, while a prop may be fixed for the life of an instance — a recursive
 * `<Nested depth={props.depth - 1} />` chooses its shape once on purpose, and
 * a rule that could not tell the difference would refuse it.
 */
function checkDecidedOnce(setup: NodePath<t.Function>, name: string): void {
  const report = (at: NodePath): never => {
    throw at.buildCodeFrameError(
      `${name}: this view is chosen once, here, from a value that changes. A setup ` +
        'runs one time per instance, so the other branch will never appear.' +
        '\n\nEither put the choice inside the markup, where it is a part:' +
        '\n\n  return <>{open.value ? <A /> : <B />}</>;' +
        '\n\nor return a render function, which is a reactive scope of its own ' +
        'and may use ordinary control flow:' +
        '\n\n  return () => (open.value ? <A /> : <B />);',
    );
  };

  /** A returned expression that decides between views from a live read. */
  const check = (returned: t.Node, at: NodePath): void => {
    if (t.isConditionalExpression(returned)) {
      if (!hasView(returned.consequent) && !hasView(returned.alternate)) {
        return;
      }
      if (readsSignal(returned.test)) {
        report(at);
      }
      return;
    }
    if (t.isLogicalExpression(returned) && returned.operator !== '??') {
      if (!hasView(returned.right) && !hasView(returned.left)) {
        return;
      }
      if (readsSignal(returned.left)) {
        report(at);
      }
    }
  };

  const body = setup.get('body');
  if (!body.isBlockStatement()) {
    check(setup.node.body, body);
    return;
  }
  body.traverse({
    Function(nested: NodePath<t.Function>) {
      // A handler or a nested component: its body runs on its own terms.
      nested.skip();
    },
    ReturnStatement(statement: NodePath<t.ReturnStatement>) {
      const returned = statement.node.argument;
      if (returned !== null && returned !== undefined) {
        check(returned, statement);
      }
    },
    /**
     * The same mistake spelled with a keyword, and the one that actually
     * shipped: a route guard that returned `<Navigate />` early left the page
     * it was meant to hide on the screen after a sign-out.
     */
    IfStatement(statement: NodePath<t.IfStatement>) {
      if (!readsSignal(statement.node.test)) {
        return;
      }
      if (returnsView(statement.node.consequent) || returnsView(statement.node.alternate)) {
        report(statement.get('test'));
      }
    },
  });
}

/**
 * Rejects the two things a render function cannot do.
 *
 * **Nothing persistent is made in a run.** A signal, a computed, an effect or
 * a resource is a thing that outlives the moment it was made; a run happens
 * again, so one made there would be made again, and the one before it thrown
 * away. That is not a rule about order — it is the same rule as everywhere
 * else in Firsthand, said once: persistent things are made in the setup.
 *
 * **Repeated markup carries a key.** A site is identified by where it stands,
 * which answers for markup that appears once. Markup inside a loop appears
 * many times from one place, and only a key can say which of them is which.
 * Without one, a run would take the rows apart and build them again — silently,
 * losing whatever they held.
 */
function checkRunBody(setup: NodePath<t.Function>, name: string): void {
  const runs: NodePath<t.Function>[] = [];
  // Every setup has a block by now: `collectRuns` gave one to any that had an
  // expression body, so that it had somewhere to declare a store.
  const body = setup.get('body') as NodePath<t.BlockStatement>;
  body.traverse({
    Function(nested: NodePath<t.Function>) {
      nested.skip();
    },
    ReturnStatement(statement: NodePath<t.ReturnStatement>) {
      const argument = statement.get('argument') as NodePath;
      if (argument.isArrowFunctionExpression() || argument.isFunctionExpression()) {
        runs.push(argument);
      }
    },
  });
  for (const run of runs) {
    checkNothingPersistent(run, name);
    checkRepeatedMarkup(run, name);
  }
}

/** Things that outlive the run that made them, and so cannot be made in one. */
const PERSISTENT = new Map([
  ['signal', 'a signal'],
  ['computed', 'a computed'],
  ['effect', 'an effect'],
  ['deepSignal', 'a deep signal'],
  ['useResource', 'a resource'],
  ['useAction', 'an action'],
  ['onCleanup', 'a cleanup'],
  ['provide', 'a context value'],
]);

function checkNothingPersistent(run: NodePath<t.Function>, name: string): void {
  run.traverse({
    Function(nested: NodePath<t.Function>) {
      // A handler runs on its own terms and may hold whatever it likes.
      nested.skip();
    },
    CallExpression(call: NodePath<t.CallExpression>) {
      const callee = call.node.callee;
      if (!t.isIdentifier(callee)) {
        return;
      }
      const what = PERSISTENT.get(callee.name);
      if (what === undefined) {
        return;
      }
      const binding = call.scope.getBinding(callee.name);
      if (binding === undefined || !isFirsthandImport(binding)) {
        return;
      }
      throw call.buildCodeFrameError(
        `${name}: this render function makes ${what}, and it runs again whenever ` +
          'something it read changes — so this would be made again, and the one ' +
          'before it thrown away.\n\nMove it into the setup, above the render ' +
          'function. Persistent things are made once, where the setup runs once.',
      );
    },
  });
}

function checkRepeatedMarkup(run: NodePath<t.Function>, name: string): void {
  const report = (at: NodePath): never => {
    throw at.buildCodeFrameError(
      `${name}: this markup is written once and appears many times, so where it ` +
        'stands cannot say which of them is which.\n\nGive it a key:\n\n' +
        '  {rows.map((row) => <Row key={row.id} row={row} />)}',
    );
  };
  run.traverse({
    Function(nested: NodePath<t.Function>) {
      // Only what this run writes. A list callback the compiler already turned
      // into a keyed part carries its key, and is skipped with it.
      nested.skip();
    },
    'ForStatement|ForOfStatement|ForInStatement|WhileStatement|DoWhileStatement'(loop: NodePath) {
      loop.traverse({
        JSXElement(element: NodePath<t.JSXElement>) {
          // Only what the loop produces, not what that markup is made of: a
          // row needs a key, and what is inside the row is the row.
          element.skip();
          if (!hasKey(element.node)) {
            report(element);
          }
        },
      });
    },
    CallExpression(call: NodePath<t.CallExpression>) {
      // A `.map` the keyed rewrite did not take: either it had no key, or its
      // value does not go straight into a child slot.
      const callee = call.node.callee;
      if (
        LIST_CALL in call.node ||
        !t.isMemberExpression(callee) ||
        callee.computed ||
        !t.isIdentifier(callee.property, { name: 'map' })
      ) {
        return;
      }
      call.traverse({
        JSXElement(element: NodePath<t.JSXElement>) {
          element.skip();
          if (!hasKey(element.node)) {
            report(element);
          }
        },
      });
    },
  });
}

function hasKey(element: t.JSXElement): boolean {
  return element.openingElement.attributes.some(
    (attribute) => t.isJSXAttribute(attribute) && attributeName(attribute) === 'key',
  );
}

/** Whether a branch of an `if` returns markup. */
function returnsView(node: t.Statement | null | undefined): boolean {
  if (node === null || node === undefined) {
    return false;
  }
  if (t.isReturnStatement(node)) {
    return node.argument !== null && node.argument !== undefined && hasView(node.argument);
  }
  if (t.isBlockStatement(node)) {
    return node.body.some((inner) => returnsView(inner));
  }
  return false;
}

/**
 * Whether an expression produces markup.
 *
 * A nested conditional counts, because `a ? (b ? <A /> : <B />) : null` is the
 * same mistake with one more branch — and it is enough to look at one side of
 * it, since a choice between two things is markup as soon as either is.
 */
function hasView(node: t.Node): boolean {
  if (t.isConditionalExpression(node)) {
    return hasView(node.consequent) || hasView(node.alternate);
  }
  return t.isJSXElement(node) || t.isJSXFragment(node);
}

/** Whether an expression reads a signal anywhere inside it. */
function readsSignal(node: t.Node): boolean {
  let found = false;
  const walk = (current: t.Node | null | undefined): void => {
    if (current === null || current === undefined || found) {
      return;
    }
    if (t.isMemberExpression(current)) {
      if (!current.computed && t.isIdentifier(current.property, { name: 'value' })) {
        found = true;
        return;
      }
      walk(current.object);
      return;
    }
    if (t.isUnaryExpression(current)) {
      walk(current.argument);
      return;
    }
    if (t.isBinaryExpression(current) || t.isLogicalExpression(current)) {
      walk(current.left);
      walk(current.right);
      return;
    }
    if (t.isConditionalExpression(current)) {
      walk(current.test);
    }
  };
  walk(node);
  return found;
}

/**
 * Whether an expression is a read and nothing else.
 *
 * Returns false for anything containing a call, which is what keeps the rule
 * from reporting the many legitimate uses of a value read at setup.
 */
function readsOnly(node: t.Node, propsName: string | null): boolean {
  let read = false;
  const walk = (current: t.Node): boolean => {
    if (t.isIdentifier(current) || t.isLiteral(current)) {
      // A template literal carries expressions of its own.
      if (t.isTemplateLiteral(current)) {
        return current.expressions.every((part) => walk(part));
      }
      return true;
    }
    if (t.isMemberExpression(current)) {
      const property = current.property;
      if (!current.computed && t.isIdentifier(property, { name: 'value' })) {
        read = true;
      }
      if (propsName !== null && t.isIdentifier(current.object, { name: propsName })) {
        read = true;
      }
      return walk(current.object) && (!current.computed || walk(property));
    }
    if (t.isUnaryExpression(current)) {
      return walk(current.argument);
    }
    if (t.isBinaryExpression(current) || t.isLogicalExpression(current)) {
      // A private name on the left of `in` is not an expression, and falls
      // through to the refusal below rather than needing a guard here.
      return walk(current.left) && walk(current.right);
    }
    if (t.isConditionalExpression(current)) {
      return walk(current.test) && walk(current.consequent) && walk(current.alternate);
    }
    return false;
  };
  return walk(node) && read;
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
function nameCell(path: NodePath<t.VariableDeclarator>, state: State): void {
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

function isFirsthandImport(binding: { path: NodePath }): boolean {
  const parent = binding.path.parentPath;
  if (!parent.isImportDeclaration()) {
    return false;
  }
  const source = parent.node.source.value;
  return source === CORE || source.startsWith('@firsthandjs/') || source === 'firsthand';
}

function declaredName(path: NodePath<t.CallExpression>): string {
  const parent = path.parentPath;
  if (parent.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
    return parent.node.id.name;
  }
  return 'Component';
}

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
function rewritePropsDestructuring(
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
  const reads: { local: string; access: t.Expression }[] = [];
  const restNames: { local: string; omit: string[] }[] = [];
  collectPattern(param.node, t.cloneNode(propsId), reads, restNames, call, name);

  // Bindings are collected before the parameter is replaced, because replacing
  // it removes them from the scope.
  setup.scope.crawl();
  const references: { paths: NodePath[]; access: t.Expression }[] = [];
  for (const read of [...reads, ...restNames.map((r) => ({ local: r.local, access: propsId }))]) {
    // A destructured parameter always has a binding in its own function scope.
    const binding = setup.scope.getBinding(read.local) as {
      constantViolations: unknown[];
      referencePaths: NodePath[];
    };
    if (binding.constantViolations.length > 0) {
      throw call.buildCodeFrameError(
        `${name}: \`${read.local}\` is destructured from props and then assigned to. Props are ` +
          'readonly; assign to a signal instead.',
      );
    }
    references.push({ paths: binding.referencePaths, access: read.access });
  }

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

  // A rest element needs an object, so it becomes one statement at the top of
  // the body rather than an expression repeated at every use site.
  if (restNames.length > 0) {
    if (!setup.get('body').isBlockStatement()) {
      const body = setup.node.body as t.Expression;
      setup.node.body = t.blockStatement([t.returnStatement(body)]);
    }
    const block = setup.get('body') as NodePath<t.BlockStatement>;
    for (const rest of restNames) {
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
}

/**
 * Walks an object pattern, recording how to reach each binding from `props`.
 *
 * `{ todo }` gives `props.todo`; `{ user: { name } }` gives `props.user.name`;
 * `{ count = 0 }` gives `props.count ?? 0`, which re-applies the default on
 * every read exactly as the language would.
 */
function collectPattern(
  pattern: t.ObjectPattern,
  base: t.Expression,
  reads: { local: string; access: t.Expression }[],
  rests: { local: string; omit: string[] }[],
  call: NodePath<t.CallExpression>,
  name: string,
): void {
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
        access: t.logicalExpression('??', access, value.right),
      });
    } else if (t.isObjectPattern(value)) {
      collectPattern(value, access, reads, rests, call, name);
    } else {
      throw call.buildCodeFrameError(
        `${name}: this destructuring pattern cannot be rewritten into live reads. Take the ` +
          'props object and read from it where you need the value.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// JSX compilation
// ---------------------------------------------------------------------------

function compileNode(path: NodePath<t.JSXElement | t.JSXFragment>, state: State): t.Expression {
  if (path.isJSXFragment()) {
    return t.arrayExpression(compileChildren(path.node.children, state));
  }
  const node = path.node;
  if (isComponentTag(node)) {
    return compileComponent(path, state);
  }
  return state.firsthand.ssr ? compileMarkup(path, state) : compileTemplate(path, state);
}

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
function collectViews(program: NodePath<t.Program>, state: State): void {
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
function isLocalView(path: NodePath<t.JSXElement>, state: State): boolean {
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
function collectRuns(program: NodePath<t.Program>, state: State): void {
  program.traverse({
    CallExpression(call: NodePath<t.CallExpression>) {
      if (!isComponentCall(call)) {
        return;
      }
      const setup = call.get('arguments.0') as NodePath;
      if (!setup.isArrowFunctionExpression() && !setup.isFunctionExpression()) {
        return;
      }
      const found: NodePath<t.Function>[] = [];
      const body = setup.get('body') as NodePath;
      if (!body.isBlockStatement()) {
        if (body.isArrowFunctionExpression() || body.isFunctionExpression()) {
          found.push(body);
        }
      } else {
        body.traverse({
          // A handler or a callback returns its own things; only what the
          // setup itself hands back is the view.
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
      }
      if (found.length === 0) {
        return;
      }
      // An expression body has nowhere to declare a store, so it becomes a
      // block. Nothing else about it changes.
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
        state.firsthand.runs.set(run.node, {
          node: run.node,
          store,
          next: () => index++,
        });
        closeRun(run, store, state);
      }
    },
  });
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
function enclosingRun(path: NodePath, state: State): RunContext | null {
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
function dependsOnRun(node: t.Node, run: RunContext | null, at: NodePath): boolean {
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
    // A property name and an object key are spellings, not references.
    if (t.isMemberExpression(node) && !node.computed && key === 'property') {
      continue;
    }
    if ((t.isObjectProperty(node) || t.isObjectMethod(node)) && !node.computed && key === 'key') {
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
 * Whether a site can be kept between runs.
 *
 * Everything a run needs to write has to be something this compiler knows how
 * to write. A spread, a `ref` or a keyed list is made once by its nature, and
 * making one once out of a value that belongs to a single run would hold that
 * run's value for ever — so such a site is built afresh instead, which is what
 * happens today and is never wrong.
 */
function canRetain(node: t.JSXElement, build: Build): boolean {
  let possible = true;
  const visit = (element: t.JSXElement): void => {
    for (const attribute of element.openingElement.attributes) {
      if (t.isJSXSpreadAttribute(attribute)) {
        if (dependsOnRun(attribute.argument, build.run, build.at)) {
          possible = false;
        }
        continue;
      }
      const value = attribute.value;
      if (
        attributeName(attribute) === 'ref' &&
        t.isJSXExpressionContainer(value) &&
        !t.isJSXEmptyExpression(value.expression) &&
        dependsOnRun(value.expression, build.run, build.at)
      ) {
        possible = false;
      }
    }
    for (const child of element.children) {
      if (t.isJSXElement(child)) {
        if (!isComponentTag(child)) {
          visit(child);
        }
        continue;
      }
      if (
        t.isJSXExpressionContainer(child) &&
        !t.isJSXEmptyExpression(child.expression) &&
        isKeyedList(child.expression) &&
        dependsOnRun(child.expression, build.run, build.at)
      ) {
        possible = false;
      }
    }
  };
  visit(node);
  return possible;
}

/** Whether an expression is the keyed-list call `rewriteKeyedMaps` produced. */
function isKeyedList(node: t.Node): boolean {
  return t.isCallExpression(node) && LIST_CALL in node;
}

function isComponentTag(node: t.JSXElement): boolean {
  const name = node.openingElement.name;
  if (t.isJSXMemberExpression(name)) {
    return true;
  }
  if (!t.isJSXIdentifier(name)) {
    return false;
  }
  return /^[A-Z]/.test(name.name);
}

function tagExpression(name: t.JSXIdentifier | t.JSXMemberExpression): t.Expression {
  if (t.isJSXIdentifier(name)) {
    return t.identifier(name.name);
  }
  return t.memberExpression(tagExpression(name.object), t.identifier(name.property.name));
}

function compileComponent(path: NodePath<t.JSXElement>, state: State): t.Expression {
  const node = path.node;
  const run = enclosingRun(path, state);
  const properties: (t.ObjectProperty | t.ObjectMethod | t.SpreadElement)[] = [];
  /** Declarations that must run before the child is made, and on every run. */
  const cells: t.Statement[] = [];
  const throughCell = (value: t.Expression): t.Expression => {
    const holder = t.identifier(`_cell$${String((run as RunContext).next())}`);
    cells.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          holder,
          t.callExpression(runtime(state, 'cell'), [
            t.cloneNode((run as RunContext).store),
            t.numericLiteral((run as RunContext).next()),
            value,
          ]),
        ),
      ]),
    );
    return t.memberExpression(t.cloneNode(holder), t.identifier('value'));
  };
  for (const attribute of node.openingElement.attributes) {
    if (t.isJSXSpreadAttribute(attribute)) {
      properties.push(t.spreadElement(attribute.argument));
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
      properties.push(t.objectProperty(propertyKey(name), value ?? t.booleanLiteral(true)));
    } else {
      // Dynamic props are accessors, so the child reads them live and its setup
      // function is never re-run (ADR-0005).
      //
      // The `return` carries the position of the expression, so that the line
      // the prop was written on is a line a debugger can stop on — it is where
      // the read that ties a child to a signal actually happens.
      const held = dependsOnRun(value, run, path) ? throughCell(value) : value;
      if (state.firsthand.ssr && isPure(value)) {
        // On a server a prop is read once and nothing can change under it, so
        // an accessor buys only one thing: not evaluating an expression the
        // child never reads. That is worth keeping where evaluating early
        // could be *observed* — a call, an assignment, an await — and worth
        // nothing where it cannot. Reading a name or a member chain cannot,
        // so it is written as a value, which is three times cheaper to build.
        properties.push(t.objectProperty(propertyKey(name), held));
      } else {
        const read = t.returnStatement(held);
        takePosition(read, value);
        properties.push(t.objectMethod('get', propertyKey(name), [], t.blockStatement([read])));
      }
    }
  }
  const children = compileChildren(node.children, state);
  if (children.length === 1) {
    properties.push(
      t.objectMethod(
        'get',
        t.identifier('children'),
        [],
        t.blockStatement([t.returnStatement(children[0])]),
      ),
    );
  } else if (children.length > 1) {
    properties.push(
      t.objectMethod(
        'get',
        t.identifier('children'),
        [],
        t.blockStatement([t.returnStatement(t.arrayExpression(children))]),
      ),
    );
  }
  const tag = tagExpression(node.openingElement.name as t.JSXIdentifier | t.JSXMemberExpression);
  const make = isLocalView(path, state)
    ? t.callExpression(tag, [t.objectExpression(properties)])
    : t.callExpression(runtime(state, 'createComponent'), [tag, t.objectExpression(properties)]);

  if (run !== null) {
    return keptChild(state, run, make, cells);
  }
  if (isLocalView(path, state)) {
    if (state.firsthand.ssr) {
      // A reactive scope is a scope that can run again. This one cannot: the
      // call stands where it is and its markup is the answer.
      return make;
    }
    // A view is a reactive scope. In a child slot the surrounding thunk is
    // already one, so the call goes there as it stands; anywhere else — a
    // return, a variable — it gets a part of its own.
    const parent = path.parentPath;
    if (
      parent.isArrowFunctionExpression() &&
      parent.node.body === node &&
      CHILD_THUNK in parent.node
    ) {
      return make;
    }
    return t.callExpression(runtime(state, 'part'), [t.arrowFunctionExpression([], make)]);
  }
  return make;
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
 * Whether evaluating an expression is something nobody could notice.
 *
 * Names, member chains, literals and the operators over them: reading them
 * early is the same as reading them late. A call is not — it may do anything,
 * including not returning — and neither is anything that writes, waits or
 * constructs. Deliberately conservative: a shape not listed here is treated as
 * observable, which costs an accessor and never a wrong answer.
 */
function isPure(node: t.Expression): boolean {
  switch (node.type) {
    case 'Identifier':
    case 'ThisExpression':
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
    case 'NullLiteral':
    case 'BigIntLiteral':
    case 'RegExpLiteral':
      return true;
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return isPure(node.object as t.Expression) && (!node.computed || isPure(node.property));
    case 'UnaryExpression':
      // `delete` writes. The rest read.
      return node.operator !== 'delete' && isPure(node.argument);
    case 'BinaryExpression':
      return isPure(node.left as t.Expression) && isPure(node.right);
    case 'LogicalExpression':
      return isPure(node.left) && isPure(node.right);
    case 'ConditionalExpression':
      return isPure(node.test) && isPure(node.consequent) && isPure(node.alternate);
    case 'TemplateLiteral':
      return node.expressions.every((one) => t.isExpression(one) && isPure(one));
    case 'ArrayExpression':
      return node.elements.every((one) => one === null || (t.isExpression(one) && isPure(one)));
    case 'ObjectExpression':
      return node.properties.every(
        (one) =>
          t.isObjectProperty(one) &&
          !one.computed &&
          t.isExpression(one.value) &&
          isPure(one.value),
      );
    default:
      return false;
  }
}

function propertyKey(name: string): t.Identifier | t.StringLiteral {
  return t.isValidIdentifier(name) ? t.identifier(name) : t.stringLiteral(name);
}

function attributeName(attribute: t.JSXAttribute): string {
  const name = attribute.name;
  return t.isJSXNamespacedName(name) ? `${name.namespace.name}:${name.name.name}` : name.name;
}

function attributeValue(attribute: t.JSXAttribute): t.Expression | null {
  const value = attribute.value;
  if (value === null || value === undefined) {
    return null;
  }
  if (t.isStringLiteral(value)) {
    return value;
  }
  if (t.isJSXExpressionContainer(value)) {
    // `{}` and `{/* comment */}` are parse errors in an attribute position, so
    // the expression is always a real one here.
    return value.expression as t.Expression;
  }
  throw new Error('An element is not a valid attribute value. Wrap it in braces: attr={<El />}.');
}

function isStaticValue(value: t.Expression): boolean {
  return (
    t.isStringLiteral(value) ||
    t.isNumericLiteral(value) ||
    t.isBooleanLiteral(value) ||
    t.isNullLiteral(value)
  );
}

// ---------------------------------------------------------------------------
// Host elements, for a server render: static parts and the values between them
// ---------------------------------------------------------------------------

/** What a server-rendered element is built from. */
type Markup = {
  /** The static chunks. Always one more than there are values. */
  parts: string[];
  values: t.Expression[];
};

function pushText(markup: Markup, text: string): void {
  // There is always a last part: the list starts with one and every hole adds
  // another after it.
  markup.parts[markup.parts.length - 1] = (markup.parts[markup.parts.length - 1] as string) + text;
}

function pushHole(markup: Markup, value: t.Expression): void {
  markup.values.push(value);
  markup.parts.push('');
}

/**
 * Compiles an element to the markup a server sends.
 *
 * The structure has to be **the same structure** the browser would have built,
 * node for node, or hydration walks into the wrong place: the client navigates
 * a template by `firstChild` and `nextSibling`, and a comment the server left
 * out is a step the client takes anyway. So the decisions here mirror
 * `emitChildren` exactly, including the marker comment after a dynamic child
 * that is not the last one.
 *
 * That mirroring is a promise between two files, which is the kind of promise
 * that rots. It is held by `packages/server/test/parity.test.tsx`, which
 * renders every shape both ways and compares what comes out.
 */
function compileMarkup(path: NodePath<t.JSXElement>, state: State): t.Expression {
  const markup: Markup = { parts: [''], values: [] };
  emitMarkupElement(path.node, markup, state);
  if (markup.values.length === 0) {
    // Nothing dynamic: one string, made once, at module scope.
    return t.callExpression(runtime(state, 'ssr'), [
      t.arrayExpression([t.stringLiteral(markup.parts[0] as string)]),
    ]);
  }
  return t.callExpression(runtime(state, 'ssr'), [
    t.arrayExpression(markup.parts.map((part) => t.stringLiteral(part))),
    ...markup.values,
  ]);
}

function emitMarkupElement(node: t.JSXElement, markup: Markup, state: State): void {
  const name = node.openingElement.name;
  if (!t.isJSXIdentifier(name)) {
    const namespaced = name as t.JSXNamespacedName;
    throw new Error(
      `Namespaced element names are not supported: <${namespaced.namespace.name}:` +
        `${namespaced.name.name}>. Write the element without a ` +
        'namespace; SVG children are resolved by the parser.',
    );
  }
  const tag = name.name;
  pushText(markup, `<${tag}`);
  for (const attribute of node.openingElement.attributes) {
    emitMarkupAttribute(attribute, markup, state);
  }
  pushText(markup, '>');
  emitMarkupChildren(node.children, markup, state);
  if (!VOID_ELEMENTS.has(tag)) {
    pushText(markup, `</${tag}>`);
  }
}

function emitMarkupAttribute(
  attribute: t.JSXAttribute | t.JSXSpreadAttribute,
  markup: Markup,
  state: State,
): void {
  if (t.isJSXSpreadAttribute(attribute)) {
    pushHole(markup, t.callExpression(runtime(state, 'spread'), [attribute.argument]));
    return;
  }

  const name = attributeName(attribute);
  const value = attributeValue(attribute);

  // A ref wants a node and a handler wants a click. Neither exists yet; both
  // are attached when the client takes over.
  if (
    name === 'ref' ||
    (name.startsWith('on') && name.length > 2 && /[A-Z:]/.test(name[2] as string))
  ) {
    return;
  }

  // `key` is an instruction to the reconciler, not an attribute. The DOM path
  // consumes it in `rewriteKeyedMaps`, which a server render does not run —
  // there is one render and nothing to reconcile — so it is dropped here.
  if (name === 'key') {
    return;
  }

  if (value === null) {
    pushText(markup, ` ${name}=""`);
    return;
  }

  if (isStaticValue(value)) {
    if (t.isBooleanLiteral(value) && !value.value) {
      return;
    }
    if (t.isNullLiteral(value)) {
      return;
    }
    const literal = t.isStringLiteral(value)
      ? value.value
      : t.isNumericLiteral(value)
        ? String(value.value)
        : '';
    pushText(markup, ` ${name}="${escapeAttribute(literal)}"`);
    return;
  }

  pushHole(markup, markupAttributeCall(name, value, state));
}

/** The server twin of `dynamicAttributeCall`, kind for kind. */
function markupAttributeCall(name: string, value: t.Expression, state: State): t.Expression {
  if (name.startsWith('prop:')) {
    return t.callExpression(runtime(state, 'setProperty'), [t.stringLiteral(name.slice(5)), value]);
  }
  if (name.startsWith('attr:')) {
    return t.callExpression(runtime(state, 'setAttribute'), [
      t.stringLiteral(name.slice(5)),
      value,
    ]);
  }
  if (name === 'class' || name === 'className') {
    return t.callExpression(runtime(state, 'setClass'), [value]);
  }
  if (name === 'style') {
    return t.callExpression(runtime(state, 'setStyle'), [value]);
  }
  if (BOOLEAN_PROPERTIES.has(name)) {
    return t.callExpression(runtime(state, 'setBoolean'), [t.stringLiteral(name), value]);
  }
  if (DOM_PROPERTIES.has(name)) {
    return t.callExpression(runtime(state, 'setProperty'), [t.stringLiteral(name), value]);
  }
  return t.callExpression(runtime(state, 'setAttribute'), [t.stringLiteral(name), value]);
}

function emitMarkupChildren(
  children: t.JSXElement['children'],
  markup: Markup,
  state: State,
): void {
  const entries = planChildren(children);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as ChildEntry;
    if (entry.kind === 'text') {
      pushText(markup, escapeText(entry.text as string));
      continue;
    }
    if (entry.kind === 'element') {
      emitMarkupElement(entry.element as t.JSXElement, markup, state);
      continue;
    }
    // Where a dynamic child starts cannot always be read off the markup — its
    // content has a length the template does not — so the server says so with
    // `<!--[-->`, which the client removes once it has adopted the region.
    //
    // Except when the child is the whole of its element's content. Then the
    // region is the element's children, which the client can see for itself,
    // and the marker would be a comment in every `<td>` on the page for
    // nothing. It has to be the *whole* content and not merely the first of
    // it: a template with something after the child has a marker there, and
    // the client walks to that marker by stepping over this region — which it
    // can only do if it can see where the region begins.
    //
    // The closing side is the marker the browser's own template has here; a
    // child that is last has none, and the element's end is where it stops.
    if (entries.length > 1) {
      pushText(markup, '<!--[-->');
    }
    pushHole(markup, t.callExpression(runtime(state, 'child'), [entry.expression as t.Expression]));
    if (i !== entries.length - 1) {
      pushText(markup, '<!---->');
    }
  }
}

// ---------------------------------------------------------------------------
// Host elements: template plus parts
// ---------------------------------------------------------------------------

function compileTemplate(path: NodePath<t.JSXElement>, state: State): t.Expression {
  let names = 0;
  const statements: t.Statement[] = [];
  const build: Build = {
    html: [],
    statements,
    // Where a site is built once, these are three lists; where it is not, they
    // are one, and everything simply happens in the order it was written.
    once: statements,
    each: statements,
    run: null,
    at: path,
    next: (() => {
      let n = 0;
      return () => t.identifier(`_el$${String(++n)}`);
    })(),
    name: (prefix: string) => t.identifier(`${prefix}${String(++names)}`),
  };
  // A site is kept between runs when everything the run has to put into it is
  // something this compiler can write. Decided before anything is emitted, so
  // that what is emitted is all of one kind.
  const run = enclosingRun(path, state);
  if (run !== null) {
    build.run = run;
    if (canRetain(path.node, build)) {
      build.once = [];
      build.each = [];
    } else {
      build.run = null;
    }
  }
  const kept = build.run !== null;

  const root = t.identifier('_el$');
  emitElement(path.node, build, root, state);

  const templateId = t.identifier(`_tmpl$${String(++state.firsthand.counter)}`);
  state.firsthand.templates.push(
    t.variableDeclarator(
      templateId,
      t.addComment(
        t.callExpression(runtime(state, 'template'), [t.stringLiteral(build.html.join(''))]),
        'leading',
        '#__PURE__',
      ),
    ),
  );

  if (!kept) {
    const body: t.Statement[] = [
      t.variableDeclaration('const', [
        t.variableDeclarator(root, t.callExpression(t.cloneNode(templateId), [])),
      ]),
      ...build.statements,
      t.returnStatement(t.cloneNode(root)),
    ];
    return t.callExpression(generated(t.arrowFunctionExpression([], t.blockStatement(body))), []);
  }

  // The kept form: the node and everything made with it exist once, and the
  // run walks back to them and writes what has changed.
  const slot = build.name('_site$');
  const fresh = build.name('_new$');
  const held = build.name('_own$');
  // `kept` is exactly the statement that `build.run` is set.
  const owner = build.run as RunContext;
  const body: t.Statement[] = [
    t.variableDeclaration('const', [
      t.variableDeclarator(
        slot,
        t.callExpression(runtime(state, 'site'), [
          t.cloneNode(owner.store),
          t.numericLiteral(owner.next()),
        ]),
      ),
    ]),
    t.variableDeclaration('let', [
      t.variableDeclarator(root, t.memberExpression(t.cloneNode(slot), t.identifier('node'))),
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        fresh,
        t.binaryExpression('===', t.cloneNode(root), t.identifier('undefined')),
      ),
    ]),
    t.variableDeclaration('let', [t.variableDeclarator(held)]),
    t.ifStatement(
      t.cloneNode(fresh),
      t.blockStatement([
        // What this site makes belongs to the instance. A run's own scope is
        // cleared before it runs again, and a part left there would be
        // disposed by the very next run.
        expressionStatement(
          t.assignmentExpression(
            '=',
            t.cloneNode(held),
            t.callExpression(runtime(state, 'open'), [t.cloneNode(owner.store), t.cloneNode(slot)]),
          ),
        ),
        expressionStatement(
          t.assignmentExpression(
            '=',
            t.cloneNode(root),
            t.assignmentExpression(
              '=',
              t.memberExpression(t.cloneNode(slot), t.identifier('node')),
              t.callExpression(t.cloneNode(templateId), []),
            ),
          ),
        ),
      ]),
    ),
    ...build.statements,
    t.ifStatement(
      t.cloneNode(fresh),
      t.blockStatement([
        ...build.once,
        expressionStatement(t.callExpression(runtime(state, 'close'), [t.cloneNode(held)])),
      ]),
    ),
  ];
  body.push(...build.each, t.returnStatement(t.cloneNode(root)));
  return t.callExpression(generated(t.arrowFunctionExpression([], t.blockStatement(body))), []);
}

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
function guardedWrite(
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

function emitElement(node: t.JSXElement, build: Build, self: t.Identifier, state: State): void {
  const name = node.openingElement.name;
  if (!t.isJSXIdentifier(name)) {
    // A member-expression tag is always a component, so only a namespaced name
    // can reach this point.
    const namespaced = name as t.JSXNamespacedName;
    throw new Error(
      `Namespaced element names are not supported: <${namespaced.namespace.name}:` +
        `${namespaced.name.name}>. Write the element without a ` +
        'namespace; SVG children are resolved by the parser.',
    );
  }
  const tag = name.name;
  build.html.push(`<${tag}`);
  const deferred: (() => void)[] = [];
  for (const attribute of node.openingElement.attributes) {
    emitAttribute(attribute, build, self, state, deferred, tag);
  }
  build.html.push('>');
  for (const emit of deferred) {
    emit();
  }
  emitChildren(node.children, build, self, state);
  if (!VOID_ELEMENTS.has(tag)) {
    build.html.push(`</${tag}>`);
  }
}

function emitAttribute(
  attribute: t.JSXAttribute | t.JSXSpreadAttribute,
  build: Build,
  self: t.Identifier,
  state: State,
  deferred: (() => void)[],
  tag: string,
): void {
  if (t.isJSXSpreadAttribute(attribute)) {
    deferred.push(() => {
      pushOnce(
        build,
        expressionStatement(
          t.callExpression(runtime(state, 'bind'), [
            t.arrowFunctionExpression(
              [],
              t.callExpression(runtime(state, 'spread'), [t.cloneNode(self), attribute.argument]),
            ),
          ]),
        ),
      );
    });
    return;
  }

  const name = attributeName(attribute);
  const value = attributeValue(attribute);

  if (name === 'ref') {
    deferred.push(() => {
      // A ref is called with the node it was given, once: `canRetain` has
      // already refused to keep a site whose ref depends on the run.
      pushOnce(
        build,
        expressionStatement(t.callExpression(value as t.Expression, [t.cloneNode(self)])),
      );
    });
    return;
  }

  if (name.startsWith('on') && name.length > 2 && /[A-Z:]/.test(name[2] as string)) {
    const parts = name.split(':');
    // `on:sl-change` takes the name verbatim; `onClick` lowercases. The two
    // forms exist because no casing of an identifier produces the hyphen a
    // web-component library dispatches.
    const literal = parts[0] === 'on';
    const type = literal ? (parts[1] as string) : eventName(parts[0] as string);
    const modifier = parts[literal ? 2 : 1];
    deferred.push(() => {
      const args: t.Expression[] = [
        t.cloneNode(self),
        t.stringLiteral(type),
        value as t.Expression,
      ];
      if (modifier === 'native') {
        args.push(t.booleanLiteral(true));
      } else if (modifier !== undefined) {
        args.push(
          t.objectExpression([t.objectProperty(propertyKey(modifier), t.booleanLiteral(true))]),
        );
      }
      const attach = expressionStatement(t.callExpression(runtime(state, 'on'), args));
      // A handler that closes over something from the run is a new function on
      // every run, and has to replace the one before it — which is what the
      // source says, and what keeps it from ever holding a stale value.
      if (dependsOnRun(value as t.Expression, build.run, build.at)) {
        pushEach(build, attach);
      } else {
        pushOnce(build, attach);
      }
    });
    return;
  }

  if (value !== null && isStaticValue(value) && canInlineAttribute(name)) {
    if (t.isBooleanLiteral(value) && !value.value) {
      return;
    }
    if (t.isNullLiteral(value)) {
      return;
    }
    const literal = t.isStringLiteral(value)
      ? value.value
      : t.isNumericLiteral(value)
        ? String(value.value)
        : '';
    build.html.push(` ${name}="${escapeAttribute(literal)}"`);
    return;
  }
  if (value === null) {
    build.html.push(` ${name}=""`);
    return;
  }

  deferred.push(() => {
    if (dependsOnRun(value, build.run, build.at)) {
      // The run owns this value, so the run writes it — and writes nothing
      // when it produced what is already there.
      guardedWrite(build, state, value, (held) =>
        dynamicAttributeCall(name, held, self, state, tag),
      );
      return;
    }
    pushOnce(
      build,
      expressionStatement(
        t.callExpression(runtime(state, 'bind'), [
          located(
            t.arrowFunctionExpression([], dynamicAttributeCall(name, value, self, state, tag)),
            value,
          ),
        ]),
      ),
    );
  });
}

function canInlineAttribute(name: string): boolean {
  return (
    !name.startsWith('prop:') &&
    !name.startsWith('attr:') &&
    !DOM_PROPERTIES.has(name) &&
    !BOOLEAN_PROPERTIES.has(name)
  );
}

function dynamicAttributeCall(
  name: string,
  value: t.Expression,
  self: t.Identifier,
  state: State,
  tag: string,
): t.Expression {
  if (name.startsWith('prop:')) {
    return t.callExpression(runtime(state, 'setProperty'), [
      t.cloneNode(self),
      t.stringLiteral(name.slice(5)),
      value,
    ]);
  }
  if (name.startsWith('attr:')) {
    return t.callExpression(runtime(state, 'setAttribute'), [
      t.cloneNode(self),
      t.stringLiteral(name.slice(5)),
      value,
    ]);
  }
  if (name === 'class' || name === 'className' || name === 'style') {
    return t.callExpression(runtime(state, 'applyProp'), [
      t.cloneNode(self),
      t.stringLiteral(name),
      value,
    ]);
  }
  if (BOOLEAN_PROPERTIES.has(name)) {
    return t.callExpression(runtime(state, 'setBoolean'), [
      t.cloneNode(self),
      t.stringLiteral(name),
      value,
    ]);
  }
  if (DOM_PROPERTIES.has(name) && !SVG_ELEMENTS.has(tag)) {
    return t.callExpression(runtime(state, 'setProperty'), [
      t.cloneNode(self),
      t.stringLiteral(name),
      value,
    ]);
  }
  return t.callExpression(runtime(state, 'setAttribute'), [
    t.cloneNode(self),
    t.stringLiteral(name),
    value,
  ]);
}

/** Marks a call the map rewrite produced, so it is not wrapped in a thunk. */
const LIST_CALL = Symbol('firsthand.list');

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
function rewriteKeyedMaps(path: NodePath<t.JSXElement | t.JSXFragment>, state: State): void {
  path.traverse({
    CallExpression(call: NodePath<t.CallExpression>) {
      if (!isChildPosition(call)) {
        return;
      }
      const callee = call.node.callee;
      if (
        !t.isMemberExpression(callee) ||
        callee.computed ||
        !t.isIdentifier(callee.property, { name: 'map' }) ||
        call.node.arguments.length !== 1
      ) {
        return;
      }
      const callback = call.get('arguments.0') as NodePath;
      if (!callback.isArrowFunctionExpression() && !callback.isFunctionExpression()) {
        return;
      }
      const params = callback.node.params;
      const itemParam = params[0];
      const indexParam = params[1];
      if (!t.isIdentifier(itemParam) || (indexParam !== undefined && !t.isIdentifier(indexParam))) {
        return;
      }
      const root = keyedRoot(callback);
      if (root === null) {
        return;
      }
      const keyExpression = t.cloneNode(root.key);
      root.element.openingElement.attributes = root.element.openingElement.attributes.filter(
        (attribute) => attribute !== root.attribute,
      );

      const itemCell = callback.scope.generateUidIdentifier('item');
      const indexCell = callback.scope.generateUidIdentifier('index');
      callback.scope.crawl();
      liveRead(callback, itemParam.name, itemCell);
      if (indexParam !== undefined) {
        liveRead(callback, indexParam.name, indexCell);
      }
      callback.node.params = [itemCell, indexCell];

      const listCall = t.callExpression(runtime(state, 'list'), [
        t.arrowFunctionExpression([], callee.object as t.Expression),
        t.arrowFunctionExpression(
          [t.cloneNode(itemParam), indexParam ?? callback.scope.generateUidIdentifier('i')],
          keyExpression,
        ),
        callback.node,
      ]);
      (listCall as unknown as Record<symbol, boolean>)[LIST_CALL] = true;
      call.replaceWith(listCall);
      call.skip();
    },
  });
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

type ChildEntry = {
  kind: 'text' | 'element' | 'dynamic' | 'list';
  text?: string;
  element?: t.JSXElement;
  expression?: t.Expression;
};

function emitChildren(
  children: t.JSXElement['children'],
  build: Build,
  self: t.Identifier,
  state: State,
): void {
  const entries = planChildren(children);
  let previous: t.Identifier | null = null;
  let previousIndex = 0;
  let index = 0;

  const reference = (): t.Identifier => {
    const id = build.next();
    build.statements.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(id, navigate(self, previous, previousIndex, index, state)),
      ]),
    );
    previous = id;
    previousIndex = index;
    return id;
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as ChildEntry;
    if (entry.kind === 'text') {
      build.html.push(escapeText(entry.text as string));
      index++;
      continue;
    }
    if (entry.kind === 'element') {
      const element = entry.element as t.JSXElement;
      if (needsReference(element)) {
        const id = reference();
        emitElement(element, build, id, state);
      } else {
        emitElement(element, build, t.identifier('_unused$'), state);
      }
      index++;
      continue;
    }
    const isLast = i === entries.length - 1;
    const expression = entry.expression as t.Expression;
    let marker: t.Expression | null = null;
    if (!isLast) {
      build.html.push('<!>');
      marker = t.cloneNode(reference());
    }
    if (entry.kind !== 'list' && dependsOnRun(expression, build.run, build.at)) {
      // Written by the run, into the place it wrote last time.
      const run = build.run as RunContext;
      pushEach(
        build,
        expressionStatement(
          t.callExpression(runtime(state, 'writeChild'), [
            t.cloneNode(run.store),
            t.numericLiteral(run.next()),
            t.cloneNode(self),
            marker ?? t.nullLiteral(),
            expression,
          ]),
        ),
      );
      index++;
      continue;
    }
    const args: t.Expression[] = [
      t.cloneNode(self),
      // A list part is already a thunk that owns its rows; wrapping it would
      // rebuild the whole list on every evaluation.
      entry.kind === 'list' ? expression : thunk(expression),
    ];
    if (marker !== null) {
      args.push(marker);
    }
    // The call is deliberately left without a position, and only the thunk
    // inside it carries one. Both would map to `{value}`, and a debugger takes
    // the first location on a line — which would be this call, and it runs
    // once, when the part is created. The thunk runs on every update, which is
    // where a breakpoint on that expression is expected to stop.
    pushOnce(build, expressionStatement(t.callExpression(runtime(state, 'insert'), args)));
    index++;
  }
}

/** Whether this element needs a variable: it has parts, or a descendant does. */
function needsReference(element: t.JSXElement): boolean {
  for (const attribute of element.openingElement.attributes) {
    if (t.isJSXSpreadAttribute(attribute)) {
      return true;
    }
    const name = attributeName(attribute);
    if (name === 'ref' || name.startsWith('on')) {
      return true;
    }
    const value = attributeValue(attribute);
    if (value !== null && (!isStaticValue(value) || !canInlineAttribute(name))) {
      return true;
    }
  }
  for (const entry of planChildren(element.children)) {
    if (entry.kind === 'dynamic' || entry.kind === 'list') {
      return true;
    }
    if (entry.kind === 'element' && needsReference(entry.element as t.JSXElement)) {
      return true;
    }
  }
  return false;
}

/**
 * The step from one template node to the next.
 *
 * `.firstChild` and `.nextSibling` in an ordinary build: the template is a
 * clone and nothing has been inserted into it yet, so the shape the compiler
 * planned is the shape that is there.
 *
 * A build that can hydrate goes through `first` and `next` instead, because
 * then the nodes may be a server's and the dynamic children already have
 * content. The helpers step over a whole region in one move. Outside a
 * hydration they are the property reads, behind one comparison — which is why
 * this is an option and not the default: an application that never renders on
 * a server pays nothing for the one that does.
 */
function navigate(
  self: t.Identifier,
  previous: t.Identifier | null,
  previousIndex: number,
  index: number,
  state: State,
): t.Expression {
  const hydratable = state.firsthand.hydratable;
  const first = hydratable ? runtime(state, 'first') : null;
  const next = hydratable ? runtime(state, 'next') : null;
  let expression: t.Expression;
  let steps: number;
  if (previous === null) {
    expression = hydratable
      ? t.callExpression(first as t.Identifier, [t.cloneNode(self)])
      : t.memberExpression(t.cloneNode(self), t.identifier('firstChild'));
    steps = index;
  } else {
    expression = t.cloneNode(previous);
    steps = index - previousIndex;
  }
  for (let i = 0; i < steps; i++) {
    expression = hydratable
      ? t.callExpression(next as t.Identifier, [expression])
      : t.memberExpression(expression, t.identifier('nextSibling'));
  }
  return expression;
}

/**
 * Groups JSX children into DOM nodes.
 *
 * Adjacent text and static expressions merge into one text node, which is what
 * the HTML parser will produce, so child indices stay correct.
 */
function planChildren(children: t.JSXElement['children']): ChildEntry[] {
  const entries: ChildEntry[] = [];
  let pending = '';
  const flush = (): void => {
    if (pending !== '') {
      entries.push({ kind: 'text', text: pending });
      pending = '';
    }
  };
  for (const child of children) {
    if (t.isJSXText(child)) {
      pending += cleanText(child.value);
      continue;
    }
    if (t.isJSXExpressionContainer(child)) {
      const expression = child.expression;
      if (t.isJSXEmptyExpression(expression)) {
        continue;
      }
      if (t.isStringLiteral(expression) || t.isNumericLiteral(expression)) {
        pending += String(expression.value);
        continue;
      }
      flush();
      const isList = (expression as unknown as Record<symbol, boolean>)[LIST_CALL] === true;
      entries.push({ kind: isList ? 'list' : 'dynamic', expression });
      continue;
    }
    flush();
    if (t.isJSXElement(child) && !isComponentTag(child)) {
      entries.push({ kind: 'element', element: child });
      continue;
    }
    // A component or a fragment in child position is a dynamic slot.
    entries.push({ kind: 'dynamic', expression: child as unknown as t.Expression });
  }
  flush();
  return entries;
}

/** JSX whitespace rules: drop whitespace-only lines, collapse line breaks. */
function cleanText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] as string;
    if (i > 0) {
      line = line.replace(/^[\t ]+/, '');
    }
    if (i < lines.length - 1) {
      line = line.replace(/[\t ]+$/, '');
    }
    if (line !== '') {
      kept.push(line);
    }
  }
  return kept.join(' ');
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
function compileChildren(children: t.JSXElement['children'], state: State): t.Expression[] {
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
function thunk(expression: t.Expression): t.ArrowFunctionExpression {
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
function takePosition(target: t.Node, expression: t.Expression): void {
  const loc = expression.loc;
  if (loc !== null && loc !== undefined) {
    target.loc = { ...loc, end: loc.start };
    expression.loc = null;
  }
}

function expressionStatement(expression: t.Expression): t.Statement {
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
function located<T extends t.Node>(node: T, source: t.Node | null | undefined): T {
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
