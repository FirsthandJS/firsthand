/**
 * urql, as a client for `@firsthandjs/data`.
 *
 * It takes a client you built and touches two of its methods. Your exchanges,
 * your authentication, your retry policy stay where they are — including, and
 * this is the one that matters, whether you keep `cacheExchange`. Without it
 * urql is your transport and the resources are your state; with it urql also
 * caches, which is a decision worth making on purpose rather than inheriting
 * from a helper (ADR-0022).
 *
 * ```ts
 * import { Client, fetchExchange } from '@urql/core';
 * import { createUrqlClient } from '@firsthandjs/data-urql';
 *
 * export const billing = createUrqlClient(
 *   new Client({ url: '/graphql', exchanges: [fetchExchange] }),
 *   // Read per request and untracked: the token may change, and a resource
 *   // must not depend on it.
 *   { headers: () => ({ authorization: `Bearer ${token.value}` }) },
 * );
 *
 * const invoices = useResource(({ request }) =>
 *   billing.query(InvoicesDocument, { month: month.value })(request),
 * );
 * ```
 *
 * There is no dependency on urql here, and no peer dependency either: the
 * shapes below are declared structurally, so this package has no opinion about
 * which version you run. It was checked against `@urql/core` 6, which has no
 * React dependency of its own.
 */
import {
  createCacheClient,
  resolveTags,
  stableKey,
  type CacheClient,
  type CacheOptions,
  type DataRequest,
  type DocumentArguments,
  type GraphQLDocument,
  type Loader,
  type Variables,
} from '@firsthandjs/data';
import { untrack } from '@firsthandjs/core';

/** What urql gives back: a wonka source with a promise on it. */
export type UrqlResult<T> = {
  data?: T;
  error?: unknown;
};

/** The part of an urql client this package uses. Nothing else. */
export type UrqlLike = {
  query(
    document: string,
    variables: Variables,
    context?: Record<string, unknown>,
  ): { toPromise(): Promise<UrqlResult<unknown>> };
  mutation(
    document: string,
    variables: Variables,
    context?: Record<string, unknown>,
  ): { toPromise(): Promise<UrqlResult<unknown>> };
};

export type UrqlClientOptions = {
  /**
   * Headers for every request, sent through urql's `fetchOptions`. A function
   * is called **per request and untracked**, which is what lets a token change
   * without making every resource depend on it.
   */
  readonly headers?: Record<string, string> | (() => Record<string, string>);
  /**
   * A cache in front of urql: `false` (the default, because urql has one of
   * its own if you kept `cacheExchange`), options for a cache of this client's
   * own, or a `CacheClient` shared with the rest of the application. Queries
   * only, keyed by operation and variables.
   */
  readonly cache?: false | CacheOptions | CacheClient;
  /**
   * Who the cached answers belong to. Defaults to the `authorization` header
   * this request would carry, so two accounts in one session cannot read each
   * other's answers out of one operation-shaped key. Read per request,
   * untracked.
   */
  readonly scope?: () => string;
  /** Merged into urql's operation context for every request. */
  readonly context?: Record<string, unknown>;
};

export type UrqlClient = {
  /**
   * A query, as a loader. Declares the document's `@tag` directives before the
   * request goes out, so an invalidation sent while it is in flight finds it.
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
  /** A copy with some options replaced. The cache is shared unless replaced. */
  with(options: UrqlClientOptions): UrqlClient;
  readonly cache: CacheClient | undefined;
};

export function createUrqlClient(client: UrqlLike, options: UrqlClientOptions = {}): UrqlClient {
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
    async (request: DataRequest): Promise<T> => {
      const variables: Variables = rest[0] ?? {};
      // A query says what it is about; a mutation says what it changed. In a
      // resource the first lands on the resource's tags, in an action the
      // second lands on the store's invalidation — one call, because the
      // request carries whichever of the two it is.
      request.tags?.(
        ...resolveTags(kind === 'mutation' ? document.invalidates : document.tags, variables),
      );
      // A mutation is never cached, and neither is a query an action sends:
      // what an action gets back is the answer to doing something.
      if (cache === undefined || kind === 'mutation' || request.mutating === true) {
        return await send<T>(client, options, { kind, source: document.source, variables }, request);
      }
      // Stable whatever order the variables were written in, and carrying the
      // identity the answer belongs to.
      const key = `${identity(options)}\u0000${document.operation}(${stableKey(variables)})`;
      return await cache.read<T>(key, (shared) =>
        send<T>(client, options, { kind, source: document.source, variables }, shared),
      )(request);
    };

  const bound: UrqlClient = {
    cache,
    query: <T, V extends Variables>(
      document: GraphQLDocument<T, V>,
      ...rest: DocumentArguments<V>
    ): Loader<T> => run('query', document, rest),
    mutate: <T, V extends Variables>(
      document: GraphQLDocument<T, V>,
      ...rest: DocumentArguments<V>
    ): Loader<T> => run('mutation', document, rest),
    with: (overrides: UrqlClientOptions): UrqlClient =>
      createUrqlClient(client, {
        ...options,
        ...overrides,
        cache: overrides.cache ?? cache ?? false,
      }),
  };
  return bound;
}

/** What the cached answers belong to: the caller's scope, or the token. */
function identity(options: UrqlClientOptions): string {
  if (options.scope !== undefined) {
    return untrack(options.scope);
  }
  const headers =
    typeof options.headers === 'function' ? untrack(options.headers) : (options.headers ?? {});
  return headers['authorization'] ?? headers['Authorization'] ?? '';
}

/** One operation, as urql wants it. */
type Operation = { kind: 'query' | 'mutation'; source: string; variables: Variables };

/**
 * Sends one operation.
 *
 * Untracked headers: a header function reads a token, and a token is not
 * something a resource may depend on — writing it would re-send every request
 * that built a header from it, including on the way out of a sign-out.
 */
async function send<T>(
  client: UrqlLike,
  options: UrqlClientOptions,
  operation: Operation,
  request: DataRequest,
): Promise<T> {
  const headers =
    typeof options.headers === 'function' ? untrack(options.headers) : options.headers;
  const context = {
    ...options.context,
    fetchOptions: {
      signal: request.signal,
      ...(headers === undefined ? {} : { headers }),
    },
    // What makes an invalidation reach past urql's own cache, if you kept one.
    requestPolicy: request.force ? 'network-only' : 'cache-first',
  };
  // Wrapped rather than taken off the client: a method separated from its
  // object loses `this`, and urql's does use it.
  const sent =
    operation.kind === 'mutation'
      ? client.mutation(operation.source, operation.variables, context)
      : client.query(operation.source, operation.variables, context);
  const result = await sent.toPromise();
  if (result.error !== undefined) {
    // Unchanged: a client's own error is more useful than one of ours, and it
    // is what lands in the resource's `error`.
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- urql's CombinedError
    throw result.error;
  }
  return result.data as T;
}
