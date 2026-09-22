/**
 * The four things strict reactivity refuses to compile (ADR-0019).
 *
 * Every rule here stops a build, so every rule here is deliberately narrow:
 * a false positive costs somebody a working program, and a false negative
 * costs them the warning they would have got anyway the first time they looked
 * at the screen. Where a shape could go either way, it is allowed.
 *
 * All four are *refusals*. Nothing in this module rewrites anything.
 */

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

import { LIST_CALL } from './marks.js';

import { attributeName, isFirsthandImport } from './nodes.js';

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
export function checkKeptReads(setup: NodePath<t.Function>, name: string): void {
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
export function checkDecidedOnce(setup: NodePath<t.Function>, name: string): void {
  const body = setup.get('body');
  if (!body.isBlockStatement()) {
    checkChoice(setup.node.body, body, name);
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
        checkChoice(returned, statement, name);
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
        reportDecidedOnce(statement.get('test'), name);
      }
    },
  });
}

/** A returned expression that decides between views from a live read. */
function checkChoice(returned: t.Node, at: NodePath, name: string): void {
  if (t.isConditionalExpression(returned)) {
    if (!hasView(returned.consequent) && !hasView(returned.alternate)) {
      return;
    }
    if (readsSignal(returned.test)) {
      reportDecidedOnce(at, name);
    }
    return;
  }
  if (t.isLogicalExpression(returned) && returned.operator !== '??') {
    if (!hasView(returned.right) && !hasView(returned.left)) {
      return;
    }
    if (readsSignal(returned.left)) {
      reportDecidedOnce(at, name);
    }
  }
}

function reportDecidedOnce(at: NodePath, name: string): never {
  throw at.buildCodeFrameError(
    `${name}: this view is chosen once, here, from a value that changes. A setup ` +
      'runs one time per instance, so the other branch will never appear.' +
      '\n\nEither put the choice inside the markup, where it is a part:' +
      '\n\n  return <>{open.value ? <A /> : <B />}</>;' +
      '\n\nor return a render function, which is a reactive scope of its own ' +
      'and may use ordinary control flow:' +
      '\n\n  return () => (open.value ? <A /> : <B />);',
  );
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
export function checkRunBody(setup: NodePath<t.Function>, name: string): void {
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
  const found = { read: false };
  return walkRead(node, propsName, found) && found.read;
}

/**
 * Whether every part of an expression is a read, noting whether any of them
 * read a signal or a prop.
 *
 * Split from `readsOnly` because the recursion needs the flag and the caller
 * needs the answer, and one function doing both was one branch per node type
 * plus the bookkeeping.
 */
function walkRead(current: t.Node, propsName: string | null, found: { read: boolean }): boolean {
  if (t.isTemplateLiteral(current)) {
    // A template literal is a literal that carries expressions of its own.
    return current.expressions.every((part) => walkRead(part, propsName, found));
  }
  if (t.isIdentifier(current) || t.isLiteral(current)) {
    return true;
  }
  if (t.isMemberExpression(current)) {
    return walkMember(current, propsName, found);
  }
  if (t.isUnaryExpression(current)) {
    return walkRead(current.argument, propsName, found);
  }
  if (t.isBinaryExpression(current) || t.isLogicalExpression(current)) {
    // A private name on the left of `in` is not an expression, and falls
    // through to the refusal below rather than needing a guard here.
    return walkRead(current.left, propsName, found) && walkRead(current.right, propsName, found);
  }
  if (t.isConditionalExpression(current)) {
    return (
      walkRead(current.test, propsName, found) &&
      walkRead(current.consequent, propsName, found) &&
      walkRead(current.alternate, propsName, found)
    );
  }
  return false;
}

/** `x.value` and `props.anything` are the two reads this rule is about. */
function walkMember(
  current: t.MemberExpression,
  propsName: string | null,
  found: { read: boolean },
): boolean {
  const property = current.property;
  if (!current.computed && t.isIdentifier(property, { name: 'value' })) {
    found.read = true;
  }
  if (propsName !== null && t.isIdentifier(current.object, { name: propsName })) {
    found.read = true;
  }
  return (
    walkRead(current.object, propsName, found) &&
    (!current.computed || walkRead(property, propsName, found))
  );
}
