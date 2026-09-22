/**
 * When the server and the browser disagree.
 *
 * A mismatch is a bug in the application, but it must not be a broken page.
 * Every path here renders the part that disagrees from nothing and carries on:
 * the cost of a mismatch is the work hydration would have saved, and never the
 * page itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent, render } from '@firsthandjs/dom';
import { hydrate } from '@firsthandjs/dom/hydrate';
import { createComponent as createServerComponent } from '@firsthandjs/server/internal';
import { renderToString } from '@firsthandjs/server';
import { inside } from './tree.js';
import * as client from './compiled/fixtures.js';
import * as serverModule from './compiled/fixtures.js?server';

const server = serverModule as unknown as typeof client;

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
});

function host(html: string): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  container.innerHTML = html;
  return container;
}

/** The same view, rendered from nothing, for comparison. */
function fresh(name: keyof typeof client, props: unknown): string {
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(render(() => createComponent(client[name] as never, props as never), container));
  const html = inside(container);
  container.remove();
  return html;
}

describe('markup that is not what the view would have built', () => {
  it('rebuilds a value the server rendered differently', () => {
    const container = host(
      renderToString(() => createServerComponent(server.Text as never, { name: 'Ada' })),
    );
    disposers.push(hydrate(() => createComponent(client.Text, { name: 'Grace' }), container));
    expect(container.textContent).toBe('Hello, Grace!');
    expect(inside(container)).toBe(fresh('Text', { name: 'Grace' }));
  });

  it('builds what the server left out entirely', () => {
    const container = host('');
    disposers.push(hydrate(() => createComponent(client.Nested, {}), container));
    expect(inside(container)).toBe(fresh('Nested', {}));
  });

  it('builds what a render function finds missing', () => {
    // A run writes the positions it owns. With nothing sent there is nothing
    // to claim, and each of them builds what it describes.
    const container = host('');
    disposers.push(hydrate(() => createComponent(client.Render, { label: 'n' }), container));
    expect(container.textContent).toBe('n: 2+');
    expect(inside(container)).toBe(fresh('Render', { label: 'n' }));
  });

  it('keeps static markup the server sent, and says so', () => {
    // Both branches are a `div`, and neither writes anything after it is
    // built, so there is nothing the browser would ever rewrite. This is an
    // application bug — a view that renders differently on the two sides —
    // and the most a framework can do is name it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const container = host(
      renderToString(() => createServerComponent(server.Branch as never, { wide: true })),
    );
    disposers.push(hydrate(() => createComponent(client.Branch, { wide: false }), container));
    expect(warn.mock.calls.join(' ')).toContain('Hydration found');
    warn.mockRestore();
  });

  it('rebuilds a branch whose element is a different element', () => {
    const container = host(
      renderToString(() => createServerComponent(server.Conditional as never, { show: true })),
    );
    disposers.push(hydrate(() => createComponent(client.Conditional, { show: false }), container));
    expect(inside(container)).toBe(fresh('Conditional', { show: false }));
  });

  it('rebuilds a list whose rows are not the rows it has', () => {
    const container = host(
      renderToString(() => createServerComponent(server.Keyed as never, { items: ['a'] })),
    );
    disposers.push(hydrate(() => createComponent(client.Keyed, { items: ['x', 'y'] }), container));
    expect(inside(container)).toBe(fresh('Keyed', { items: ['x', 'y'] }));
  });

  it('builds the rows a view-row list has that the server did not send', () => {
    // A row that is a view takes its markup where hydration has got to. Past
    // the end of what the server sent there is nothing to take, so the row is
    // built and placed like any other — which is the case a list whose data
    // grew between the render and the page arriving.
    const container = host(
      renderToString(() =>
        createServerComponent(server.ListOfRenderComponents as never, { items: ['a'] }),
      ),
    );
    disposers.push(
      hydrate(
        () => createComponent(client.ListOfRenderComponents, { items: ['a', 'b', 'c'] }),
        container,
      ),
    );
    expect(inside(container)).toBe(fresh('ListOfRenderComponents', { items: ['a', 'b', 'c'] }));
  });

  it('rebuilds view rows that are not the rows it has', () => {
    const container = host(
      renderToString(() =>
        createServerComponent(server.ListOfRenderComponents as never, { items: ['a', 'b'] }),
      ),
    );
    disposers.push(
      hydrate(() => createComponent(client.ListOfRenderComponents, { items: ['x'] }), container),
    );
    expect(inside(container)).toBe(fresh('ListOfRenderComponents', { items: ['x'] }));
  });

  it('renders normally again once hydration is over', () => {
    const container = host(renderToString(() => createServerComponent(server.Plain as never, {})));
    disposers.push(hydrate(() => createComponent(client.Plain, {}), container));
    // Nothing is being adopted any more: an ordinary render into an ordinary
    // element builds the whole tree, as it would in a page that never had a
    // server.
    const after = document.createElement('div');
    document.body.append(after);
    disposers.push(render(() => createComponent(client.Nested, {}), after));
    expect(inside(after)).toBe(fresh('Nested', {}));
  });
});
