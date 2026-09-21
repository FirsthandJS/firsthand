/**
 * `fetch`, as a client you configure once.
 *
 * The platform is already the API, so this adds exactly what an application
 * otherwise writes by hand for every call: a base URL, headers read *per
 * request* so that a token may change, a failed status thrown rather than
 * resolved, the abort signal wired through, and a cache that an invalidation
 * can reach past.
 *
 * ```ts
 * export const api = createFetchClient({
 *   baseUrl: '/api',
 *   // Read per request, and untracked: the token may change, and a resource
 *   // must not depend on it (a sign-out would re-send everything).
 *   headers: () => ({ authorization: `Bearer ${token.value}` }),
 *   cache: { ttl: 30_000 },
 * });
 *
 * const user = useResource(({ request, tags }) => {
 *   tags(tag('user', { id: props.id }));
 *   return api.get<User>(`/users/${props.id}`)(request);
 * });
 * ```
 *
 * What it is not is a client library. There are no interceptors, no retries,
 * no token refresh and no XSRF here: `fetch` is a seam of its own, so an
 * application that wants those wraps the one function and keeps the wrapping
 * where it can see it.
 */
import { untrack } from '@firsthandjs/core';
import { createCacheClient, type CacheClient, type CacheOptions } from './cache.js';
import type { DataRequest, Loader } from './store.js';

/**
 * Thrown for any response outside 2xx.
 *
 * Prefixed like every other error here, so that `instanceof` cannot be confused
 * by an `HttpError` from somewhere else in an application.
 */
export class FirsthandHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    /** The parsed body, if there was one. */
    readonly body: unknown,
  ) {
    super(`HTTP ${String(status)} for ${url}`);
    this.name = 'FirsthandHttpError';
  }
}

/**
 * What a call takes: `RequestInit`, plus the one thing the platform lacks.
 *
 * `method`, `credentials`, `mode`, `headers` and the rest are passed straight
 * through. So is `body`: a `FormData`, a `URLSearchParams` or a `Blob` is
 * labelled by the platform itself, boundary and all, and nothing here could
 * improve on that.
 *
 * JSON is the exception, and the only one — measured: a stringified object is
 * a string, so `fetch` labels it `text/plain`. `json:` is the two lines every
 * codebase writes to fix that.
 */
export interface JsonRequest extends Omit<RequestInit, 'body'> {
  readonly body?: BodyInit | null;
  /** Sent as JSON, with the content type the platform will not set for you. */
  readonly json?: unknown;
  /**
   * Where this call's answer is kept: a key of your own, or `false` for
   * nowhere.
   *
   * A key is for when the URL is not the identity — a POST that reads, say.
   * It must then carry **everything that varies**, the body included:
   * `` cacheKey: `search:${stableKey(body)}` `` rather than `'search'`, or
   * two different searches share one answer. The client's identity scope is added
   * for you either way.
   *
   * `false` is for the read that must never be served from memory. The
   * platform's own `cache` option is untouched and still passed to `fetch`,
   * because that one is the HTTP cache and a different thing entirely.
   *
   * A *lifetime* belongs to the cache rather than to a call, so it is set once
   * in `createFetchClient({ cache: { ttl } })`, or on a variation of the client
   * made with `.with({ cache: { ttl } })`.
   */
  readonly cacheKey?: string | false;
}

export type FetchClientOptions = {
  /** Prefixed to every relative path. A path beginning with `http` is left alone. */
  readonly baseUrl?: string;
  /**
   * Headers for every request. A function is called **per request and
   * untracked**, which is what lets a token change without making every
   * resource depend on it.
   */
  readonly headers?: HeadersInit | (() => HeadersInit);
  /**
   * Where answers are kept. `false` for none (the default), options for a
   * cache of this client's own, or a `CacheClient` shared with the rest of the
   * application.
   */
  readonly cache?: false | CacheOptions | CacheClient;
  /** Applied to every request: `credentials`, `mode`, `referrerPolicy`, … */
  readonly init?: RequestInit;
  /**
   * Who the cached answers belong to.
   *
   * A cache keyed by URL alone is a cache that can serve one account's answer
   * to the next one, because `GET /api/me` is the same URL for everybody. So
   * the key carries an identity, and by default that identity is the
   * `authorization` header this request would be sent with — which means the
   * dangerous case is handled without anybody opting in.
   *
   * Set this when the identity is somewhere else: a cookie session, a tenant
   * header, an account picker. It is read per request and untracked, like
   * `headers`. Returning `''` says every caller shares one cache.
   *
   * Clearing the cache on sign-out (`client.cache?.forget()`) is still worth
   * doing — it frees the memory, and it is what `store.clear()` is beside —
   * but forgetting to is no longer a correctness bug.
   */
  readonly scope?: () => string;
  /**
   * The seam. Wrap `fetch` to log, to retry, or to end a session on a 401 —
   * and keep that in one place rather than in a plugin system.
   */
  readonly fetch?: typeof globalThis.fetch;
};

