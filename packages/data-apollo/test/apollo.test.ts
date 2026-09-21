/**
 * The Apollo client, against a stub of the three methods it touches.
 */
import { describe, expect, it } from 'vitest';
import { signal } from '@firsthandjs/core';
import { parseGraphQL, tag, type DataRequest, type Tag } from '@firsthandjs/data';
import { createApolloClient, type ApolloLike, type WatchLike } from '@firsthandjs/data-apollo';

const ask = (force = false): DataRequest => ({
  signal: new AbortController().signal,
  force,
});

/** What an action hands a client: it changes something. */
const change = (): DataRequest => ({
  signal: new AbortController().signal,
  force: true,
  mutating: true,
});
const parse = (source: string): unknown => ({ parsed: source });

/** A request that records what the client said it was about. */
function asking(): { request: DataRequest; declared: Tag[] } {
  const declared: Tag[] = [];
  return {
    declared,
    request: {
      signal: new AbortController().signal,
      force: false,
      tags: (...tags: Tag[]) => declared.push(...tags),
    },
  };
}

function stub(answer: unknown = { ok: true }) {
  const seen: { method: string; options: Record<string, unknown> }[] = [];
  const watchers: { observer: Record<string, unknown>; refetches: number }[] = [];
  const client = {
    query: (options: Record<string, unknown>) => {
      seen.push({ method: 'query', options });
      return Promise.resolve({ data: answer });
    },
    mutate: (options: Record<string, unknown>) => {
      seen.push({ method: 'mutate', options });
      return Promise.resolve({ data: answer });
    },
    watchQuery: (options: Record<string, unknown>) => {
      seen.push({ method: 'watchQuery', options });
      const watcher = { observer: {}, refetches: 0 };
      watchers.push(watcher);
      return {
        subscribe: (observer: Record<string, unknown>) => {
          watcher.observer = observer;
          return { unsubscribe: () => undefined };
        },
        refetch: () => {
          watcher.refetches += 1;
          return Promise.resolve();
        },
      };
    },
  } as unknown as ApolloLike & WatchLike;
  return { seen, watchers, client };
}

