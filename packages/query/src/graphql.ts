/**
 * The GraphQL transport, and the hooks that use it.
 *
 * Parsing lives in `document.ts`, which depends on nothing but tags, so the
 * build-time `.graphql` loader can import it without dragging the runtime
 * along.
 */
import { useContext, createContext } from '@firsthandjs/core';
import { resolveTags, type GraphQLDocument } from './document.js';
import type { Tag } from './tags.js';
import { variablesKey, type QueryResult, type RequestContext, type Variables } from './client.js';
import {
  useMutation,
  useQuery,
  type MutationOptions,
  type MutationResult,
  type UseQueryOptions,
} from './hooks.js';

/**
 * The arguments after the document.
 *
 * An operation with variables must be given them; one without may be called
 * with the document alone. The tuple is what makes both true at once —
 * `variables?:` for everything would let a typed query be called with none.
 */
export type QueryArguments<TVariables extends Variables> =
  Record<string, never> extends TVariables
    ? [variables?: () => TVariables, options?: () => UseQueryOptions]
    : [variables: () => TVariables, options?: () => UseQueryOptions];

/** What sends a document to a server. */
export type GraphQLTransport = (
  // Any document: a transport sends what it is given and never looks at the
  // phantom types.
  document: GraphQLDocument<unknown, Variables>,
  variables: Variables,
  context: RequestContext,
) => Promise<unknown>;

export const GraphQLContext = createContext<GraphQLTransport>();

/**
 * Errors a GraphQL response reported, as one thrown value.
 *
 * Named `FirsthandGraphQLError` rather than `GraphQLError`, which `graphql-js`
 * already exports: an application using both must be able to tell them apart.
 */
export class FirsthandGraphQLError extends Error {
  constructor(readonly errors: readonly { readonly message: string }[]) {
    super(errors.map((error) => error.message).join('; '));
    this.name = 'FirsthandGraphQLError';
  }
}

export interface TransportOptions {
  readonly url: string;
  /** Static, or read per request — which is where an auth token belongs. */
  readonly headers?: Readonly<Record<string, string>> | (() => Readonly<Record<string, string>>);
  /** Replaced in tests, and by anything that wraps `fetch`. */
  readonly fetch?: typeof fetch;
}

export function createGraphQLTransport(options: TransportOptions): GraphQLTransport {
  const send = options.fetch ?? globalThis.fetch;
  return async (document, variables, context) => {
    const headers = typeof options.headers === 'function' ? options.headers() : options.headers;
    const response = await send(options.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({
        query: document.source,
        operationName: document.operation === '' ? undefined : document.operation,
        variables,
      }),
      signal: context.signal,
    });
    const payload = (await response.json()) as {
      data?: unknown;
      errors?: { message: string }[];
    };
    if (payload.errors !== undefined && payload.errors.length > 0) {
      throw new FirsthandGraphQLError(payload.errors);
    }
    return payload.data;
  };
}

/**
 * Watches a GraphQL query.
 *
 * Its tags come from the document, bound against `variables`. Its cache
 * identity is the operation plus those variables, so two operations that share
 * a tag still keep their own data.
 */
export function useGraphQL<TData, TVariables extends Variables>(
  document: GraphQLDocument<TData, TVariables>,
  ...rest: QueryArguments<TVariables>
): QueryResult<TData> {
  return query(useContext(GraphQLContext).value, document, ...rest);
}

/** The body of `useGraphQL`, against a transport rather than the context one. */
function query<TData, TVariables extends Variables>(
  transport: GraphQLTransport,
  document: GraphQLDocument<TData, TVariables>,
  ...rest: QueryArguments<TVariables>
): QueryResult<TData> {
  const [variables = (): TVariables => ({}) as TVariables, options] = rest;
  return useQuery<TData, TVariables>(() => {
    const vars = variables();
    return {
      tags: resolveTags(document.tags, vars),
      variables: vars,
      // The operation is part of the identity too, so two operations that
      // happen to share a tag and its variables still keep their own data.
      key: `${document.operation}|${variablesKey(vars)}`,
      fetch: (context) => transport(document, vars, context) as Promise<TData>,
    };
  }, options);
}

/**
 * A GraphQL mutation. What it invalidates is read from its `@invalidates`
 * directives, bound against the variables of the call that ran it.
 */
export function useGraphQLMutation<TData, TVariables extends Variables>(
  document: GraphQLDocument<TData, TVariables>,
  options: MutationArguments<TData, TVariables> = {},
): MutationResult<TVariables, TData> {
  return mutation(useContext(GraphQLContext).value, document, options);
}

/** The options `useGraphQLMutation` takes, named so an API can restate them. */
export type MutationArguments<TData, TVariables extends Variables> = Omit<
  MutationOptions<TVariables, TData>,
  'mutate' | 'invalidates'
> & {
  readonly invalidates?: MutationOptions<TVariables, TData>['invalidates'];
};

/** The body of `useGraphQLMutation`, against a given transport. */
function mutation<TData, TVariables extends Variables>(
  transport: GraphQLTransport,
  document: GraphQLDocument<TData, TVariables>,
  options: MutationArguments<TData, TVariables> = {},
): MutationResult<TVariables, TData> {
  return useMutation<TVariables, TData>({
    ...options,
    mutate: (input, context) => transport(document, input, context) as Promise<TData>,
    invalidates:
      options.invalidates ??
      ((_result: TData, input: TVariables): Tag[] => resolveTags(document.invalidates, input)),
  });
}

/**
 * One GraphQL endpoint, as an object.
 *
 * `useGraphQL` reads the transport out of `GraphQLContext`, which is the right
 * shape while there is one API — and there usually is. An application with two
 * cannot use it for the second: a context holds one value per subtree, and the
 * case that matters is a single component reading from both.
 *
 * ```ts
 * export const billing = createGraphQLApi(createGraphQLTransport({ url: '/billing/graphql' }));
 * export const catalog = createGraphQLApi(createGraphQLTransport({ url: '/catalog/graphql' }));
 *
 * const invoices = billing.useQuery(InvoicesDocument);
 * const products = catalog.useQuery(ProductsDocument);   // same component, other server
 * ```
 *
 * Everything else is unchanged: one cache, one set of tags, the same
 * deduplication and invalidation. Which means tags are shared across APIs, so
 * two servers that both have a `user` want distinct tag names —
 * `billing:user` and `catalog:user` — or a mutation on one will invalidate a
 * query on the other.
 */
export interface GraphQLApi {
  useQuery<TData, TVariables extends Variables>(
    document: GraphQLDocument<TData, TVariables>,
    ...rest: QueryArguments<TVariables>
  ): QueryResult<TData>;
  useMutation<TData, TVariables extends Variables>(
    document: GraphQLDocument<TData, TVariables>,
    options?: MutationArguments<TData, TVariables>,
  ): MutationResult<TVariables, TData>;
}

/** Binds the GraphQL hooks to one transport. See {@link GraphQLApi}. */
export function createGraphQLApi(transport: GraphQLTransport): GraphQLApi {
  return {
    useQuery: (document, ...rest) => query(transport, document, ...rest),
    useMutation: (document, options) => mutation(transport, document, options),
  };
}
