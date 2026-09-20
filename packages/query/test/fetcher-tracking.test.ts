/**
 * What a query depends on, and what it merely touches.
 *
 * A fetcher is imperative I/O. The signals it reads on the way — an auth
 * token read to build a header is the one every application hits — are
 * incidental, and must not become dependencies of the query: if they did,
 * changing the token would re-fetch every watched query, including on the way
 * out of a sign-out.
 *
 * What a query depends on is what its `define` thunk reads.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRoot, provide, signal } from '@firsthandjs/core';
import {
  GraphQLContext,
  QueryClientContext,
  createGraphQLTransport,
  createQueryClient,
  parseGraphQL,
  tag,
  useGraphQL,
  useQuery,
} from '@firsthandjs/query';

const settle = (): Promise<void> => new Promise((wake) => setTimeout(wake, 20));

describe('a signal the fetcher reads', () => {
  it('does not become a dependency of the query', async () => {
    const token = signal('first');
    const fetcher = vi.fn(() => Promise.resolve('ok'));
    const client = createQueryClient();

    let stop = (): void => {};
    createRoot((dispose) => {
      stop = dispose;
      provide(QueryClientContext, client);
      useQuery(() => ({
        tags: [tag('thing')],
        fetch: async () => {
          // Read before the first await, which is where tracking would catch
          // it: exactly what a header function does.
          void token.value;
          return fetcher();
        },
      }));
    });

    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);

    token.value = 'second';
    await settle();

    expect(fetcher).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not re-send a GraphQL query when the auth header changes', async () => {
    const token = signal('first');
    const sent: string[] = [];
    const client = createQueryClient();
    const document = parseGraphQL<{ ok: boolean }>('query Ok @tag(name: "ok") { ok }');

    let stop = (): void => {};
    createRoot((dispose) => {
      stop = dispose;
      provide(QueryClientContext, client);
      provide(
        GraphQLContext,
        createGraphQLTransport({
          url: '/graphql',
          // The documented shape, read per request.
          headers: () => ({ authorization: `Bearer ${token.value}` }),
          fetch: ((_url: string, init: { headers: Record<string, string> }) => {
            sent.push(init.headers['authorization'] as string);
            return Promise.resolve(
              new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
            );
          }) as unknown as typeof fetch,
        }),
      );
      useGraphQL(document);
    });

    await settle();
    expect(sent).toEqual(['Bearer first']);

    token.value = 'second';
    await settle();

    // One request, still — and the next one, whenever it happens for its own
    // reasons, will carry the new token.
    expect(sent).toEqual(['Bearer first']);
    stop();
  });
});
