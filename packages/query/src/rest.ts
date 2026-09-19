/**
 * REST, which needs almost nothing.
 *
 * `fetch` is already the API; what a cache needs from it is an abort signal
 * wired up and a failed status turned into a thrown error, because a promise
 * that resolves with a 500 makes every caller write the same four lines.
 */
import type { RequestContext } from './client.js';

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
 * A fetcher for a JSON endpoint.
 *
 * ```ts
 * useQuery(() => ({
 *   tags: [tag('user', { id: props.id })],
 *   fetch: json<User>(`/api/users/${props.id}`),
 * }));
 * ```
 */
export function json<T>(
  input: string,
  init: RequestInit = {},
): (context: RequestContext) => Promise<T> {
  return async ({ signal }: RequestContext): Promise<T> => {
    const response = await fetch(input, { ...init, signal });
    // 204 and an empty body are ordinary answers, not parse errors.
    const text = await response.text();
    const body: unknown = text === '' ? undefined : JSON.parse(text);
    if (!response.ok) {
      throw new FirsthandHttpError(response.status, input, body);
    }
    return body as T;
  };
}
