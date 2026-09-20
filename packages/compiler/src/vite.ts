import { compileModule, type SourceMap } from './api.js';
import type { FirsthandPluginOptions } from './transform.js';

/** Minimal shape of the Vite plugin contract, so the package needs no Vite dependency. */
export interface VitePluginLike {
  name: string;
  enforce: 'pre';
  configResolved(config: { command: string }): void;
  transform(code: string, id: string): { code: string; map: SourceMap | null } | null;
}

/**
 * Vite/Rollup plugin.
 *
 * Runs before the bundler's TypeScript step: Firsthand parses TS syntax but leaves
 * the annotations in place, so exactly one tool strips them.
 */
export function firsthand(options: FirsthandPluginOptions = {}): VitePluginLike {
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
