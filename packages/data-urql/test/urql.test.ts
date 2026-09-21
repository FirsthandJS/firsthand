/**
 * The urql client, against a stub of the two methods it touches.
 *
 * A stub rather than the real client, because that is the claim: this package
 * knows three names and nothing else, so there is nothing a version bump could
 * break that a stub would not also catch.
 */
import { describe, expect, it } from 'vitest';
import { signal } from '@firsthandjs/core';
import {
  createCacheClient,
  parseGraphQL,
  tag,
  type DataRequest,
  type Tag,
} from '@firsthandjs/data';
import { createUrqlClient, type UrqlLike } from '@firsthandjs/data-urql';

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

/** A request that records what the client said it was about. */
function asking(force = false): { request: DataRequest; declared: Tag[] } {
  const declared: Tag[] = [];
  return {
    declared,
    request: {
      signal: new AbortController().signal,
      force,
      tags: (...tags: Tag[]) => declared.push(...tags),
    },
  };
}

/** Records what the client was asked for, and answers. */
function stub(answer: unknown = { ok: true }, error?: unknown) {
  const seen: { method: string; document: string; variables: unknown; options: unknown }[] = [];
  const respond = (method: string) => (document: string, variables: unknown, options: unknown) => {
    seen.push({ method, document, variables, options });
    return { toPromise: () => Promise.resolve({ data: answer, error }) };
  };
  return {
    seen,
    client: { query: respond('query'), mutation: respond('mutation') } as unknown as UrqlLike,
  };
}