export type FetchClient = {
  /** Any method: the general form the others are named shortcuts for. */
  request<T>(url: string, init?: JsonRequest): Loader<T>;
  get<T>(url: string, init?: JsonRequest): Loader<T>;
  post<T>(url: string, init?: JsonRequest): Loader<T>;
  put<T>(url: string, init?: JsonRequest): Loader<T>;
  patch<T>(url: string, init?: JsonRequest): Loader<T>;
  /** `delete` is a keyword in enough places to be worth avoiding. */
  remove<T>(url: string, init?: JsonRequest): Loader<T>;
  /**
   * A copy with some options replaced: another base URL, other headers, no
   * cache. The cache is shared unless this call replaces it, so a specialised
   * client is a variation rather than a second application.
   */
  with(options: FetchClientOptions): FetchClient;
  /** The cache this client keeps its answers in, if it has one. */
  readonly cache: CacheClient | undefined;
};

/** Everything a request needs, after the client's options and the call's are merged. */
function resolve(
  options: FetchClientOptions,
  url: string,
  init: JsonRequest,
): [string, RequestInit] {
  const target = /^[a-z]+:\/\//i.test(url) ? url : `${options.baseUrl ?? ''}${url}`;
  const { json: payload, cacheKey: _key, ...rest } = init;
  const merged: RequestInit = { ...options.init, ...rest };
  // Through `Headers`, because `HeadersInit` is also a list of pairs and
  // spreading one of those produces indices.
  const headers = new Headers(
    // Untracked: a header function reads a token, and a token is not something
    // a resource may depend on — writing it would re-send every request that
    // built a header from it, including on the way out of a sign-out.
    typeof options.headers === 'function' ? untrack(options.headers) : options.headers,
  );
  for (const [name, value] of new Headers(init.headers ?? {})) {
    headers.set(name, value);
  }
  if (payload !== undefined) {
    merged.body = JSON.stringify(payload);
    // Set only when the caller has not: an endpoint wanting a `+json` suffix
    // has said so.
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
  }
  merged.headers = headers;
  return [target, merged];
}

async function send<T>(
  options: FetchClientOptions,
  url: string,
  init: RequestInit,
  request: DataRequest,
): Promise<T> {
  const call = options.fetch ?? globalThis.fetch;
  const response = await call(url, { ...init, signal: request.signal });
  // 204 and an empty body are ordinary answers, not parse errors.
  const text = await response.text();
  const parsed: unknown = text === '' ? undefined : JSON.parse(text);
  if (!response.ok) {
    throw new FirsthandHttpError(response.status, url, parsed);
  }
  return parsed as T;
}

export function createFetchClient(options: FetchClientOptions = {}): FetchClient {
  const cache =
    options.cache === undefined || options.cache === false
      ? undefined
      : 'read' in options.cache
        ? options.cache
        : createCacheClient(options.cache);

  const client: FetchClient = {
    cache,
    request:
      <T>(url: string, init: JsonRequest = {}): Loader<T> =>
      async (request: DataRequest): Promise<T> => {
        const [target, merged] = resolve(options, url, init);
        const method = (merged.method ?? 'GET').toUpperCase();
        // Who this answer belongs to. The default is the authorization header
        // the request carries, so two accounts in one session cannot read
        // each other's answers out of one URL-shaped key.
        const scope =
          options.scope === undefined
            ? ((merged.headers as Headers).get('authorization') ?? '')
            : untrack(options.scope);
        // Only a read is cacheable, and only by its URL: a POST is not
        // identified by where it was sent, and a body may be a stream nobody
        // can key on. `cache: 'key'` is how a reading POST says otherwise.
        const named =
          typeof init.cacheKey === 'string'
            ? init.cacheKey
            : method === 'GET' || method === 'HEAD'
              ? `${method} ${target}`
              : undefined;
        // Two parts, separated by a character a URL cannot contain: an
        // identity and a request. Neither can be mistaken for the other.
        const key = named === undefined ? undefined : `${scope}\u0000${named}`;
        if (
          cache === undefined ||
          init.cacheKey === false ||
          key === undefined ||
          // An action. Even a `cacheKey` does not put its answer in here: the
          // call site asked for a key, not for its writes to be remembered.
          request.mutating === true
        ) {
          return await send<T>(options, target, merged, request);
        }
        return await cache.read<T>(key, (shared) => send<T>(options, target, merged, shared))(
          request,
        );
      },
    get: <T>(url: string, init: JsonRequest = {}): Loader<T> => client.request<T>(url, init),
    post: <T>(url: string, init: JsonRequest = {}): Loader<T> =>
      client.request<T>(url, { method: 'POST', ...init }),
    put: <T>(url: string, init: JsonRequest = {}): Loader<T> =>
      client.request<T>(url, { method: 'PUT', ...init }),
    patch: <T>(url: string, init: JsonRequest = {}): Loader<T> =>
      client.request<T>(url, { method: 'PATCH', ...init }),
    remove: <T>(url: string, init: JsonRequest = {}): Loader<T> =>
      client.request<T>(url, { method: 'DELETE', ...init }),
    with: (overrides: FetchClientOptions): FetchClient =>
      createFetchClient({
        ...options,
        ...overrides,
        // The cache is the one option that is shared rather than rebuilt: a
        // specialised client is a variation of this one, not a second
        // application with its own memory.
        cache: overrides.cache ?? cache ?? false,
      }),
  };
  return client;
}
