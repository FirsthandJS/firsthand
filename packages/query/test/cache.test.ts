/**
 * Tags, and the cache they drive.
 */
import { describe, expect, it, vi } from 'vitest';
import { tick } from '@firsthandjs/testing';
import {
  anyTagMatches,
  createQueryClient,
  tag,
  tagKey,
  tagMatches,
  tagsKey,
  type QueryDefinition,
} from '@firsthandjs/query';

describe('tags', () => {
  it('matches by name, and treats absent variables as wildcards', () => {
    expect(tagMatches(tag('user'), tag('user', { id: 7 }))).toBe(true);
    expect(tagMatches(tag('user', { id: 7 }), tag('user', { id: 7 }))).toBe(true);
    expect(tagMatches(tag('user', { id: 7 }), tag('user', { id: 8 }))).toBe(false);
    expect(tagMatches(tag('user', { id: 7 }), tag('user'))).toBe(false);
    expect(tagMatches(tag('user'), tag('org'))).toBe(false);
  });

  it('serialises independently of the order variables were written in', () => {
    expect(tagKey(tag('user', { a: 1, b: 2 }))).toBe(tagKey(tag('user', { b: 2, a: 1 })));
    expect(tagKey(tag('user'))).toBe('user');
    expect(tagKey(tag('user', { id: 7 }))).not.toBe(tagKey(tag('user', { id: 8 })));
    expect(tagsKey([tag('b'), tag('a')])).toBe(tagsKey([tag('a'), tag('b')]));
  });

  it('answers whether any pattern covers any tag', () => {
    const tags = [tag('user', { id: 1 }), tag('users')];
    expect(anyTagMatches([tag('users')], tags)).toBe(true);
    expect(anyTagMatches([tag('user', { id: 1 })], tags)).toBe(true);
    expect(anyTagMatches([tag('user', { id: 2 })], tags)).toBe(false);
    expect(anyTagMatches([], tags)).toBe(false);
  });
});

/** A query whose fetcher counts its calls and resolves with a value. */
function counted<T>(value: T, tags = [tag('thing')]): QueryDefinition<T> & { calls: () => number } {
  const fetcher = vi.fn(() => Promise.resolve(value));
  return { tags, fetch: fetcher, calls: () => fetcher.mock.calls.length };
}

