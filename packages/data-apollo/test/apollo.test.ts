/**
 * The Apollo binding, against a stub of the three methods it touches.
 */
import { describe, expect, it } from 'vitest';
import { parseGraphQL, tag } from '@firsthandjs/data';
import {
  apolloLoader,
  apolloObservable,
  type ApolloLike,
  type WatchLike,
} from '@firsthandjs/data-apollo';

const context = { signal: new AbortController().signal, force: false, tags: () => {} };
const parse = (source: string): unknown => ({ parsed: source });

function stub(answer: unknown = { ok: true }) {
  const seen: { method: string; options: Record<string, unknown> }[] = [];
  return {
    seen,
    client: {
      query: (options: Record<string, unknown>) => {
        seen.push({ method: 'query', options });
        return Promise.resolve({ data: answer });
      },
      mutate: (options: Record<string, unknown>) => {
        seen.push({ method: 'mutate', options });
        return Promise.resolve({ data: answer });
      },
    } as unknown as ApolloLike,
  };
}

describe('apolloLoader', () => {
  it('sends a query through `query` and a mutation through `mutate`', async () => {
    const { seen, client } = stub();
    const load = apolloLoader(client, parse);

    await load(parseGraphQL('query Ok { ok }'))(context);
    await load(parseGraphQL('mutation Go { go }'))(context);

    expect(seen.map((entry) => entry.method)).toEqual(['query', 'mutate']);
  });

  it('declares the tags the document carries', async () => {
    const { client } = stub();
    const declared: unknown[] = [];
    // Typed as the codegen would type it, which is what makes the variables of
    // the call checkable at all.
    const document = parseGraphQL<unknown, { id: number }>(
      'query User($id: ID!) @tag(name: "user", id: $id) { user { id } }',
    );

    await apolloLoader(client, parse)(document, { id: 5 })({
      ...context,
      tags: (...tags) => declared.push(...tags),
    });

    expect(declared).toEqual([tag('user', { id: 5 })]);
  });

  it("declares a mutation's `@invalidates`, so an action can pass them straight on", async () => {
    const { client } = stub();
    const declared: unknown[] = [];
    const document = parseGraphQL<unknown, { id: number }>(
      'mutation Rename($id: ID!) @invalidates(name: "user", id: $id) @invalidates(name: "users") { rename(id: $id) { id } }',
    );

    await apolloLoader(client, parse)(document, { id: 5 })({
      ...context,
      tags: (...tags) => declared.push(...tags),
    });

    expect(declared).toEqual([tag('user', { id: 5 }), tag('users')]);
  });

  it('turns `force` into the policy that reaches past the cache', async () => {
    const { seen, client } = stub();
    const load = apolloLoader(client, parse)(parseGraphQL('query Ok { ok }'));

    await load(context);
    await load({ ...context, force: true });

    expect(seen.map((entry) => entry.options['fetchPolicy'])).toEqual([
      'cache-first',
      'network-only',
    ]);
  });

  it('parses with the function it was given, not one of its own', async () => {
    const { seen, client } = stub();

    await apolloLoader(client, parse)(parseGraphQL('query Ok { ok }'))(context);

    expect(seen[0]?.options['query']).toEqual({ parsed: 'query Ok { ok }' });
  });
});

describe('apolloObservable', () => {
  it('bridges a watched query, and reloads through it', async () => {
    let push: ((value: { data: string }) => void) | undefined;
    let refetched = 0;
    const client = {
      watchQuery: () => ({
        subscribe: (observer: { next?: (value: { data: string }) => void }) => {
          push = observer.next;
          return { unsubscribe: () => {} };
        },
        refetch: () => {
          refetched++;
          return Promise.resolve();
        },
      }),
    } as unknown as WatchLike;

    const [source, options] = apolloObservable(client, parse)(parseGraphQL('query Ok { ok }'));
    const seen: string[] = [];
    source.subscribe({ next: (value) => seen.push(value as string) });
    push?.({ data: 'from the cache' });
    await options.reload();

    expect(seen).toEqual(['from the cache']);
    expect(refetched).toBe(1);
  });

  it('passes an error handler through when there is one', () => {
    let fail: ((error: unknown) => void) | undefined;
    const client = {
      watchQuery: () => ({
        subscribe: (observer: { error?: (error: unknown) => void }) => {
          fail = observer.error;
          return { unsubscribe: () => {} };
        },
        refetch: () => Promise.resolve(),
      }),
    } as unknown as WatchLike;

    const [source] = apolloObservable(client, parse)(parseGraphQL('query Ok { ok }'));
    const seen: unknown[] = [];
    source.subscribe({ error: (error) => seen.push(error) });
    fail?.(new Error('gone'));

    expect(seen).toHaveLength(1);
  });
});
