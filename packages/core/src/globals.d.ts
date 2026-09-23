/**
 * The only two host globals `@firsthandjs/core` uses. Declared here instead of
 * pulling in the DOM lib, so that the package stays provably DOM-free and
 * loadable in a worker or on a server.
 */
declare const console: { warn(...args: unknown[]): void };
declare function queueMicrotask(callback: () => void): void;

/**
 * Abort, declared rather than imported.
 *
 * `task()` needs these two and nothing else of the host. They are in every
 * browser, every worker and Node, but not in `lib.es2022`, and adding the DOM
 * lib to this package to reach them would give up the property the file above
 * exists to keep. The shapes are written to match `lib.dom.d.ts` exactly, so
 * that a build which *does* include the DOM lib merges these declarations
 * instead of colliding with them.
 */
interface AbortSignal {
  readonly aborted: boolean;
}

interface AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

declare const AbortController: {
  prototype: AbortController;
  new (): AbortController;
};
