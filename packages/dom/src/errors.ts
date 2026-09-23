/**
 * What `@firsthandjs/dom` throws.
 *
 * Its own file so that the adapter is about resolving a foreign element type
 * and nothing else. Prefixed like every other error in this project, so that
 * `instanceof` cannot be confused by a `ComponentError` from somewhere else.
 */

export class FirsthandComponentError extends Error {
  constructor(name: string) {
    super(
      `${name} is not a Firsthand component. If it is a React component, import ` +
        `'@firsthandjs/react/auto' once at startup to render React components ` +
        `directly, or wrap it with fromReact(). Otherwise, declare it with component().`,
    );
    this.name = 'FirsthandComponentError';
  }
}
