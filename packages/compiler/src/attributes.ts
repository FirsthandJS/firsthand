/**
 * One attribute, for the browser: inlined into the template when it can be,
 * and emitted as a write when it cannot.
 *
 * Five kinds, and `emitAttribute` does nothing but pick between them. The
 * server's twin of this decision is in `markup.ts`, kind for kind. They are two
 * files that have to agree, and `packages/server/test/parity.test.tsx` is what
 * holds them to it.
 */

import * as t from '@babel/types';

import {
  BOOLEAN_PROPERTIES,
  DOM_PROPERTIES,
  SVG_ELEMENTS,
  escapeAttribute,
  eventName,
  isEventName,
} from './html.js';

import { guardedWrite } from './guarded.js';

import { located, expressionStatement } from './positions.js';

import {
  attributeName,
  attributeValue,
  canInlineAttribute,
  isStaticValue,
  propertyKey,
  staticLiteral,
} from './nodes.js';

import { dependsOnRun } from './runs.js';

import { pushEach, pushOnce, runtime, type Host } from './state.js';

export function emitAttribute(attribute: t.JSXAttribute | t.JSXSpreadAttribute, host: Host): void {
  if (t.isJSXSpreadAttribute(attribute)) {
    host.deferred.push(() => {
      emitSpread(attribute.argument, host);
    });
    return;
  }

  const name = attributeName(attribute);
  const value = attributeValue(attribute);

  if (name === 'ref') {
    host.deferred.push(() => {
      emitRef(value as t.Expression, host);
    });
    return;
  }

  if (isEventName(name)) {
    host.deferred.push(() => {
      emitListener(name, value as t.Expression, host);
    });
    return;
  }

  if (value !== null && isStaticValue(value) && canInlineAttribute(name)) {
    const literal = staticLiteral(value);
    if (literal !== null) {
      host.build.html.push(` ${name}="${escapeAttribute(literal)}"`);
    }
    return;
  }
  if (value === null) {
    host.build.html.push(` ${name}=""`);
    return;
  }

  host.deferred.push(() => {
    emitDynamic(name, value, host);
  });
}

function emitSpread(argument: t.Expression, host: Host): void {
  const { build, self, state } = host;
  pushOnce(
    build,
    expressionStatement(
      t.callExpression(runtime(state, 'bind'), [
        t.arrowFunctionExpression(
          [],
          t.callExpression(runtime(state, 'spread'), [t.cloneNode(self), argument]),
        ),
      ]),
    ),
  );
}

function emitRef(value: t.Expression, host: Host): void {
  // A ref is called with the node it was given, once: `canRetain` has already
  // refused to keep a site whose ref depends on the run.
  pushOnce(host.build, expressionStatement(t.callExpression(value, [t.cloneNode(host.self)])));
}

function emitListener(name: string, value: t.Expression, host: Host): void {
  const { build, self, state } = host;
  const parts = name.split(':');
  // `on:sl-change` takes the name verbatim; `onClick` lowercases. The two forms
  // exist because no casing of an identifier produces the hyphen a
  // web-component library dispatches.
  const literal = parts[0] === 'on';
  const type = literal ? (parts[1] as string) : eventName(parts[0] as string);
  const modifier = parts[literal ? 2 : 1];
  const args: t.Expression[] = [t.cloneNode(self), t.stringLiteral(type), value];
  if (modifier === 'native') {
    args.push(t.booleanLiteral(true));
  } else if (modifier !== undefined) {
    args.push(
      t.objectExpression([t.objectProperty(propertyKey(modifier), t.booleanLiteral(true))]),
    );
  }
  const attach = expressionStatement(t.callExpression(runtime(state, 'on'), args));
  // A handler that closes over something from the run is a new function on
  // every run, and has to replace the one before it — which is what the source
  // says, and what keeps it from ever holding a stale value.
  if (dependsOnRun(value, build.run, build.at)) {
    pushEach(build, attach);
  } else {
    pushOnce(build, attach);
  }
}

function emitDynamic(name: string, value: t.Expression, host: Host): void {
  const { build, state } = host;
  if (dependsOnRun(value, build.run, build.at)) {
    // The run owns this value, so the run writes it — and writes nothing when
    // it produced what is already there.
    guardedWrite(build, state, value, (held) => dynamicAttributeCall(name, held, host));
    return;
  }
  pushOnce(
    build,
    expressionStatement(
      t.callExpression(runtime(state, 'bind'), [
        located(t.arrowFunctionExpression([], dynamicAttributeCall(name, value, host)), value),
      ]),
    ),
  );
}

/**
 * Which runtime call writes this attribute.
 *
 * The order is the order of specificity: an explicit `prop:`/`attr:` prefix
 * first, then the three the platform treats specially, then the tables, then
 * the general case. Every branch is a name the server's `markupAttributeCall`
 * also answers for.
 */
function dynamicAttributeCall(name: string, value: t.Expression, host: Host): t.Expression {
  const { self, state, tag } = host;
  const call = (runtimeName: string, attribute: string): t.Expression =>
    t.callExpression(runtime(state, runtimeName), [
      t.cloneNode(self),
      t.stringLiteral(attribute),
      value,
    ]);
  if (name.startsWith('prop:')) {
    return call('setProperty', name.slice(5));
  }
  if (name.startsWith('attr:')) {
    return call('setAttribute', name.slice(5));
  }
  if (name === 'class' || name === 'className' || name === 'style') {
    return call('applyProp', name);
  }
  if (BOOLEAN_PROPERTIES.has(name)) {
    return call('setBoolean', name);
  }
  // An SVG element has no DOM property for `width`; the attribute is the only
  // way in.
  if (DOM_PROPERTIES.has(name) && !SVG_ELEMENTS.has(tag)) {
    return call('setProperty', name);
  }
  return call('setAttribute', name);
}
