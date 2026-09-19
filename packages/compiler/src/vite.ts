import { transform } from './api.js';
import type { FirsthandPluginOptions } from './transform.js';

/** Minimal shape of the Vite plugin contract, so the package needs no Vite dependency. */
export interface VitePluginLike {
  name: string;
  enforce: 'pre';
  transform(code: string, id: string): { code: string; map: null } | null;
}

/**
 * Vite/Rollup plugin.
 *
 * Runs before the bundler's TypeScript step: Firsthand parses TS syntax but leaves
 * the annotations in place, so exactly one tool strips them.
 */
export function firsthand(options: FirsthandPluginOptions = {}): VitePluginLike {
  return {
    name: 'firsthand',
    enforce: 'pre',
    transform(code: string, id: string) {
      const file = id.split('?')[0] as string;
      if (!file.endsWith('.tsx') && !file.endsWith('.jsx')) {
        return null;
      }
      return {
        code: transform(code, {
          filename: file,
          typescript: file.endsWith('.tsx'),
          ...options,
        }),
        map: null,
      };
    },
  };
}
