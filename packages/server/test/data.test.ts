/**
 * Data that crosses the wire.
 *
 * The point of rendering on a server is that the page arrives with its content
 * in it, and the point of hydration is that the browser does not throw that
 * away and ask again. Both are asserted here against the same component: the
 * markup has to carry the answer, and the hydrated page has to show it without
 * ever rendering the loading branch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from '@firsthandjs/dom';
import { hydrate } from '@firsthandjs/dom/hydrate';
import { createComponent as createServerComponent } from '@firsthandjs/server/internal';
import { renderToString, renderToStringAsync } from '@firsthandjs/server';
import { createData, createMemoryStorage, serialize } from '@firsthandjs/data';
import * as client from './compiled/fixtures.js';
import * as serverModule from './compiled/fixtures.js?server';

const server = serverModule as unknown as typeof client;

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
});

describe('a resource on the server', () => {
  it('renders the loading branch when nothing is waited for', () => {
    const storage = createMemoryStorage();
    const store = createData({ storage });
    const html = renderToString(() =>
      createServerComponent(server.Loaded as never, {
        store,
        load: () => Promise.resolve('hello'),
      }),
    );
    expect(html).toContain('loading');
  });

  it('renders the answer once it has been waited for', async () => {
    const storage = createMemoryStorage();
    const store = createData({ storage });
    const html = await renderToStringAsync(
      () =>
        createServerComponent(server.Loaded as never, {
          store,
          load: () => Promise.resolve('hello'),
        }),
      { settle: () => store.settle() },
    );
    expect(html).toContain('hello');
    expect(html).not.toContain('loading');
    expect(storage.dump()).toEqual({ greeting: 'hello' });
  });

  it('asks the loader once, however many passes it takes', async () => {
    const storage = createMemoryStorage();
    const store = createData({ storage });
    const load = vi.fn(() => Promise.resolve('hello'));
    await renderToStringAsync(
      () => createServerComponent(server.Loaded as never, { store, load }),
      { settle: () => store.settle() },
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('gives up rather than waiting forever for a loader that never answers', async () => {
    const store = createData({ storage: createMemoryStorage() });
    const html = await renderToStringAsync(
      () =>
        createServerComponent(server.Loaded as never, {
          store,
          load: () => new Promise<string>(() => undefined),
        }),
      { settle: () => store.settle(), passes: 2, timeout: 10 },
    );
    expect(html).toContain('loading');
  });
});

describe('the answer in the browser', () => {
  it('is there before the first render, so nothing flashes', async () => {
    const storage = createMemoryStorage();
    const store = createData({ storage });
    const body = await renderToStringAsync(
      () =>
        createServerComponent(server.Loaded as never, {
          store,
          load: () => Promise.resolve('hello'),
        }),
      { settle: () => store.settle() },
    );

    // What a page would carry, written and read back the way one is.
    const sent = JSON.parse(serialize(storage.dump())) as Record<string, unknown>;

    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = body;
    const paragraph = container.querySelector('p');

    const browser = createData({ storage: createMemoryStorage(sent) });
    disposers.push(
      hydrate(
        () =>
          createComponent(client.Loaded, {
            store: browser,
            load: () => Promise.resolve('hello'),
          }),
        container,
      ),
    );

    expect(container.querySelector('p')).toBe(paragraph);
    expect(container.querySelector('p')?.className).toBe('done');
    expect(container.textContent).toBe('hello');
  });
});

describe('what a page carries', () => {
  it('cannot close the script element it is written into', () => {
    expect(serialize({ note: '</script><script>alert(1)</script>' })).not.toContain('</script>');
  });

  it('reads back as what it was', () => {
    const value = { a: 1, b: ['</b>', null] };
    expect(JSON.parse(serialize(value))).toEqual(value);
  });
});
