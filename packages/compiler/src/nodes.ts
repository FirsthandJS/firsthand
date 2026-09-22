/**
 * What a node is, asked of the node.
 *
 * Small, total questions about a Babel AST: is this tag a component, is this
 * value static, what is this attribute called. Nothing here reads the
 * compiler's state or emits anything, which is what makes them safe to call
 * from any pass — and why they are in one module rather than repeated in
 * three.
 */

import type { NodePath } from '@babel/traverse';

import * as t from '@babel/types';

import { BOOLEAN_PROPERTIES, DOM_PROPERTIES } from './html.js';

import { LIST_CALL } from './marks.js';

const CORE = '@firsthandjs/core';

export function isComponentTag(node: t.JSXElement): boolean {
  const name = node.openingElement.name;
  if (t.isJSXMemberExpression(name)) {
    return true;
  }
  if (!t.isJSXIdentifier(name)) {
    return false;
  }
  return /^[A-Z]/.test(name.name);
}

export function tagExpression(name: t.JSXIdentifier | t.JSXMemberExpression): t.Expression {
  if (t.isJSXIdentifier(name)) {
    return t.identifier(name.name);
  }
  return t.memberExpression(tagExpression(name.object), t.identifier(name.property.name));
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
export function isPure(node: t.Expression): boolean {
  if (PURE_LEAVES.has(node.type)) {
    return true;
  }
  const parts = PURE_PARTS.get(node.type)?.(node);
  if (parts == null) {
    return false;
  }
  // A hole in an array literal evaluates to nothing, so there is nothing to
  // notice about it.
  return parts.every((part) => part == null || (t.isExpression(part) && isPure(part)));
}

/** Evaluating one of these is a read and nothing else. */
const PURE_LEAVES = new Set<string>([
  'Identifier',
  'ThisExpression',
  'StringLiteral',
  'NumericLiteral',
  'BooleanLiteral',
  'NullLiteral',
  'BigIntLiteral',
  'RegExpLiteral',
]);

/**
 * Every other shape that *can* be pure, and the parts of it that all have to
 * be. `null` says the shape is observable however its parts turn out, which is
 * what `delete` and a computed object key are.
 *
 * A table rather than a chain because the set is open: a new syntax is a row,
 * not an edit to a function that already knows about nine others. A shape
 * absent from it is treated as observable, which costs an accessor and never a
 * wrong answer.
 */
const PURE_PARTS = new Map<string, (node: t.Expression) => readonly (t.Node | null)[] | null>([
  ['MemberExpression', memberParts],
  ['OptionalMemberExpression', memberParts],
  ['UnaryExpression', unaryParts],
  [
    'BinaryExpression',
    (node) => [(node as t.BinaryExpression).left, (node as t.BinaryExpression).right],
  ],
  [
    'LogicalExpression',
    (node) => [(node as t.LogicalExpression).left, (node as t.LogicalExpression).right],
  ],
  [
    'ConditionalExpression',
    (node) => {
      const conditional = node as t.ConditionalExpression;
      return [conditional.test, conditional.consequent, conditional.alternate];
    },
  ],
  ['TemplateLiteral', (node) => (node as t.TemplateLiteral).expressions],
  ['ArrayExpression', (node) => (node as t.ArrayExpression).elements],
  ['ObjectExpression', objectParts],
]);

function memberParts(node: t.Expression): readonly t.Node[] {
  const member = node as t.MemberExpression;
  return member.computed ? [member.object, member.property] : [member.object];
}

function unaryParts(node: t.Expression): readonly t.Node[] | null {
  const unary = node as t.UnaryExpression;
  // `delete` writes. The rest read.
  return unary.operator === 'delete' ? null : [unary.argument];
}

/** The values of a plain object literal, or `null` if it is not one. */
function objectParts(node: t.Expression): readonly t.Node[] | null {
  const values: t.Node[] = [];
  for (const property of (node as t.ObjectExpression).properties) {
    if (!t.isObjectProperty(property) || property.computed) {
      return null;
    }
    values.push(property.value);
  }
  return values;
}

export function propertyKey(name: string): t.Identifier | t.StringLiteral {
  return t.isValidIdentifier(name) ? t.identifier(name) : t.stringLiteral(name);
}

export function attributeName(attribute: t.JSXAttribute): string {
  const name = attribute.name;
  return t.isJSXNamespacedName(name) ? `${name.namespace.name}:${name.name.name}` : name.name;
}

export function attributeValue(attribute: t.JSXAttribute): t.Expression | null {
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

export function isStaticValue(value: t.Expression): boolean {
  return (
    t.isStringLiteral(value) ||
    t.isNumericLiteral(value) ||
    t.isBooleanLiteral(value) ||
    t.isNullLiteral(value)
  );
}

export function canInlineAttribute(name: string): boolean {
  return (
    !name.startsWith('prop:') &&
    !name.startsWith('attr:') &&
    !DOM_PROPERTIES.has(name) &&
    !BOOLEAN_PROPERTIES.has(name)
  );
}

export function isFirsthandImport(binding: { path: NodePath }): boolean {
  const parent = binding.path.parentPath;
  if (!parent.isImportDeclaration()) {
    return false;
  }
  const source = parent.node.source.value;
  return source === CORE || source.startsWith('@firsthandjs/') || source === 'firsthand';
}

export function declaredName(path: NodePath<t.CallExpression>): string {
  const parent = path.parentPath;
  if (parent.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
    return parent.node.id.name;
  }
  return 'Component';
}

export type ChildEntry = {
  kind: 'text' | 'element' | 'dynamic' | 'list';
  text?: string;
  element?: t.JSXElement;
  expression?: t.Expression;
};

/**
 * Groups JSX children into DOM nodes.
 *
 * Adjacent text and static expressions merge into one text node, which is what
 * the HTML parser will produce, so child indices stay correct.
 */
export function planChildren(children: t.JSXElement['children']): ChildEntry[] {
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
 * The text a static attribute value stands for.
 *
 * `false` and `null` are absences rather than values — an attribute written
 * with either is not written at all — so they are `null` here and the caller
 * omits the attribute. Both paths need this and have to agree: a value the
 * server writes and the browser omits is a hydration mismatch.
 */
export function staticLiteral(value: t.Expression): string | null {
  if (t.isStringLiteral(value)) {
    return value.value;
  }
  if (t.isNumericLiteral(value)) {
    return String(value.value);
  }
  if (t.isBooleanLiteral(value)) {
    return value.value ? '' : null;
  }
  return null;
}
