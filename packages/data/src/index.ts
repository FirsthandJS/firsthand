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
  DataStore,
  LoadContext,
  Resource,
  Status,
  Storage,
} from './store.js';

export { tag, tagMatches, anyTagMatches } from './tags.js';
export type { Tag, TagVars, Variables } from './tags.js';

export { parseGraphQL, resolveTags, FirsthandDirectiveError } from './document.js';
export type { DocumentArguments, GraphQLDocument, TagTemplate, TagValue } from './document.js';

/**
 * `fetch`, with the three things a resource needs from it.
 *
 * The platform, not a vendor: no base URLs, no instances, no interceptors, no
 * retry. Those belong to a client, and a loader takes any client because it
 * takes any function.
 */
export { json, FirsthandHttpError } from './http.js';
export type { JsonRequest } from './http.js';
