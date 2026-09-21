/**
 * `@firsthandjs/data` — resources, actions and invalidation.
 *
 * What is loaded, as reactive state; what it is about, as tags; and when it
 * has to be loaded again. Not a cache: deduplication, response caching and
 * normalisation belong to the transport, where the knowledge of what is the
 * same thing lives (ADR-0022).
 */
export { createData, DataContext, useData, useInvalidate } from './resource.js';
export { useResource, useAction, fromObservable, fromPromise } from './resource.js';
export type { Action, ObservableLike, BridgeOptions, ResourceOptions } from './resource.js';
export type {
  ActionContext,
  DataOptions,
  DataRequest,
  DataStore,
  LoadContext,
  Loader,
  Resource,
  Status,
  Storage,
} from './store.js';

/**
 * The cache — one of them, and the transport's.
 *
 * `createFetchClient` keeps its answers here, and so does an algorithm of your
 * own: the same `read`, the same lifetimes, and the same `force` reaching
 * through when a resource is invalidated (ADR-0023).
 */
export { createCacheClient } from './cache.js';
export type { CacheClient, CacheOptions } from './cache.js';

export { tag, tagMatches, anyTagMatches } from './tags.js';
export type { Tag, TagVars, Variables } from './tags.js';

export { parseGraphQL, resolveTags, FirsthandDirectiveError } from './document.js';
export type { DocumentArguments, GraphQLDocument, TagTemplate, TagValue } from './document.js';

/**
 * `fetch`, as a client configured once: a base URL, headers read per request
 * so a token may change, a failed status thrown, and the shared cache.
 */
export { createFetchClient, FirsthandHttpError } from './http.js';
export type { FetchClient, FetchClientOptions, JsonRequest } from './http.js';
