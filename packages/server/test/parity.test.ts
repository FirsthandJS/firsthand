/**
 * The same component, rendered twice, compared.
 *
 * `@firsthandjs/server` and `@firsthandjs/dom` are two implementations of one
 * set of semantics, and a promise like that kept by careful reading rots the
 * first time somebody edits one file. So it is kept by this suite instead:
 * every fixture in `compiled/fixtures.tsx` is rendered by the browser runtime
 * and by the server runtime, and the two trees have to be the same tree.
 *
 * "The same tree" is what hydration actually needs, which is not the same as
 * byte-identical markup. The client writes `node.checked = true` and leaves no
 * attribute; the server can only write `checked=""` and let the parser produce
 * the property. Both arrive at an input that is checked. So the comparison is
 * made over the tree the browser ends up with: tag names, the order and kind
 * of every node, attributes, and the properties the DOM layer writes as
 * properties.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent, render, type Component } from '@firsthandjs/dom';
import { createComponent as createServerComponent } from '@firsthandjs/server/internal';
import { renderToString } from '@firsthandjs/server';
import { inside as childrenOf } from './tree.js';
import * as client from './compiled/fixtures.js';
// The same file, compiled for a server render. See `vitest.config.ts`.
import * as serverModule from './compiled/fixtures.js?server';

const server = serverModule as unknown as typeof client;

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
});

/** What the browser builds. */
function onClient(target: Component<unknown>, props: unknown): string {
  const host = document.createElement('div');
  document.body.append(host);
  disposers.push(render(() => createComponent(target, props), host));
  const html = childrenOf(host, { joinText: true });
  host.remove();
  return html;
}

/** What the server sends, as the browser parses it. */
function onServer(target: Component<unknown>, props: unknown): string {
  const html = renderToString(() => createServerComponent(target as never, props));
  const host = document.createElement('div');
  host.innerHTML = html;
  return childrenOf(host, { joinText: true });
}

function parity(name: keyof typeof client, props: unknown): void {
  it(`renders ${name} the same`, () => {
    const target = client[name] as unknown as Component<unknown>;
    const other = server[name] as unknown as Component<unknown>;
    expect(onServer(other, props)).toBe(onClient(target, props));
  });
}

describe('server and client render the same tree', () => {
  parity('Plain', {});
  parity('Void', {});
  parity('Nested', {});
  parity('Text', { name: 'Ada' });
  parity('Escaping', { raw: '<script>"x" & y</script>' });
  parity('ManyHoles', { a: 'one', b: 'two' });
  parity('Attributes', { title: 'a title', id: 'seven', missing: undefined });
  parity('Namespaced', { value: 'v' });
  parity('Classes', { names: { on: true, off: false }, list: ['a', 'b'] });
  parity('Styles', { style: { marginTop: '1px', backgroundColor: 'red' }, text: 'color: blue' });
  parity('Booleans', { on: true, off: false });
  parity('Fragments', { items: ['a', 'b'] });
  parity('Keyed', { items: ['a', 'b', 'c'] });
  parity('Composed', { label: 'shown' });
  parity('WithChildren', { label: 'slotted' });
  parity('WithView', { text: 'viewed' });
  parity('Render', { label: 'count' });
  parity('Branch', { wide: true });
  parity('Branch', { wide: false });
  parity('Provider', { theme: 'dark' });
  parity('Spread', { attributes: { title: 'spread', 'data-x': 1, hidden: false } });
  parity('Conditional', { show: true });
  parity('Conditional', { show: false });
  parity('Nothing', {});
  parity('RunChild', { label: 'run' });
  parity('RunList', { items: ['a', 'b'] });
  parity('ListOfComponents', { items: ['a', 'b'] });
  parity('Deep', { label: 'deep' });
  parity('RunNothing', { label: 'x' });
  parity('RunElement', { label: 'x' });
  parity('RunPair', { label: 'x' });
  parity('NestedRun', { label: 'x' });
});
