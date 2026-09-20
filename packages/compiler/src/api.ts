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

/**
 * A source map, in the shape every bundler expects one.
 *
 * Spelled out rather than typed as `object`, which is what it was: a bundler
 * plugin's `transform` has to return something assignable to Rollup's
 * `SourceMapInput`, and `object` is not. The mistake type-checks everywhere
 * inside this repository and fails in the first application that puts the
 * plugin into `vite.config.ts` — which is the one place it matters.
 */
export interface SourceMap {
  version: number;
  mappings: string;
  names: string[];
  sources: string[];
  // `string[]`, not `(string | null)[]`, although the format allows a null:
  // this type exists to be assignable to a bundler's, and Rollup spells it
  // this way. A map this compiler produces has the source text for its one
  // source, so the looser element type would buy nothing and cost the fit.
  sourcesContent?: string[];
  sourceRoot?: string;
  file?: string;
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
  map: SourceMap | null;
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
    ...(options.filename === undefined
      ? {}
      : {
          filename: options.filename,
          // The full path, not the basename Babel would default to. A map
          // whose `sources` is `comp.tsx` resolves, relative to a module
          // served at `/src/comp.tsx`, to that very URL — so a debugger ends
          // up with two files under one address, shows both, and puts the
          // breakpoint in the wrong one.
          sourceFileName: options.filename,
        }),
    babelrc: false,
    configFile: false,
    sourceMaps: options.sourceMaps === true,
    plugins: buildPlugins(options),
  }) as { code: string; map: SourceMap | null };
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
