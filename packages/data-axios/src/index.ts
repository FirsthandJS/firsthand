/**
 * Axios, as a client for `@firsthandjs/data`.
 *
 * It takes an instance you built and touches one method of it. Your
 * interceptors, your base URL, your authentication, your retry — all of that
 * stays where it is, because a helper that owned the configuration would take
 * control of the thing it is supposed to be helping with, and would then have
 * to follow every option Axios adds (ADR-0022).
 *
 * What it adds is what the resource layer needs and Axios does not have: the
 * abort signal wired up, headers read per request so a token may change, and
 * the shared cache, which an invalidation reaches through (ADR-0023).
 *
 * ```ts
 * import axios from 'axios';
 * import { createAxiosClient } from '@firsthandjs/data-axios';
 *
 * export const accounts = createAxiosClient(axios.create({ baseURL: '/accounts' }), {
 *   headers: () => ({ authorization: `Bearer ${token.value}` }),
 *   cache: { ttl: 30_000 },
 * });
 *
 * const profile = useResource(({ request, tags }) => {
 *   tags(tag('profile', { id: props.id }));
 *   return accounts.get<Profile>(`/profiles/${props.id}`)(request);
 * });
 * ```
 *
 * There is no dependency on Axios here, and no peer dependency either: the
 * shape below is declared structurally, so this package has no opinion about
 * which version you run and nothing to follow when that version changes.
 */
import {
  createCacheClient,
  type CacheClient,
  type CacheOptions,
  type DataRequest,
  type Loader,
} from '@firsthandjs/data';
import { untrack } from '@firsthandjs/core';

/** The part of an Axios instance this package uses. Nothing else. */
export interface AxiosLike {
  request(config: Record<string, unknown>): Promise<{ data: unknown }>;
}

/** An Axios request config, minus the wiring this package does for you. */
export type AxiosRequest = Record<string, unknown>;

export interface AxiosClientOptions {
  /**
   * Headers for every request, merged over the instance's own. A function is
   * called **per request and untracked**, which is what lets a token change
   * without making every resource depend on it.
   */
  readonly headers?: Record<string, string> | (() => Record<string, string>);
  /**
   * Where answers are kept: `false` for none (the default), options for a
   * cache of this client's own, or a `CacheClient` shared with the rest of the
   * application. Only `GET` and `HEAD` are cached, by URL.
   */
  readonly cache?: false | CacheOptions | CacheClient;
  /** Merged into every request: `responseType`, `timeout`, `withCredentials`, … */
  readonly config?: AxiosRequest;
}

export interface AxiosClient {
  /** Any method: the general form the others are named shortcuts for. */
  request<T>(config: AxiosRequest): Loader<T>;
  get<T>(url: string, config?: AxiosRequest): Loader<T>;
  post<T>(url: string, data?: unknown, config?: AxiosRequest): Loader<T>;
  put<T>(url: string, data?: unknown, config?: AxiosRequest): Loader<T>;
  patch<T>(url: string, data?: unknown, config?: AxiosRequest): Loader<T>;
  /** `delete` is a keyword in enough places to be worth avoiding. */
  remove<T>(url: string, config?: AxiosRequest): Loader<T>;
  /** A copy with some options replaced. The cache is shared unless replaced. */
  with(options: AxiosClientOptions): AxiosClient;
  readonly cache: CacheClient | undefined;
}

/**
 * One field of an Axios config, as the string it is meant to be.
 *
 * A config is `Record<string, unknown>` because this package does not depend on
 * Axios, so a caller could put anything under `url`. Anything that is not a
 * string is not one, rather than `[object Object]` in a cache key.
 */
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function createAxiosClient(
  instance: AxiosLike,
  options: AxiosClientOptions = {},
): AxiosClient {
  const cache =
    options.cache === undefined || options.cache === false
      ? undefined
      : 'read' in options.cache
        ? options.cache
        : createCacheClient(options.cache);

  const send = async <T>(config: AxiosRequest, request: DataRequest): Promise<T> => {
    const headers = {
      // Untracked: a header function reads a token, and a token is not
      // something a resource may depend on.
      ...(typeof options.headers === 'function' ? untrack(options.headers) : options.headers),
      ...((config['headers'] as Record<string, string> | undefined) ?? {}),
    };
    const response = await instance.request({
      ...options.config,
      ...config,
      headers,
      signal: request.signal,
    });
    return response.data as T;
  };

  const client: AxiosClient = {
    cache,
    request:
      <T>(config: AxiosRequest): Loader<T> =>
      async (request: DataRequest): Promise<T> => {
        const method = text(config['method'], 'get').toUpperCase();
        // Only a read is cacheable, and only by its URL: a POST is not
        // identified by where it was sent.
        if (cache === undefined || (method !== 'GET' && method !== 'HEAD')) {
          return await send<T>(config, request);
        }
        const key = `${method} ${text(config['baseURL'], '')}${text(config['url'], '')}`;
        return await cache.read<T>(key, (shared) => send<T>(config, shared))(request);
      },
    get: <T>(url: string, config: AxiosRequest = {}): Loader<T> =>
      client.request<T>({ ...config, url, method: 'get' }),
    post: <T>(url: string, data?: unknown, config: AxiosRequest = {}): Loader<T> =>
      client.request<T>({ ...config, url, data, method: 'post' }),
    put: <T>(url: string, data?: unknown, config: AxiosRequest = {}): Loader<T> =>
      client.request<T>({ ...config, url, data, method: 'put' }),
    patch: <T>(url: string, data?: unknown, config: AxiosRequest = {}): Loader<T> =>
      client.request<T>({ ...config, url, data, method: 'patch' }),
    remove: <T>(url: string, config: AxiosRequest = {}): Loader<T> =>
      client.request<T>({ ...config, url, method: 'delete' }),
    with: (overrides: AxiosClientOptions): AxiosClient =>
      createAxiosClient(instance, {
        ...options,
        ...overrides,
        cache: overrides.cache ?? cache ?? false,
      }),
  };
  return client;
}