describe('createApolloClient', () => {
  it('sends a query through `query` and a mutation through `mutate`', async () => {
    const { seen, client } = stub();
    const api = createApolloClient(client, parse);

    await api.query(parseGraphQL('query Ok { ok }'))(ask());
    await api.mutate(parseGraphQL('mutation Go { go }'))(ask());

    expect(seen.map((entry) => entry.method)).toEqual(['query', 'mutate']);
  });

  it('declares what a query is about, bound to the variables', async () => {
    const { client } = stub();
    const { request, declared } = asking();
    const document = parseGraphQL<unknown, { id: number }>(
      'query User($id: ID!) @tag(name: "user", id: $id) { user { id } }',
    );

    await createApolloClient(client, parse).query(document, { id: 5 })(request);

    expect(declared).toEqual([tag('user', { id: 5 })]);
  });

  it("declares a mutation's `@invalidates`, which in an action is the store's", async () => {
    const { client } = stub();
    const { request, declared } = asking();
    const document = parseGraphQL<unknown, { id: number }>(
      'mutation Rename($id: ID!) @invalidates(name: "user", id: $id) @invalidates(name: "users") { rename(id: $id) { id } }',
    );

    await createApolloClient(client, parse).mutate(document, { id: 5 })(request);

    expect(declared).toEqual([tag('user', { id: 5 }), tag('users')]);
  });

  it('turns `force` into the policy that reaches past Apollo’s cache', async () => {
    const { seen, client } = stub();
    const load = createApolloClient(client, parse).query(parseGraphQL('query Ok { ok }'));

    await load(ask());
    await load(ask(true));

    expect(seen.map((entry) => entry.options['fetchPolicy'])).toEqual([
      'cache-first',
      'network-only',
    ]);
  });

  it('parses with the function it was given, not one of its own', async () => {
    const { seen, client } = stub();

    await createApolloClient(client, parse).query(parseGraphQL('query Ok { ok }'))(ask());

    expect(seen[0]?.options['query']).toEqual({ parsed: 'query Ok { ok }' });
  });

  it('reads headers per request, so a token that changes is the current one', async () => {
    const { seen, client } = stub();
    const token = signal('first');
    const api = createApolloClient(client, parse, {
      headers: () => ({ authorization: `Bearer ${token.value}` }),
      options: { errorPolicy: 'all' },
    });

    await api.query(parseGraphQL('query Ok { ok }'))(ask());
    token.value = 'second';
    await api.mutate(parseGraphQL('mutation Go { go }'))(ask());

    expect(seen[0]?.options['context']).toEqual({ headers: { authorization: 'Bearer first' } });
    expect(seen[1]?.options['context']).toEqual({ headers: { authorization: 'Bearer second' } });
    expect(seen[0]?.options['errorPolicy']).toBe('all');
  });

  it('caches a query when it was given a cache, and never a mutation', async () => {
    const { seen, client } = stub();
    const api = createApolloClient(client, parse, { cache: { ttl: 10_000 } });
    const document = parseGraphQL<unknown, { id: number }>('query User($id: ID!) { user { id } }');

    await api.query(document, { id: 1 })(ask());
    await api.query(document, { id: 1 })(ask());
    expect(seen).toHaveLength(1);

    await api.query(document, { id: 1 })(ask(true));
    expect(seen).toHaveLength(2);

    await api.mutate(parseGraphQL('mutation Go { go }'))(ask());
    await api.mutate(parseGraphQL('mutation Go { go }'))(ask());
    expect(seen).toHaveLength(4);
  });

  it('never serves one account the answer cached for another', async () => {
    const { seen, client } = stub();
    const token = signal('ada');
    const api = createApolloClient(client, parse, {
      headers: () => ({ authorization: `Bearer ${token.value}` }),
      cache: { ttl: 10_000 },
    });
    const document = parseGraphQL('query Me { me { id } }');

    await api.query(document)(ask());
    token.value = 'grace';
    await api.query(document)(ask());

    expect(seen).toHaveLength(2);
  });

  it('takes an identity of its own, for a session that is not a header', async () => {
    const { seen, client } = stub();
    const account = signal('a1');
    const api = createApolloClient(client, parse, {
      scope: () => account.value,
      cache: { ttl: 10_000 },
    });
    const document = parseGraphQL('query Me { me { id } }');

    await api.query(document)(ask());
    await api.query(document)(ask());
    expect(seen).toHaveLength(1);

    account.value = 'a2';
    await api.query(document)(ask());
    expect(seen).toHaveLength(2);
  });

  it('reads a capitalised Authorization header as the same identity', async () => {
    const { seen, client } = stub();
    const api = createApolloClient(client, parse, {
      headers: { Authorization: 'Bearer ada' },
      cache: { ttl: 10_000 },
    });
    const document = parseGraphQL('query Me { me { id } }');

    await api.query(document)(ask());
    await api.query(document)(ask());

    expect(seen).toHaveLength(1);
  });

  it('has no cache unless it was asked for one, because Apollo has its own', () => {
    const { client } = stub();
    expect(createApolloClient(client, parse).cache).toBeUndefined();
  });

  it('makes a variation that keeps what it did not replace, cache included', async () => {
    const { seen, client } = stub();
    const api = createApolloClient(client, parse, {
      headers: { 'x-app': 'notes' },
      cache: { ttl: 1000 },
    });
    const traced = api.with({ options: { errorPolicy: 'ignore' } });

    await traced.query(parseGraphQL('query Ok { ok }'))(ask());

    expect(seen[0]?.options['context']).toEqual({ headers: { 'x-app': 'notes' } });
    expect(seen[0]?.options['errorPolicy']).toBe('ignore');
    expect(traced.cache).toBe(api.cache);
  });

  it('keeps a query an action sends out of the cache', async () => {
    const { seen, client } = stub();
    const api = createApolloClient(client, parse, { cache: { ttl: 10_000 } });
    const document = parseGraphQL('query Me { me { id } }');

    await api.query(document)(change());
    await api.query(document)(ask());

    expect(seen).toHaveLength(2);
  });

  it('keeps having no cache when a variation adds none', () => {
    const { client } = stub();
    expect(createApolloClient(client, parse).with({ options: {} }).cache).toBeUndefined();
  });

  it('bridges a watched query, and reloads through it', async () => {
    const { watchers, client } = stub();
    const [source, options] = createApolloClient(client, parse).watch(
      parseGraphQL<unknown, { id: number }>('query User($id: ID!) { user { id } }'),
      { id: 1 },
    );
    const seen: unknown[] = [];
    source.subscribe({ next: (value) => seen.push(value) });

    (watchers[0]?.observer['next'] as (value: { data: unknown }) => void)({ data: { user: 1 } });
    await options.reload?.();

    expect(seen).toEqual([{ user: 1 }]);
    expect(watchers[0]?.refetches).toBe(1);
  });

  it('passes an error handler through when there is one', () => {
    const { watchers, client } = stub();
    const [source] = createApolloClient(client, parse).watch(parseGraphQL('query Ok { ok }'));
    const seen: unknown[] = [];
    source.subscribe({ error: (error) => seen.push(error) });

    (watchers[0]?.observer['error'] as (error: unknown) => void)(new Error('gone'));

    expect(seen).toHaveLength(1);
  });
});
