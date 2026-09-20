/**
 * Two GraphQL servers, one component, one cache.
 *
 * `useGraphQL` reads its transport from context, which holds one value per
 * subtree — right while there is one API, and useless for the case that
 * matters here: a single component reading from both.
 */
import { describe, expect, it } from 'vitest';
import { createRoot, provide } from '@firsthandjs/core';
import {
  GraphQLContext,
  QueryClientContext,
  createGraphQLApi,
  createGraphQLTransport,
  createQueryClient,
  parseGraphQL,
  useGraphQL,
} from '@firsthandjs/query';

const settle = (): Promise<void> => new Promise((wake) => setTimeout(wake, 20));

/** A transport that records what it was asked for and answers immediately. */
function recording(name: string, seen: string[]) {
  return createGraphQLTransport({
    url: `/${name}/graphql`,
    fetch: ((url: string) => {
      seen.push(url);
      return Promise.resolve(
        new Response(JSON.stringify({ data: { who: name } }), { status: 200 }),
      );
    }) as unknown as typeof fetch,
  });
}

describe('two APIs', () => {
  it('are read by one component, each from its own server', async () => {
    const seen: string[] = [];
    const billing = createGraphQLApi(recording('billing', seen));
    const catalog = createGraphQLApi(recording('catalog', seen));
    // Distinct tag names, because one cache serves both.
    const invoices = parseGraphQL<{ who: string }>(
      'query Invoices @tag(name: "billing:invoices") { who }',
    );
    const products = parseGraphQL<{ who: string }>(
      'query Products @tag(name: "catalog:products") { who }',
    );

    let stop = (): void => {};
    let results: [unknown, unknown] = [undefined, undefined];
    createRoot((dispose) => {
      stop = dispose;
      provide(QueryClientContext, createQueryClient());
      const one = billing.useQuery(invoices);
      const two = catalog.useQuery(products);
      results = [one, two];
    });

    await settle();

    expect(seen.sort()).toEqual(['/billing/graphql', '/catalog/graphql']);
    expect((results[0] as { data: { value: { who: string } | undefined } }).data.value?.who).toBe(
      'billing',
    );
    expect((results[1] as { data: { value: { who: string } | undefined } }).data.value?.who).toBe(
      'catalog',
    );
    stop();
  });

  it('leave the context transport alone', async () => {
    const seen: string[] = [];
    const other = createGraphQLApi(recording('other', seen));
    const document = parseGraphQL<{ who: string }>('query Who @tag(name: "who") { who }');

    let stop = (): void => {};
    createRoot((dispose) => {
      stop = dispose;
      provide(QueryClientContext, createQueryClient());
      provide(GraphQLContext, recording('context', seen));
      useGraphQL(document);
      other.useQuery(parseGraphQL<{ who: string }>('query Who2 @tag(name: "who2") { who }'));
    });

    await settle();

    expect(seen.sort()).toEqual(['/context/graphql', '/other/graphql']);
    stop();
  });

  it('mutate through the API they belong to, and invalidate the one cache', async () => {
    const seen: string[] = [];
    const api = createGraphQLApi(recording('billing', seen));
    const list = parseGraphQL<{ who: string }>(
      'query Invoices @tag(name: "billing:invoices") { who }',
    );
    const pay = parseGraphQL<{ who: string }>(
      'mutation Pay @invalidates(name: "billing:invoices") { who }',
    );

    let stop = (): void => {};
    let run = async (): Promise<void> => {};
    createRoot((dispose) => {
      stop = dispose;
      provide(QueryClientContext, createQueryClient({ staleTime: 60_000 }));
      api.useQuery(list);
      const mutation = api.useMutation(pay);
      run = async (): Promise<void> => {
        await mutation.mutate({});
      };
    });

    await settle();
    expect(seen).toEqual(['/billing/graphql']);

    await run();
    await settle();

    // The mutation, and the query its `@invalidates` brought back.
    expect(seen).toEqual(['/billing/graphql', '/billing/graphql', '/billing/graphql']);
    stop();
  });

  it('share the cache, so a tag names one thing across both', async () => {
    const seen: string[] = [];
    const api = createGraphQLApi(recording('shared', seen));
    const document = parseGraphQL<{ who: string }>('query Shared @tag(name: "thing") { who }');
    const client = createQueryClient({ staleTime: 60_000 });

    let stop = (): void => {};
    createRoot((dispose) => {
      stop = dispose;
      provide(QueryClientContext, client);
      // Two components asking for the same operation read the same entry.
      api.useQuery(document);
      api.useQuery(document);
    });

    await settle();

    expect(seen).toHaveLength(1);
    stop();
  });
});
