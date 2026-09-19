/**
 * The only two host globals `@firsthandjs/core` uses. Declared here instead of
 * pulling in the DOM lib, so that the package stays provably DOM-free and
 * loadable in a worker or on a server.
 */
declare const console: { warn(...args: unknown[]): void };
declare function queueMicrotask(callback: () => void): void;
