import { compileModule, type SourceMap } from './api.js';
import type { FirsthandPluginOptions } from './transform.js';

/** Minimal shape of the Vite plugin contract, so the package needs no Vite dependency. */
export type VitePluginLike = {
  name: string;
  enforce: 'pre';
  configResolved(config: { command: string }): void;
  transform(code: string, id: string): { code: string; map: SourceMap | null } | null;
};

/**
 * Vite/Rollup plugin.
 *
 * Runs before the bundler's TypeScript step: Firsthand parses TS syntax but leaves
 * the annotations in place, so exactly one tool strips them.
 */
export type FirsthandViteOptions = FirsthandPluginOptions & {
  /**
   * Files to compile. Everything with a JSX extension, by default.
   *
   * Patterns are regular expressions rather than globs, so that this package
   * keeps its promise of having no dependencies — and so that what matches is
   * something you can read rather than something you have to guess at.
   */
  include?: readonly RegExp[];
  /**
   * Files to leave alone.
   *
   * This is how a project says *these are not mine*: a folder of React
   * components kept during a migration, compiled by React's own transform.
   * What this compiler does not compile, it does not claim — a component from
   * an excluded file reaches the adapter like any other foreign one.
   *
   * ```ts
   * firsthand({ exclude: [/\/legacy\//] })
   * ```
   */
  exclude?: readonly RegExp[];
};

export function firsthand(options: FirsthandViteOptions = {}): VitePluginLike {
  // Naming cells for devtools is a development affair: `serve` turns it on,
  // `build` leaves it off, and an explicit option overrides both.
  let serving = false;
  return {
    name: 'firsthand',
    enforce: 'pre',
    configResolved(config: { command: string }): void {
      serving = config.command === 'serve';
    },
    transform(code: string, id: string) {
      const file = id.split('?')[0] as string;
      if (!file.endsWith('.tsx') && !file.endsWith('.jsx')) {
        return null;
      }
      // Vite reports paths with forward slashes on every platform, so the
      // patterns a project writes mean the same thing everywhere.
      if (options.exclude?.some((pattern) => pattern.test(file)) === true) {
        return null;
      }
      if (options.include !== undefined && !options.include.some((pattern) => pattern.test(file))) {
        return null;
      }
      // The map is what makes a debugger show the JSX that was written rather
      // than the templates and protocol calls it became.
      return compileModule(code, {
        filename: file,
        typescript: file.endsWith('.tsx'),
        devtools: serving,
        sourceMaps: true,
        ...options,
      });
    },
  };
}
