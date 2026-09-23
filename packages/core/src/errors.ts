/** Thrown when reactive updates fail to settle, instead of hanging the tab. */
export class FirsthandCycleError extends Error {
  constructor() {
    super(
      'Reactive update did not settle: an effect keeps invalidating its own dependencies. ' +
        'Use untrack() or batch() to break the cycle.',
    );
    this.name = 'FirsthandCycleError';
  }
}

/** Thrown when a context without a default value is read with no provider above. */
export class FirsthandContextError extends Error {
  constructor(description: string) {
    super(`No provider for ${description}, and the context was created without a default value.`);
    this.name = 'FirsthandContextError';
  }
}

/**
 * Thrown inside a task whose run is no longer the current one.
 *
 * It is how `resume()` stops a continuation that has already been replaced or
 * whose scope has gone away: the work unwinds through ordinary `finally`
 * blocks instead of running on and committing a value that belongs to a
 * reality nobody is in any more. A task swallows it — being superseded is the
 * system working, not a failure to report (ADR-0028).
 */
export class FirsthandSupersededError extends Error {
  constructor() {
    super(
      'This task was superseded or its scope was disposed, so it stopped at the next resume().',
    );
    this.name = 'FirsthandSupersededError';
  }
}

/** Thrown when a read-only reactive cell is written to. */
export class FirsthandReadonlyError extends Error {
  constructor() {
    super('Cannot assign to a computed value. Write to the signals it derives from instead.');
    this.name = 'FirsthandReadonlyError';
  }
}
