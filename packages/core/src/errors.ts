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

/** Thrown when a read-only reactive cell is written to. */
export class FirsthandReadonlyError extends Error {
  constructor() {
    super('Cannot assign to a computed value. Write to the signals it derives from instead.');
    this.name = 'FirsthandReadonlyError';
  }
}
