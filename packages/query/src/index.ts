/**
 * `@firsthandjs/query` — tag-based data fetching for REST and GraphQL.
 *
 * The difference from React Query is what invalidation is expressed in terms
 * of. There, a query's key is also its invalidation handle, so a mutation has
 * to know the key shapes other people wrote. Here a query carries **tags** —
 * `user(id: 7)`, `users`, `permissions(org: 3)` — and a mutation invalidates
 * tags. One mutation reaches every query about user 7 without naming any of
 * them, and `tag('user')` with no variables reaches every user at once.
 *
 * ```tsx
 * const user = useQuery<User>(() => ({
 *   tags: [tag('user', { id: props.id })],
 *   fetch: json(`/api/users/${props.id}`),
 * }));
 *
 * const rename = useMutation({
 *   mutate: (input: { id: number; name: string }) =>
 *     json('/api/rename', { method: 'POST', body: JSON.stringify(input) })({ signal }),
 *   invalidates: (_result, input) => [tag('user', { id: input.id }), tag('users')],
 * });
 *
 * // In the view — three separate fine-grained reads.
 * <p class={user.fetching.value ? 'stale' : ''}>{user.data.value?.name}</p>;
 * ```
 */
export { createQueryClient } from './client.js';
export { variablesKey } from './client.js';
export type {
  FetchContext,
  RequestContext,
  Variables,
  LoadOptions,
  QueryClient,
  QueryClientOptions,
  QueryDefinition,
  QueryEntry,
  QueryResult,
  QueryStatus,
} from './client.js';
export { QueryClientContext, useQuery, useQueryClient, useMutation } from './hooks.js';
export type { MutationOptions, MutationResult, UseQueryOptions } from './hooks.js';
export { tag, tagKey, tagsKey, tagMatches, anyTagMatches } from './tags.js';
export type { Tag, TagVars } from './tags.js';
export { json, FirsthandHttpError } from './rest.js';
export {
  GraphQLContext,
  FirsthandGraphQLError,
  createGraphQLApi,
  createGraphQLTransport,
  useGraphQL,
  useGraphQLMutation,
} from './graphql.js';
export type {
  GraphQLApi,
  GraphQLTransport,
  MutationArguments,
  TransportOptions,
} from './graphql.js';
export { parseGraphQL, resolveTags, FirsthandDirectiveError } from './document.js';
export type { GraphQLDocument, TagTemplate, TagValue } from './document.js';
