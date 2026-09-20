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
const CORE = '@firsthandjs/core';

interface FirsthandState {
  imports: Map<string, t.Identifier>;
  templates: t.VariableDeclarator[];
  counter: number;
  moduleId: string;
}

declare module '@babel/core' {
  interface PluginPass {
    firsthand: FirsthandState;
  }
}

type State = PluginPass;

interface Build {
  html: string[];
  statements: t.Statement[];
  next: () => t.Identifier;
}

export interface FirsthandPluginOptions {
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
}

export default function firsthandPlugin(
  _api: unknown,
  options: FirsthandPluginOptions = {},
): PluginObject {
  return {
    name: 'firsthand',
    visitor: {
      Program: {
        enter(_path: NodePath<t.Program>, state: State) {
          state.firsthand = {
            imports: new Map(),
            templates: [],
            counter: 0,
            moduleId: stableId(options.packageName ?? 'app', state.filename ?? 'module'),
          };
        },
        exit(path: NodePath<t.Program>, state: State) {
          const { imports, templates } = state.firsthand;
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
        rewriteKeyedMaps(path, state);
        path.replaceWith(compileNode(path, state));
      },

      JSXFragment(path: NodePath<t.JSXFragment>, state: State) {
        rewriteKeyedMaps(path, state);
        path.replaceWith(compileNode(path, state));
      },

      CallExpression(path: NodePath<t.CallExpression>, state: State) {
        annotateComponent(path, state, options);
      },

      VariableDeclarator(path: NodePath<t.VariableDeclarator>, state: State) {
        if (options.devtools === true) {
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

function runtime(state: State, name: string, source = RUNTIME): t.Identifier {
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
    checkKeptReads(path.get('arguments.0') as NodePath<t.Function>, name);
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
  return compileTemplate(path, state);
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
  const properties: (t.ObjectProperty | t.ObjectMethod | t.SpreadElement)[] = [];
  for (const attribute of node.openingElement.attributes) {
    if (t.isJSXSpreadAttribute(attribute)) {
      properties.push(t.spreadElement(attribute.argument));
      continue;
    }
    const name = attributeName(attribute);
    const value = attributeValue(attribute);
    if (value === null || isStaticValue(value)) {
      properties.push(t.objectProperty(propertyKey(name), value ?? t.booleanLiteral(true)));
    } else {
      // Dynamic props are accessors, so the child reads them live and its setup
      // function is never re-run (ADR-0005).
      properties.push(
        t.objectMethod('get', propertyKey(name), [], t.blockStatement([t.returnStatement(value)])),
      );
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
  return t.callExpression(runtime(state, 'createComponent'), [
    // `isComponentTag` has already excluded namespaced names.
    tagExpression(node.openingElement.name as t.JSXIdentifier | t.JSXMemberExpression),
    t.objectExpression(properties),
  ]);
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
// Host elements: template plus parts
// ---------------------------------------------------------------------------

function compileTemplate(path: NodePath<t.JSXElement>, state: State): t.Expression {
  const build: Build = {
    html: [],
    statements: [],
    next: (() => {
      let n = 0;
      return () => t.identifier(`_el$${String(++n)}`);
    })(),
  };
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

  const body: t.Statement[] = [
    t.variableDeclaration('const', [
      t.variableDeclarator(root, t.callExpression(t.cloneNode(templateId), [])),
    ]),
    ...build.statements,
    t.returnStatement(t.cloneNode(root)),
  ];
  return t.callExpression(t.arrowFunctionExpression([], t.blockStatement(body)), []);
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
      build.statements.push(
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
      build.statements.push(
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
      build.statements.push(expressionStatement(t.callExpression(runtime(state, 'on'), args)));
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
    build.statements.push(
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

interface KeyedRoot {
  element: t.JSXElement;
  attribute: t.JSXAttribute;
  key: t.Expression;
}

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

interface ChildEntry {
  kind: 'text' | 'element' | 'dynamic' | 'list';
  text?: string;
  element?: t.JSXElement;
  expression?: t.Expression;
}

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
        t.variableDeclarator(id, navigate(self, previous, previousIndex, index)),
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
    const args: t.Expression[] = [
      t.cloneNode(self),
      // A list part is already a thunk that owns its rows; wrapping it would
      // rebuild the whole list on every evaluation.
      entry.kind === 'list'
        ? (entry.expression as t.Expression)
        : located(
            t.arrowFunctionExpression([], entry.expression as t.Expression),
            entry.expression as t.Expression,
          ),
    ];
    if (!isLast) {
      build.html.push('<!>');
      const id = reference();
      args.push(t.cloneNode(id));
    }
    build.statements.push(
      expressionStatement(
        located(t.callExpression(runtime(state, 'insert'), args), entry.expression as t.Expression),
      ),
    );
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

function navigate(
  self: t.Identifier,
  previous: t.Identifier | null,
  previousIndex: number,
  index: number,
): t.Expression {
  let expression: t.Expression;
  let steps: number;
  if (previous === null) {
    expression = t.memberExpression(t.cloneNode(self), t.identifier('firstChild'));
    steps = index;
  } else {
    expression = t.cloneNode(previous);
    steps = index - previousIndex;
  }
  for (let i = 0; i < steps; i++) {
    expression = t.memberExpression(expression, t.identifier('nextSibling'));
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
    } else if (entry.kind === 'list') {
      result.push(t.callExpression(runtime(state, 'part'), [entry.expression as t.Expression]));
    } else {
      result.push(
        t.callExpression(runtime(state, 'part'), [
          t.arrowFunctionExpression([], entry.expression as t.Expression),
        ]),
      );
    }
  }
  return result;
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