describe('the cache', () => {
  it('gives the same entry to the same tags, and different tags different entries', () => {
    const client = createQueryClient();
    const first = client.entry({ tags: [tag('user', { id: 1 })], fetch: () => Promise.resolve(1) });
    const same = client.entry({ tags: [tag('user', { id: 1 })], fetch: () => Promise.resolve(1) });
    const other = client.entry({ tags: [tag('user', { id: 2 })], fetch: () => Promise.resolve(2) });

    expect(same).toBe(first);
    expect(other).not.toBe(first);
    expect(client.size).toBe(2);
  });

  it('separates two queries that share tags when a key says so', () => {
    const client = createQueryClient();
    const list = client.entry({
      key: 'list',
      tags: [tag('user')],
      fetch: () => Promise.resolve([]),
    });
    const count = client.entry({
      key: 'count',
      tags: [tag('user')],
      fetch: () => Promise.resolve(0),
    });
    expect(count).not.toBe(list);
  });

  it('fetches once and then answers from the cache while fresh', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const query = counted('value');

    expect(await client.load(query)).toBe('value');
    expect(await client.load(query)).toBe('value');
    expect(query.calls()).toBe(1);
    expect(client.entry(query).status.value).toBe('success');
  });

  it('re-fetches when the result is no longer fresh', async () => {
    const client = createQueryClient({ staleTime: 0 });
    const query = counted('value');

    await client.load(query);
    await client.load(query);

    expect(query.calls()).toBe(2);
  });

  it('goes to the network on force, fresh or not', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const query = counted('value');

    await client.load(query);
    await client.load(query, { force: true });

    expect(query.calls()).toBe(2);
  });

  it('deduplicates concurrent requests for one entry', async () => {
    const client = createQueryClient();
    const query = counted('value');

    const [a, b] = await Promise.all([client.load(query), client.load(query)]);

    expect([a, b]).toEqual(['value', 'value']);
    expect(query.calls()).toBe(1);
  });

  it('reports an error without losing the entry', async () => {
    const client = createQueryClient();
    const failure = new Error('nope');
    const query: QueryDefinition<string> = {
      tags: [tag('thing')],
      fetch: () => Promise.reject(failure),
    };

    expect(await client.load(query)).toBeUndefined();

    const entry = client.entry(query);
    expect(entry.status.value).toBe('error');
    expect(entry.error.value).toBe(failure);
    expect(entry.fetching.value).toBe(false);
  });

  it('reports pending only while there is nothing to show', async () => {
    const client = createQueryClient();
    const query = counted('first');
    const entry = client.entry(query);

    const inflight = client.load(query);
    expect(entry.status.value).toBe('pending');
    expect(entry.fetching.value).toBe(true);
    await inflight;

    const again = client.load(query, { force: true });
    // A refetch keeps the old value visible and says it is fetching.
    expect(entry.status.value).toBe('success');
    expect(entry.data.value).toBe('first');
    expect(entry.fetching.value).toBe(true);
    await again;
    expect(entry.fetching.value).toBe(false);
  });

  it('invalidates by tag: watched entries refetch, the rest are marked', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const watched = counted('a', [tag('user', { id: 1 }), tag('users')]);
    const unwatched = counted('b', [tag('user', { id: 2 })]);
    const unrelated = counted('c', [tag('org')]);

    await Promise.all([client.load(watched), client.load(unwatched), client.load(unrelated)]);
    const release = client.subscribe(client.entry(watched));

    await client.invalidate(tag('user'));

    // The watched one went to the network at once...
    expect(watched.calls()).toBe(2);
    expect(unrelated.calls()).toBe(1);
    // ...and the unwatched one waits until somebody asks again.
    expect(unwatched.calls()).toBe(1);
    await client.load(unwatched);
    expect(unwatched.calls()).toBe(2);
    release();
  });

  it('invalidates several queries from one tag', async () => {
    const client = createQueryClient({ staleTime: 10_000 });
    const first = counted(1, [tag('user', { id: 1 }), tag('users')]);
    const second = counted(2, [tag('users')]);
    await Promise.all([client.load(first), client.load(second)]);
    const releases = [
      client.subscribe(client.entry(first)),
      client.subscribe(client.entry(second)),
    ];

    await client.invalidate(tag('users'));

    expect(first.calls()).toBe(2);
    expect(second.calls()).toBe(2);
    for (const release of releases) {
      release();
    }
  });

  it('keeps an unused entry for cacheTime and then drops it', async () => {
    const client = createQueryClient({ cacheTime: 5 });
    const query = counted('value');
    await client.load(query);
    const release = client.subscribe(client.entry(query));
    expect(client.size).toBe(1);

    release();
    release(); // releasing twice must not double-count
    expect(client.size).toBe(1);

    await tick(20);
    expect(client.size).toBe(0);
  });

  it('cancels the collection when the entry is taken up again', async () => {
    const client = createQueryClient({ cacheTime: 5 });
    const query = counted('value');
    await client.load(query);
    const release = client.subscribe(client.entry(query));
    release();
    const again = client.subscribe(client.entry(query));

    await tick(20);

    expect(client.size).toBe(1);
    again();
  });

  it('ignores a response that arrives after it was superseded', async () => {
    const client = createQueryClient();
    let resolveFirst: (value: string) => void = () => undefined;
    let call = 0;
    const query: QueryDefinition<string> = {
      tags: [tag('thing')],
      fetch: () => {
        call++;
        return call === 1
          ? new Promise<string>((resolve) => (resolveFirst = resolve))
          : Promise.resolve('second');
      },
    };

    const first = client.load(query);
    const second = client.load(query, { force: true });
    resolveFirst('first');
    await Promise.all([first, second]);

    expect(client.entry(query).data.value).toBe('second');
  });

  it('ignores a rejection that arrives after it was superseded', async () => {
    const client = createQueryClient();
    let rejectFirst: (error: unknown) => void = () => undefined;
    let call = 0;
    const query: QueryDefinition<string> = {
      tags: [tag('thing')],
      fetch: () => {
        call++;
        return call === 1
          ? new Promise<string>((_resolve, reject) => (rejectFirst = reject))
          : Promise.resolve('second');
      },
    };

    const first = client.load(query);
    const second = client.load(query, { force: true });
    rejectFirst(new Error('too late'));
    await Promise.all([first, second]);

    expect(client.entry(query).error.value).toBeUndefined();
    expect(client.entry(query).data.value).toBe('second');
  });

  it('aborts in-flight requests when cleared', () => {
    const client = createQueryClient({ cacheTime: 1000 });
    let seen: AbortSignal | undefined;
    const query: QueryDefinition<string> = {
      tags: [tag('thing')],
      fetch: ({ signal }) => {
        seen = signal;
        return new Promise<string>(() => undefined);
      },
    };
    void client.load(query);
    const release = client.subscribe(client.entry(query));
    release();

    client.clear();

    expect(seen?.aborted).toBe(true);
    expect(client.size).toBe(0);
  });

  it('clears an entry that is still subscribed, with no collection timer to cancel', () => {
    const client = createQueryClient({ cacheTime: 1000 });
    const query: QueryDefinition<string> = {
      tags: [tag('thing')],
      fetch: () => Promise.resolve('value'),
    };
    void client.load(query);
    // Left subscribed on purpose: an entry someone is still watching has no
    // pending collection, so `clear` has nothing to cancel before dropping it.
    void client.subscribe(client.entry(query));

    client.clear();

    expect(client.size).toBe(0);
  });

  it('honours a per-query staleTime over the client default', async () => {
    const client = createQueryClient({ staleTime: 0 });
    const fetcher = vi.fn(() => Promise.resolve('value'));
    const query: QueryDefinition<string> = {
      tags: [tag('thing')],
      fetch: fetcher,
      staleTime: 10_000,
    };

    await client.load(query);
    await client.load(query);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
