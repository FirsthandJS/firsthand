/**
 * REST, which needs almost nothing.
 *
 * `fetch` is already the API; what a cache needs from it is an abort signal
 * wired up and a failed status turned into a thrown error, because a promise
 * that resolves with a 500 makes every caller write the same four lines.
 */
import type { LoadContext } from './store.js';

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
 * What `json` takes: `RequestInit`, plus the one thing the platform lacks.
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
}

/**
 * `fetch` for a JSON endpoint: the abort signal wired up, a failed status
 * thrown, and the body parsed.
 *
 * ```ts
 * const user = useResource(async ({ signal, tags }) => {
 *   tags(tag('user', { id: props.id }));
 *   return json<User>(`/api/users/${props.id}`)({ signal });
 * });
 * ```
 *
 * A write is the same call with a method and a body:
 *
 * ```ts
 * json<Note>('/api/notes', { method: 'POST', json: { title } });
 * json<Upload>('/api/files', { method: 'POST', body: formData });
 * ```
 *
 * This is the platform, not a client. There is no base URL, no instance, no
 * interceptor and no retry here, and there will not be: those belong to a
 * client, and a loader takes any client because it takes any function.
 */
export function json<T>(
  input: string,
  init: JsonRequest = {},
): (context: Pick<LoadContext, 'signal'>) => Promise<T> {
  return async ({ signal }: Pick<LoadContext, 'signal'>): Promise<T> => {
    const { json: payload, ...rest } = init;
    const options: RequestInit = { ...rest, signal };
    if (payload !== undefined) {
      options.body = JSON.stringify(payload);
      // Through `Headers`, because `HeadersInit` is also a list of pairs and
      // spreading one of those produces indices. Set only when the caller has
      // not: an endpoint wanting a `+json` suffix has said so.
      const headers = new Headers(init.headers);
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json');
      }
      options.headers = headers;
    }
    const response = await fetch(input, options);
    // 204 and an empty body are ordinary answers, not parse errors.
    const text = await response.text();
    const parsed: unknown = text === '' ? undefined : JSON.parse(text);
    if (!response.ok) {
      throw new FirsthandHttpError(response.status, input, parsed);
    }
    return parsed as T;
  };
}
