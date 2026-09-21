/**
 * An invalidation that nobody was there to hear.
 *
 * A resource reloads when a tag it carries is invalidated — as long as it
 * exists. Nothing watches a list while you are two pages away from it, so a
 * mutation there reaches nothing, and walking back *creates* a resource rather
 * than reloading one. Without a memory, that new resource asks the transport
 * with `force: false` and is handed the answer from before the change.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { component, provide, render } from '@firsthandjs/dom';
import {
  DataContext,
  createCacheClient,
  createData,
  createFetchClient,
  tag,
  useInvalidate,
  useResource,
  type DataStore,
} from '@firsthandjs/data';

const original = globalThis.fetch;
let served = 0;

afterEach(() => {
  globalThis.fetch = original;
  document.body.innerHTML = '';
});

function capture(): void {
  served = 0;
  globalThis.fetch = (() => {
    served += 1;
    return Promise.resolve(new Response(JSON.stringify({ served })));
  }) as unknown as typeof fetch;
}

/** A page that reads the list, mounted and unmounted like a route. */
function listing(store: DataStore, api: ReturnType<typeof createFetchClient>) {
  const host = document.createElement('div');
  document.body.append(host);
  const Page = component(() => {
    provide(DataContext, store);
    useResource(({ request, tags }) => {
      tags(tag('boards'));
      return api.get('/api/boards')(request);
    });
    return null;
  });
  return { host, stop: render(() => <Page />, host) };
}

const settle = (): Promise<void> => new Promise((wake) => setTimeout(wake, 10));

describe('an invalidation empties the cache it was given', () => {
  it('drops the entries that said they were about those tags', async () => {
    capture();
    const cache = createCacheClient({ ttl: 10_000 });
    // The cache is handed over, so the store can throw things out of it.
    const store = createData({ caches: [cache], remember: 0 });
    const api = createFetchClient({ cache });

    const first = listing(store, api);
    await settle();
    expect(served).toBe(1);
    expect(cache.size).toBe(1);
    first.stop();

    await store.invalidate(tag('boards'));

    // Gone straight away, rather than at the next reader's expense — and this
    // works with `remember: 0`, which is the other half of the fix switched
    // off.
    expect(cache.size).toBe(0);
    listing(store, api);
    await settle();
    expect(served).toBe(2);
  });

  it('leaves an entry about something else where it is', async () => {
    capture();
    const cache = createCacheClient({ ttl: 10_000 });
    const store = createData({ caches: [cache], remember: 0 });
    const api = createFetchClient({ cache });

    const page = listing(store, api);
    await settle();
    page.stop();

    await store.invalidate(tag('users'));

    expect(cache.size).toBe(1);
  });
});

describe('an invalidation outlives the resource that was watching', () => {
  it('reaches the next resource to declare that tag', async () => {
    capture();
    const store = createData();
    const api = createFetchClient({ cache: { ttl: 10_000 } });

    // Look at the list, then walk away from it.
    const first = listing(store, api);
    await settle();
    expect(served).toBe(1);
    first.stop();

    // Something elsewhere changes what the list is about. Nothing is watching
    // it, so this invalidation reaches nobody.
    const elsewhere = component(() => {
      provide(DataContext, store);
      void useInvalidate()(tag('boards'));
      return null;
    });
    render(() => elsewhere({}), document.createElement('div'));
    await settle();

    // Walk back. The cache is still holding the old answer, and without the
    // store's memory this would be served it.
    listing(store, api);
    await settle();

    expect(served).toBe(2);
  });

  it('does not force a resource that answered after the invalidation', async () => {
    capture();
    const store = createData();
    const api = createFetchClient({ cache: { ttl: 10_000 } });

    await store.invalidate(tag('boards'));
    const first = listing(store, api);
    await settle();
    expect(served).toBe(1);
    first.stop();

    // This one was created after an answer that already took the invalidation
    // into account: it may be served from the cache, and should be.
    listing(store, api);
    await settle();

    expect(served).toBe(1);
  });

  it('forgets, so an old invalidation does not force every new resource', async () => {
    capture();
    const store = createData({ remember: 0 });
    const api = createFetchClient({ cache: { ttl: 10_000 } });

    await store.invalidate(tag('boards'));
    listing(store, api);
    await settle();
    listing(store, api);
    await settle();

    // With the memory switched off this is the old behaviour, on purpose:
    // one request, and the second reader is served from the cache.
    expect(served).toBe(1);
  });
});

describe('tags that only the answer knows', () => {
  it('runs again when the answer turns out to be one that was invalidated', async () => {
    capture();
    const cache = createCacheClient({ ttl: 10_000 });
    const store = createData({ caches: [cache] });
    const api = createFetchClient({ cache });

    /**
     * A resource that cannot say what it is about until the server has told
     * it — `/api/things/current` is the documented case, and the tags name the
     * thing that came back rather than the request that went out.
     */
    const current = (): { host: HTMLElement; stop: () => void } => {
      const host = document.createElement('div');
      document.body.append(host);
      const Page = component(() => {
        provide(DataContext, store);
        useResource(async ({ request, tags }) => {
          const answer = await api.get<{ served: number }>('/api/things/current')(request);
          tags(tag('thing', { id: 42 }));
          return answer;
        });
        return null;
      });
      return { host, stop: render(() => <Page />, host) };
    };

    const first = current();
    await settle();
    expect(served).toBe(1);
    first.stop();

    // Nothing is watching it, and the cache entry carries no tags — they were
    // not known when it was created — so emptying the cache cannot find it.
    await store.invalidate(tag('thing', { id: 42 }));

    current();
    await settle();
    await settle();

    // The cache answered the first run, and the tags arrived afterwards. That
    // is the moment the store can tell this answer is the one that was
    // invalidated, and the resource has to go again rather than keep it.
    expect(served).toBe(2);
  });
});
