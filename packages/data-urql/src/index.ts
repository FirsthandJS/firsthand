/**
 * urql, as loaders for `@firsthandjs/data`.
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
 * import { urqlLoader } from '@firsthandjs/data-urql';
 *
 * const billing = urqlLoader(
 *   new Client({
 *     url: '/graphql',
 *     exchanges: [fetchExchange],
 *     fetchOptions: () => ({ headers: { authorization: `Bearer ${token.value}` } }),
 *   }),
 * );
 *
 * const invoices = useResource((context) => billing(InvoicesDocument, { month: month.value })(context));
 * ```
 *
 * There is no dependency on urql here, and no peer dependency either: the
 * shape below is declared structurally, so this package has no opinion about
 * which version you run. It was checked against `@urql/core` 6, which has no
 * React dependency of its own.
 */
import {
  resolveTags,
  type DocumentArguments,
  type GraphQLDocument,
  type LoadContext,
  type Variables,
} from '@firsthandjs/data';

/** What urql gives back: a wonka source with a promise on it. */
export interface UrqlResult<T> {
  data?: T;
  error?: unknown;
}

/** The part of an urql client this package uses. Nothing else. */
export interface UrqlLike {
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
}

/**
 * Binds a urql client so a `.gql` document can be a resource's loader.
 *
 * The tags come from the document's directives, bound against the variables of
 * this call, and are declared before the request goes out — so an invalidation
 * sent while it is in flight still finds it.
 *
 * `force` becomes `requestPolicy: 'network-only'`, which is what makes an
 * invalidation reach past urql's cache if you kept one.
 */
export function urqlLoader(client: UrqlLike) {
  // Generic in the variables as well as the result: an operation with required
  // variables then cannot be called without them, and what is passed is checked
  // against the schema the document was generated from.
  return <T, V extends Variables>(document: GraphQLDocument<T, V>, ...rest: DocumentArguments<V>) =>
    async ({ tags, force, signal }: LoadContext): Promise<T> => {
      const variables: Variables = rest[0] ?? {};
      // A mutation is not a resource, so its `@tag` slot is empty and its
      // `@invalidates` directives are what it is about. Passing `tags:
      // invalidates` in an action then wires the document's own declaration
      // straight through to the store.
      const declared = document.kind === 'mutation' ? document.invalidates : document.tags;
      tags(...resolveTags(declared, variables));
      // Wrapped rather than taken off the client: a method separated from its
      // object loses `this`, and urql's does use it.
      const send = (source: string, vars: Variables, options: Record<string, unknown>) =>
        document.kind === 'mutation'
          ? client.mutation(source, vars, options)
          : client.query(source, vars, options);
      const result = await send(document.source, variables, {
        fetchOptions: { signal },
        requestPolicy: force ? 'network-only' : 'cache-first',
      }).toPromise();
      if (result.error !== undefined) {
        // Unchanged: a client's own error is more useful than one of ours, and
        // it is what lands in the resource's `error`.
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- urql's CombinedError
        throw result.error;
      }
      return result.data as T;
    };
}
