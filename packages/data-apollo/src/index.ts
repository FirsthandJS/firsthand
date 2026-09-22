/**
 * Apollo Client, as a client for `@firsthandjs/data`.
 *
 * It takes a client you built and touches three of its methods. Your links,
 * your authentication, your uploads stay where they are — and so does the
 * decision that matters most here: what to do with Apollo's own cache.
 *
 * Apollo requires an `InMemoryCache` instance, and it is a *normalising* cache,
 * which is a different thing from a store of resources. Two ways to run them
 * together, and only these two:
 *
 *   - **Apollo as transport.** `fetchPolicy: 'no-cache'`, or the `force` this
 *     package passes on, and the resources are your state. One source of
 *     truth.
 *   - **Apollo as the store.** Use `watch` instead: one write in Apollo's
 *     cache updates every view of that entity at once, which is what a
 *     per-call-site resource cannot do. Also one source of truth.
 *
 * What is not on the list is both at once (ADR-0022).
 *
 * ```ts
 * import { gql } from '@apollo/client';
 * import { createApolloClient } from '@firsthandjs/data-apollo';
 *
 * export const billing = createApolloClient(apollo, gql, {
 *   // Read per request and untracked: the token may change, and a resource
 *   // must not depend on it.
 *   headers: () => ({ authorization: `Bearer ${token.value}` }),
 * });
 *
 * const invoices = useResource(({ request }) =>
 *   billing.query(InvoicesDocument, { month: month.value })(request),
 * );
 * ```
 *
 * There is no dependency on Apollo here, and no peer dependency either: the
 * shapes below are declared structurally, so this package has no opinion about
 * which version you run, and nothing to follow when that version changes.
 */
import {
  createCacheClient,
  resolveTags,
  stableKey,
  type BridgeOptions,
  type CacheClient,
  type CacheOptions,
  type DataRequest,
  type DocumentArguments,
  type GraphQLDocument,
  type Loader,
  type ObservableLike,
  type Variables,
} from '@firsthandjs/data';
import { untrack } from '@firsthandjs/core';

/** The part of an Apollo client this package uses. Nothing else. */
export type ApolloLike = {
  query(options: Record<string, unknown>): Promise<{ data: unknown }>;
  mutate(options: Record<string, unknown>): Promise<{ data?: unknown }>;
};

/** A watched query: what Apollo pushes when its cache changes. */
export type WatchLike = {
  watchQuery(options: Record<string, unknown>): {
    subscribe(observer: {
      next?: (value: { data: unknown }) => void;
      error?: (error: unknown) => void;
    }): { unsubscribe: () => void };
    refetch(): Promise<unknown>;
  };
};

/**
 * How to turn a document's source into whatever Apollo wants.
 *
 * Apollo takes a parsed `DocumentNode`, which means `gql` from `@apollo/client`
 * or `parse` from `graphql` — your copy of it, not ours, since two copies of
 * `graphql` in one application is its own kind of afternoon.
 */
export type Parse = (source: string) => unknown;

export type ApolloClientOptions = {
  /**
   * Headers for every request, sent through Apollo's per-operation context. A
   * function is called **per request and untracked**, which is what lets a
   * token change without making every resource depend on it.
   */
  readonly headers?: Record<string, string> | (() => Record<string, string>);
  /**
   * A cache in front of Apollo: `false` (the default, because Apollo has one
   * of its own and two caches over the same data disagree), options for a
   * cache of this client's own, or a `CacheClient` shared with the rest of the
   * application. Queries only.
   */
  readonly cache?: false | CacheOptions | CacheClient;
  /**
   * Who the cached answers belong to. Defaults to the `authorization` header
   * this request would carry, so two accounts in one session cannot read each
   * other's answers out of one operation-shaped key. Read per request,
   * untracked.
   */
  readonly scope?: () => string;
  /** Merged into the options of every query and mutation. */
  readonly options?: Record<string, unknown>;
};

export type ApolloClient = {
  /**
   * A query, as a loader. Declares the document's `@tag` directives before the
   * request goes out; `force` becomes `fetchPolicy: 'network-only'`, which is
   * what makes an invalidation reach past Apollo's cache.
   */
  query<T, V extends Variables>(
    document: GraphQLDocument<T, V>,
    ...rest: DocumentArguments<V>
  ): Loader<T>;
  /**
   * A mutation, as a loader. Declares the document's `@invalidates` directives
   * into the request — which inside an action is the store's `invalidates`, so
   * the document's own declaration reaches the store with nothing to wire.
   */
  mutate<T, V extends Variables>(
    document: GraphQLDocument<T, V>,
    ...rest: DocumentArguments<V>
  ): Loader<T>;
  /**
   * A watched query, for `fromObservable`: Apollo's cache as the one source of
   * truth, so every view of an entity updates from the same write.
   *
   * ```ts
   * const user = fromObservable(...billing.watch(UserDocument, { id }));
   * ```
   */
  watch<T, V extends Variables>(
    document: GraphQLDocument<T, V>,
    ...rest: DocumentArguments<V>
  ): readonly [ObservableLike<T>, BridgeOptions];
  /** A copy with some options replaced. The cache is shared unless replaced. */
  with(options: ApolloClientOptions): ApolloClient;
  readonly cache: CacheClient | undefined;
};

