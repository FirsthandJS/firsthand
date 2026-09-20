/**
 * That the plugin fits where a Vite plugin goes.
 *
 * This is the one thing about this package that cannot be checked by using it
 * inside the repository: everything here calls `firsthand()` and reads what it
 * returns, and none of that requires the return value to satisfy Vite's own
 * `PluginOption`. An application's `vite.config.ts` does, and that is where a
 * mismatch turns up — after publishing.
 *
 * It has turned up once, which is why this file exists. `transform` declared
 * its source map as `object`, which is not assignable to Rollup's
 * `SourceMapInput`, and every test in this repository passed.
 */
import { describe, expectTypeOf, it } from 'vitest';
import type { PluginOption } from 'vite';
import { firsthand } from '../src/vite.js';

describe('as a Vite plugin', () => {
  it('is assignable to what `plugins` accepts', () => {
    expectTypeOf(firsthand({ packageName: 'app' })).toExtend<PluginOption>();
  });

  it('is assignable with no options at all', () => {
    expectTypeOf(firsthand()).toExtend<PluginOption>();
  });
});
