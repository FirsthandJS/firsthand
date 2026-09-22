/** The options the Babel plugin takes. */

export type FirsthandPluginOptions = {
  /** Package name used when hashing stable component ids (ADR-0004). */
  packageName?: string;
  /**
   * Refuse to compile a value that is read once in a setup and then kept.
   *
   * **On by default.** The rule only sees declarations whose initialiser is
   * nothing but a read, which is the shape that is almost always a mistake;
   * anything containing a call is left alone. `false` turns it off for a
   * codebase that has such a read on purpose and would rather not mark it with
   * `snapshot()` — see `checkKeptReads` (ADR-0019).
   */
  strictReactivity?: boolean;
  /**
   * Name the cells a module creates, for devtools.
   *
   * A runtime cannot see that `const count = signal(0)` is called `count`, and
   * `new Error().stack` reports a position in the *compiled* module — the
   * browser does not apply source maps to `error.stack`, so the line it names
   * is not the line that was written. The compiler knows both, so it says so.
   *
   * Off by default and turned on by the Vite plugin while serving: a
   * production build emits nothing.
   */
  devtools?: boolean;
  /**
   * Compile for a server render.
   *
   * The same source, emitted against `@firsthandjs/server/internal` instead of
   * `@firsthandjs/dom/internal`: markup is built as a string rather than as
   * nodes, and the things a server cannot do — listeners, refs, retained
   * sites — are not emitted at all.
   *
   * The Vite plugin sets this from the bundler's own `ssr` flag, so an
   * application configures nothing.
   */
  ssr?: boolean;
  /**
   * Emit navigation that can walk server markup.
   *
   * An application that hydrates needs it; one that does not should leave it
   * off, because it turns two property reads per dynamic position into two
   * calls. The Vite plugin sets it for a project that has a server build.
   */
  hydratable?: boolean;
};