export function createApolloClient(
  client: ApolloLike & WatchLike,
  parse: Parse,
  options: ApolloClientOptions = {},
): ApolloClient {
  const cache =
    options.cache === undefined || options.cache === false
      ? undefined
      : 'read' in options.cache
        ? options.cache
        : createCacheClient(options.cache);

  const run =
    <T, V extends Variables>(
      kind: 'query' | 'mutation',
      document: GraphQLDocument<T, V>,
      rest: DocumentArguments<V>,
    ): Loader<T> =>
    async (request: DataRequest): Promise<T> =>
      load<T>(
        { client, parse, options },
        cache,
        { kind, document, variables: rest[0] ?? {} },
        request,
      );

  const bound: ApolloClient = {
    cache,
    query: <T, V extends Variables>(
      document: GraphQLDocument<T, V>,
      ...rest: DocumentArguments<V>
    ): Loader<T> => run('query', document, rest),
    mutate: <T, V extends Variables>(
      document: GraphQLDocument<T, V>,
      ...rest: DocumentArguments<V>
    ): Loader<T> => run('mutation', document, rest),
    watch: <T, V extends Variables>(
      document: GraphQLDocument<T, V>,
      ...rest: DocumentArguments<V>
    ): readonly [ObservableLike<T>, BridgeOptions] =>
      watch<T>({ client, parse, options }, document, rest[0] ?? {}),
    with: (overrides: ApolloClientOptions): ApolloClient =>
      createApolloClient(client, parse, {
        ...options,
        ...overrides,
        cache: overrides.cache ?? cache ?? false,
      }),
  };
  return bound;
}

/**
 * The headers an operation carries, if any.
 *
 * Untracked: a header function reads a token, and a token is not something a
 * resource may depend on — writing it would re-send every request that built a
 * header from it, including on the way out of a sign-out.
 */
function contextFor(options: ApolloClientOptions): Record<string, unknown> {
  const headers =
    typeof options.headers === 'function' ? untrack(options.headers) : options.headers;
  return headers === undefined ? {} : { context: { headers } };
}

/** What the cached answers belong to: the caller's scope, or the token. */
function identity(options: ApolloClientOptions): string {
  if (options.scope !== undefined) {
    return untrack(options.scope);
  }
  const headers =
    typeof options.headers === 'function' ? untrack(options.headers) : (options.headers ?? {});
  return headers['authorization'] ?? headers['Authorization'] ?? '';
}

/** What this binding was built with. */
type Bound = { client: ApolloLike & WatchLike; parse: Parse; options: ApolloClientOptions };

/** One operation, as Apollo wants it. */
type Operation<T> = {
  kind: 'query' | 'mutation';
  document: GraphQLDocument<T, Variables>;
  variables: Variables;
};

async function send<T>(bound: Bound, operation: Operation<T>, request: DataRequest): Promise<T> {
  const { client, parse, options } = bound;
  const parsed = parse(operation.document.source);
  if (operation.kind === 'mutation') {
    const result = await client.mutate({
      ...options.options,
      ...contextFor(options),
      mutation: parsed,
      variables: operation.variables,
    });
    return result.data as T;
  }
  const result = await client.query({
    ...options.options,
    ...contextFor(options),
    query: parsed,
    variables: operation.variables,
    fetchPolicy: request.force ? 'network-only' : 'cache-first',
  });
  return result.data as T;
}

/**
 * A watched query, as the observable bridge wants it.
 *
 * Apollo's own subscription, wrapped rather than handed over: the bridge asks
 * for `subscribe` and a way to reload, and neither is what `watchQuery`
 * returns.
 */
function watch<T>(
  bound: Bound,
  document: GraphQLDocument<T, Variables>,
  variables: Variables,
): readonly [ObservableLike<T>, BridgeOptions] {
  const watched = bound.client.watchQuery({
    ...bound.options.options,
    ...contextFor(bound.options),
    query: bound.parse(document.source),
    variables,
  });
  return [
    {
      subscribe: (observer: { next?: (value: T) => void; error?: (error: unknown) => void }) =>
        watched.subscribe({
          next: (result) => observer.next?.(result.data as T),
          ...(observer.error === undefined ? {} : { error: observer.error }),
        }),
    },
    { reload: () => watched.refetch() },
  ] as const;
}

/**
 * One operation, answered from the cache when it may be.
 *
 * A mutation is never cached, and neither is a query an action sends: what an
 * action gets back is the answer to doing something.
 */
async function load<T>(
  bound: Bound,
  cache: CacheClient | undefined,
  operation: Operation<T>,
  request: DataRequest,
): Promise<T> {
  const { kind, document, variables } = operation;
  // A query says what it is about; a mutation says what it changed. The
  // request carries whichever of the two it belongs to.
  request.tags?.(
    ...resolveTags(kind === 'mutation' ? document.invalidates : document.tags, variables),
  );
  if (cache === undefined || kind === 'mutation' || request.mutating === true) {
    return await send<T>(bound, operation, request);
  }
  // Stable whatever order the variables were written in, and carrying the
  // identity the answer belongs to.
  const key = `${identity(bound.options)}\u0000${document.operation}(${stableKey(variables)})`;
  return await cache.read<T>(key, (shared) => send<T>(bound, operation, shared))(request);
}
