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
}

/** Compiles one module. Used by the Vite plugin and by the compiler tests. */
export function transform(code: string, options: TransformOptions = {}): string {
  // With `babelrc` and `configFile` disabled there is no ignore configuration,
  // so Babel always returns a result with generated code.
  const result = transformSync(code, {
    ...(options.filename === undefined ? {} : { filename: options.filename }),
    babelrc: false,
    configFile: false,
    sourceMaps: false,
    plugins: buildPlugins(options),
  });
  return (result as { code: string }).code;
}

function buildPlugins(options: TransformOptions): PluginItem[] {
  const plugins: PluginItem[] = [];
  if (options.typescript === true) {
    plugins.push([typescriptSyntax, { isTSX: true }]);
  }
  plugins.push(jsxSyntax);
  plugins.push([firsthandPlugin, { packageName: options.packageName }]);
  return plugins;
}