describe('createUrqlClient', () => {
  it('sends a query through `query`, and a mutation through `mutation`', async () => {
    const { seen, client } = stub();
    const api = createUrqlClient(client);

    await api.query(parseGraphQL('query Ok { ok }'))(ask());
    await api.mutate(parseGraphQL('mutation Go { go }'))(ask());

    expect(seen.map((entry) => entry.method)).toEqual(['query', 'mutation']);
  });

  it('declares what a query is about, bound to the variables', async () => {
    const { client } = stub();
    const { request, declared } = asking();
    // Typed as the codegen would type it, which is what makes the variables of
    // the call checkable at all.
    const document = parseGraphQL<unknown, { id: number }>(
      'query User($id: ID!) @tag(name: "user", id: $id) { user(id: $id) { id } }',
    );

    await createUrqlClient(client).query(document, { id: 5 })(request);

    expect(declared).toEqual([tag('user', { id: 5 })]);
  });

  it("declares a mutation's `@invalidates`, which in an action is the store's", async () => {
    const { client } = stub();
    const { request, declared } = asking();
    const document = parseGraphQL<unknown, { id: number }>(
      'mutation Rename($id: ID!) @invalidates(name: "user", id: $id) @invalidates(name: "users") { rename(id: $id) { id } }',
    );

    // In a resource this hole is the resource's tags; in an action it is the
    // store's invalidation. The call site writes neither.
    await createUrqlClient(client).mutate(document, { id: 5 })(request);

    expect(declared).toEqual([tag('user', { id: 5 }), tag('users')]);
  });

  it('turns `force` into a policy that reaches past urql’s own cache', async () => {
    const { seen, client } = stub();
    const load = createUrqlClient(client).query(parseGraphQL('query Ok { ok }'));

    await load(ask());
    await load(ask(true));

    expect(seen.map((entry) => (entry.options as { requestPolicy: string }).requestPolicy)).toEqual(
      ['cache-first', 'network-only'],
    );
  });

  it('hands over the abort signal', async () => {
    const { seen, client } = stub();
    const controller = new AbortController();

    await createUrqlClient(client).query(parseGraphQL('query Ok { ok }'))({
      signal: controller.signal,
      force: false,
    });

    expect(
      (seen[0]?.options as { fetchOptions: { signal: AbortSignal } }).fetchOptions.signal,
    ).toBe(controller.signal);
  });

  it('reads headers per request, so a token that changes is the current one', async () => {
    const { seen, client } = stub();
    const token = signal('first');
    const api = createUrqlClient(client, {
      headers: () => ({ authorization: `Bearer ${token.value}` }),
      context: { url: '/graphql' },
    });

    await api.query(parseGraphQL('query Ok { ok }'))(ask());
    token.value = 'second';
    await api.query(parseGraphQL('query Ok { ok }'))(ask());

    const headers = (index: number): unknown =>
      (seen[index]?.options as { fetchOptions: { headers: unknown } }).fetchOptions.headers;
    expect(headers(0)).toEqual({ authorization: 'Bearer first' });
    expect(headers(1)).toEqual({ authorization: 'Bearer second' });
    expect((seen[0]?.options as { url: string }).url).toBe('/graphql');
  });

  it('caches a query when it was given a cache, and never a mutation', async () => {
    const { seen, client } = stub();
    const api = createUrqlClient(client, { cache: { ttl: 10_000 } });
    const document = parseGraphQL<unknown, { id: number }>(
      'query User($id: ID!) { user(id: $id) { id } }',
    );

    await api.query(document, { id: 1 })(ask());
    await api.query(document, { id: 1 })(ask());
    expect(seen).toHaveLength(1);

    // Another set of variables is another answer.
    await api.query(document, { id: 2 })(ask());
    expect(seen).toHaveLength(2);

    // And `force` reaches through it, as an invalidation must.
    await api.query(document, { id: 1 })(ask(true));
    expect(seen).toHaveLength(3);

    await api.mutate(parseGraphQL('mutation Go { go }'))(ask());
    await api.mutate(parseGraphQL('mutation Go { go }'))(ask());
    expect(seen).toHaveLength(5);
  });

  it('never serves one account the answer cached for another', async () => {
    const { seen, client } = stub();
    const token = signal('ada');
    const api = createUrqlClient(client, {
      headers: () => ({ authorization: `Bearer ${token.value}` }),
      cache: { ttl: 10_000 },
    });
    const document = parseGraphQL('query Me { me { id } }');

    await api.query(document)(ask());
    token.value = 'grace';
    await api.query(document)(ask());

    expect(seen).toHaveLength(2);
  });

  it('keys a query by its variables, in any order they were written', async () => {
    const { seen, client } = stub();
    const api = createUrqlClient(client, { cache: { ttl: 10_000 } });
    const document = parseGraphQL<unknown, { a: number; b: number }>(
      'query Rows($a: Int!, $b: Int!) { rows(a: $a, b: $b) { id } }',
    );

    await api.query(document, { a: 1, b: 2 })(ask());
    await api.query(document, { b: 2, a: 1 })(ask());

    expect(seen).toHaveLength(1);
  });

  it('takes an identity of its own, for a session that is not a header', async () => {
    const { seen, client } = stub();
    const account = signal('a1');
    const api = createUrqlClient(client, {
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
    const api = createUrqlClient(client, {
      headers: { Authorization: 'Bearer ada' },
      cache: { ttl: 10_000 },
    });
    const document = parseGraphQL('query Me { me { id } }');

    await api.query(document)(ask());
    await api.query(document)(ask());

    expect(seen).toHaveLength(1);
  });

  it('makes a variation that keeps what it did not replace, cache included', async () => {
    const { seen, client } = stub();
    const api = createUrqlClient(client, {
      headers: { 'x-app': 'notes' },
      cache: createCacheClient({ ttl: 1000 }),
    });
    const traced = api.with({ context: { preferGetMethod: true } });

    await traced.query(parseGraphQL('query Ok { ok }'))(ask());

    const options = seen[0]?.options as {
      preferGetMethod: boolean;
      fetchOptions: { headers: unknown };
    };
    expect(options.preferGetMethod).toBe(true);
    expect(options.fetchOptions.headers).toEqual({ 'x-app': 'notes' });
    expect(traced.cache).toBe(api.cache);
  });

  it('has no cache unless it was asked for one, because urql may have its own', async () => {
    const { seen, client } = stub();
    const api = createUrqlClient(client);

    await api.query(parseGraphQL('query Ok { ok }'))(ask());
    await api.query(parseGraphQL('query Ok { ok }'))(ask());

    expect(api.cache).toBeUndefined();
    expect(seen).toHaveLength(2);
  });

  it('keeps a query an action sends out of the cache', async () => {
    const { seen, client } = stub();
    const api = createUrqlClient(client, { cache: { ttl: 10_000 } });
    const document = parseGraphQL('query Me { me { id } }');

    await api.query(document)(change());
    await api.query(document)(ask());

    expect(seen).toHaveLength(2);
  });

  it('keeps having no cache when a variation adds none', () => {
    const { client } = stub();
    expect(createUrqlClient(client).with({ context: { url: '/other' } }).cache).toBeUndefined();
  });

  it('throws what the client reports, so it lands in `error`', async () => {
    const { client } = stub(undefined, new Error('network'));

    await expect(
      createUrqlClient(client).query(parseGraphQL('query Ok { ok }'))(ask()),
    ).rejects.toThrow('network');
  });

  it('sends the document with its directives already removed', async () => {
    const { seen, client } = stub();
    const document = parseGraphQL('query Ok @tag(name: "ok") { ok }');

    await createUrqlClient(client).query(document)(ask());

    expect(seen[0]?.document).not.toContain('@tag');
  });
});
