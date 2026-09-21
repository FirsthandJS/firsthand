/**
 * Apollo Client, as loaders for `@firsthandjs/data`.
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
 *   - **Apollo as the store.** Use `apolloObservable` instead: one write in
 *     Apollo's cache updates every view of that entity at once, which is what
 *     a per-call-site resource cannot do. Also one source of truth.
 *
 * What is not on the list is both at once (ADR-0022).
 *
 * There is no dependency on Apollo here, and no peer dependency either: the
 * shapes below are declared structurally, so this package has no opinion about
 * which version you run, and nothing to follow when that version changes.
 */
import {
  resolveTags,
  type DocumentArguments,
  type GraphQLDocument,
  type LoadContext,
  type Variables,
} from '@firsthandjs/data';

/** The part of an Apollo client this package uses. Nothing else. */
export interface ApolloLike {
  query(options: Record<string, unknown>): Promise<{ data: unknown }>;
  mutate(options: Record<string, unknown>): Promise<{ data?: unknown }>;
}

/**
 * How to turn a document's source into whatever Apollo wants.
 *
 * Apollo takes a parsed `DocumentNode`, which means `gql` from `@apollo/client`
 * or `parse` from `graphql` — your copy of it, not ours, since two copies of
 * `graphql` in one application is its own kind of afternoon.
 */
export type Parse = (source: string) => unknown;

/**
 * Binds an Apollo client so a `.gql` document can be a resource's loader.
 *
 * ```ts
 * import { gql } from '@apollo/client';
 * import { apolloLoader } from '@firsthandjs/data-apollo';
 *
 * const billing = apolloLoader(apollo, gql);
 *
 * const invoices = useResource((context) => billing(InvoicesDocument, { month: month.value })(context));
 * ```
 *
 * The tags come from the document's directives, declared before the request
 * goes out. `force` becomes `fetchPolicy: 'network-only'`, which is what makes
 * an invalidation reach past Apollo's cache.
 */
export function apolloLoader(client: ApolloLike, parse: Parse) {
  // Generic in the variables as well as the result: an operation with required
  // variables then cannot be called without them, and what is passed is checked
  // against the schema the document was generated from.
  return <T, V extends Variables>(document: GraphQLDocument<T, V>, ...rest: DocumentArguments<V>) =>
    async ({ tags, force }: LoadContext): Promise<T> => {
      const variables: Variables = rest[0] ?? {};
      // A mutation is not a resource, so its `@tag` slot is empty and its
      // `@invalidates` directives are what it is about. Passing `tags:
      // invalidates` in an action then wires the document's own declaration
      // straight through to the store.
      const declared = document.kind === 'mutation' ? document.invalidates : document.tags;
      tags(...resolveTags(declared, variables));
      const parsed = parse(document.source);
      if (document.kind === 'mutation') {
        const result = await client.mutate({ mutation: parsed, variables });
        return result.data as T;
      }
      const result = await client.query({
        query: parsed,
        variables,
        fetchPolicy: force ? 'network-only' : 'cache-first',
      });
      return result.data as T;
    };
}

/** A watched query: what Apollo pushes when its cache changes. */
export interface WatchLike {
  watchQuery(options: Record<string, unknown>): {
    subscribe(observer: {
      next?: (value: { data: unknown }) => void;
      error?: (error: unknown) => void;
    }): { unsubscribe: () => void };
    refetch(): Promise<unknown>;
  };
}

/**
 * A document as something that pushes, for `fromObservable`.
 *
 * This is the shape to reach for when the same entity is shown in many places
 * and must stay consistent: Apollo's cache is then the one source of truth,
 * and every view of it updates from the same write at the same moment.
 *
 * ```ts
 * const user = fromObservable(...apolloObservable(apollo, gql)(UserDocument, { id }));
 * ```
 */
export function apolloObservable(client: WatchLike, parse: Parse) {
  return <T, V extends Variables>(
    document: GraphQLDocument<T, V>,
    ...rest: DocumentArguments<V>
  ) => {
    const watched = client.watchQuery({ query: parse(document.source), variables: rest[0] ?? {} });
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
  };
}
