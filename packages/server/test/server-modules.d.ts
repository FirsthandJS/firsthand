/**
 * `?server` compiles a module a second time, for a server render.
 *
 * The suffix is handled by the compiler plugin in `vitest.config.ts`. The
 * module's shape is the shape of the file without the suffix — it is the same
 * source — so the import is cast to that at the use site rather than described
 * again here.
 */
declare module '*?server' {
  const module: Record<string, unknown>;
  export default module;
}
