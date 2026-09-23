import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as compiler from '@/index.js';
import * as plugin from '@/transform.js';

describe('package exports', () => {
  it('exposes the transform, the plugin and the id helper', () => {
    expect(typeof compiler.transform).toBe('function');
    expect(typeof compiler.firsthandPlugin).toBe('function');
    expect(typeof compiler.stableId).toBe('function');
  });

  it('exposes the plugin on its own, for a compiler that runs in a browser', () => {
    // `@/index.js` pulls in `@babel/core`, which a browser has no use for.
    // `@firsthandjs/compiler/plugin` is the same plugin with nothing around
    // it, for `@babel/standalone` to register.
    expect(typeof plugin.default).toBe('function');
  });

  it('is free of anything only Node has', () => {
    // The whole reason the id hash is FNV-1a rather than `node:crypto`. A
    // browser import of any of this must not reach for a Node built-in.
    const source = new URL('../src/', import.meta.url);
    const offenders = readdirSync(source)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) =>
        /from '(?:node:|fs'|path'|crypto')/.test(readFileSync(new URL(file, source), 'utf8')),
      );
    expect(offenders).toEqual([]);
  });
});
