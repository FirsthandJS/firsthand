import { transformSync, type PluginItem } from '@babel/core';
import jsxSyntax from '@babel/plugin-syntax-jsx';
import typescriptSyntax from '@babel/plugin-syntax-typescript';
import firsthandPlugin, { type FirsthandPluginOptions } from './transform.js';

export interface TransformOptions extends FirsthandPluginOptions {
  filename?: string;
  /**
   * Parse TypeScript syntax. The annotations are left in the output: stripping
   * them is the bundler's job, and doing it here would duplicate work and
   * source-map hops.
   */
  typescript?: boolean;
  /** Produce a source map, so a debugger shows the JSX rather than the output. */
  sourceMaps?: boolean;
}

/** A compiled module, and the map back to what was written. */
export interface Compiled {
  code: string;
  /**
   * A source map, when one was asked for.
   *
   * Without it a debugger shows the compiled output: hoisted templates and
   * calls into the runtime protocol, rather than the JSX someone wrote. That
   * is the difference between a framework you can step through and one you
   * cannot, so the Vite plugin always asks.
   */
  map: object | null;
}

/**
 * Compiles one module, and maps it back.
 *
 * The map is Babel's, which tracks the nodes this transform moves. It is
 * approximate where a template was hoisted out of the markup it came from —
 * there is no original position for a `<template>` that the compiler invented
 * — and exact everywhere a statement survived.
 */
export function compileModule(code: string, options: TransformOptions = {}): Compiled {
  // With `babelrc` and `configFile` disabled there is no ignore configuration,
  // so Babel always returns a result with generated code.
  const result = transformSync(code, {
    ...(options.filename === undefined ? {} : { filename: options.filename }),
    babelrc: false,
    configFile: false,
    sourceMaps: options.sourceMaps === true,
    plugins: buildPlugins(options),
  }) as { code: string; map: object | null };
  return { code: result.code, map: result.map };
}

/** Compiles one module. Used by the compiler's own tests. */
export function transform(code: string, options: TransformOptions = {}): string {
  return compileModule(code, options).code;
}

function buildPlugins(options: TransformOptions): PluginItem[] {
  const plugins: PluginItem[] = [];
  if (options.typescript === true) {
    plugins.push([typescriptSyntax, { isTSX: true }]);
  }
  plugins.push(jsxSyntax);
  plugins.push([
    firsthandPlugin,
    {
      packageName: options.packageName,
      strictReactivity: options.strictReactivity,
      devtools: options.devtools,
    },
  ]);
  return plugins;
}
