/**
 * The site a template occupies, in its two forms.
 *
 * Built every time it is reached, or built once and written into afterwards —
 * which one is decided before anything is emitted, so that what comes out is
 * all of one kind (ADR-0026).
 */

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

import { generated } from './marks.js';

import { expressionStatement } from './positions.js';

import { canRetain, enclosingRun } from './runs.js';

import { runtime, type Build, type RunContext, type State } from './state.js';

import { emitElement } from './template.js';

export function compileTemplate(path: NodePath<t.JSXElement>, state: State): t.Expression {
  const build = newBuild(path, state);
  const root = t.identifier('_el$');
  emitElement(path.node, build, root, state);
  const templateId = registerTemplate(build, state);
  // `build.run` is set exactly when the site is kept.
  const body =
    build.run === null
      ? freshForm(root, templateId, build)
      : keptForm(root, templateId, build, state);
  return t.callExpression(generated(t.arrowFunctionExpression([], t.blockStatement(body))), []);
}

/**
 * The lists a template is emitted into, and whether it will be kept.
 *
 * A site is kept between runs when everything the run has to put into it is
 * something this compiler can write. Decided before anything is emitted, so
 * that what is emitted is all of one kind: where a site is built once, `once`
 * and `each` are separate lists; where it is not, all three are the same one
 * and everything simply happens in the order it was written.
 */
function newBuild(path: NodePath<t.JSXElement>, state: State): Build {
  let names = 0;
  const statements: t.Statement[] = [];
  const build: Build = {
    html: [],
    statements,
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
  const run = enclosingRun(path, state);
  if (run !== null) {
    // Set before the question is asked, not after it is answered: `canRetain`
    // decides by asking whether values belong to *this* run, and with no run in
    // the build the answer is always "no" and every site looks retainable.
    build.run = run;
    if (canRetain(path.node, build)) {
      build.once = [];
      build.each = [];
    } else {
      build.run = null;
    }
  }
  return build;
}

/** Declares the template at module scope and hands back the name to clone. */
function registerTemplate(build: Build, state: State): t.Identifier {
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
  return templateId;
}

/** Built every time it is reached: clone, fill, hand back. */
function freshForm(root: t.Identifier, templateId: t.Identifier, build: Build): t.Statement[] {
  return [
    t.variableDeclaration('const', [
      t.variableDeclarator(root, t.callExpression(t.cloneNode(templateId), [])),
    ]),
    ...build.statements,
    t.returnStatement(t.cloneNode(root)),
  ];
}

/**
 * Built once: the node and everything made with it exist for the life of the
 * instance, and each run walks back to them and writes what has changed.
 */
function keptForm(
  root: t.Identifier,
  templateId: t.Identifier,
  build: Build,
  state: State,
): t.Statement[] {
  const kept: Kept = {
    root,
    templateId,
    slot: build.name('_site$'),
    fresh: build.name('_new$'),
    held: build.name('_own$'),
    owner: build.run as RunContext,
  };
  return [
    ...keptPrologue(kept, state),
    ...build.statements,
    t.ifStatement(
      t.cloneNode(kept.fresh),
      t.blockStatement([
        ...build.once,
        expressionStatement(t.callExpression(runtime(state, 'close'), [t.cloneNode(kept.held)])),
      ]),
    ),
    ...build.each,
    t.returnStatement(t.cloneNode(kept.root)),
  ];
}

/** The names a kept site needs, and the run that owns it. */
type Kept = {
  root: t.Identifier;
  templateId: t.Identifier;
  /** The store slot the node is remembered in. */
  slot: t.Identifier;
  /** Whether this run is the one that made it. */
  fresh: t.Identifier;
  /** The scope what the site makes belongs to. */
  held: t.Identifier;
  owner: RunContext;
};

/** Finds the site, and makes it if this is the run that gets to. */
function keptPrologue(kept: Kept, state: State): t.Statement[] {
  const { root, slot, fresh, held, owner, templateId } = kept;
  return [
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
        // cleared before it runs again, and a part left there would be disposed
        // by the very next run.
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
  ];
}
