/**
 * What `@firsthandjs/data` throws.
 *
 * One file rather than one per module, because these are the package's errors
 * rather than the parser's and the transport's: a caller catching them wants
 * them in one place, and each is a class beside its own reason.
 */

/** Thrown for a tag directive the cache cannot make sense of. */
export class FirsthandDirectiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirsthandDirectiveError';
  }
}

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
