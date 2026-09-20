import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { transform } from './packages/compiler/src/api.js';

/**
 * Runs the real Firsthand compiler over `test/compiled/**`, so the compiled path
 * is executed by the same suite that exercises the runtime JSX path. There is
 * no test-only runtime: both paths call the published protocol.
 */
const firsthandCompiler = {
  name: 'firsthand-compiler',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    const file = id.split('?')[0] as string;
    if (!file.includes('/test/compiled/') || !file.endsWith('.tsx')) {
      return null;
    }
    return {
      code: transform(code, { filename: file, typescript: true, packageName: 'firsthand-test' }),
      map: null,
    };
  },
};

const source = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [firsthandCompiler],
  resolve: {
    // Tests run against source, not against `dist`, so coverage is meaningful
    // and a change does not need a build step to be tested.
    alias: {
      '@firsthandjs/dom/internal': fileURLToPath(
        new URL('./packages/dom/src/internal.ts', import.meta.url),
      ),
      '@firsthandjs/core': source('core'),
      '@firsthandjs/deep': source('deep'),
      '@firsthandjs/compiler': source('compiler'),
      '@firsthandjs/devtools': source('devtools'),
      '@firsthandjs/i18n': source('i18n'),
      '@firsthandjs/dom': source('dom'),
      '@firsthandjs/jsx-runtime/jsx-dev-runtime': source('jsx-runtime'),
      '@firsthandjs/jsx-runtime/jsx-runtime': source('jsx-runtime'),
      '@firsthandjs/jsx-runtime': source('jsx-runtime'),
      '@firsthandjs/query/vite': fileURLToPath(
        new URL('./packages/query/src/vite.ts', import.meta.url),
      ),
      '@firsthandjs/query/codegen': fileURLToPath(
        new URL('./packages/query/src/codegen.ts', import.meta.url),
      ),
      '@firsthandjs/query': source('query'),
      '@firsthandjs/react/auto': fileURLToPath(
        new URL('./packages/react/src/auto.ts', import.meta.url),
      ),
      '@firsthandjs/react': source('react'),
      '@firsthandjs/router': source('router'),
      '@firsthandjs/styled': source('styled'),
      '@firsthandjs/testing': source('testing'),
    },
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@firsthandjs/jsx-runtime',
  },
  test: {
    // `--expose-gc` in the workers, so the WeakRef memory probes can force a
    // collection instead of being skipped (ADR-0011).
    // Vitest 4 flattened `poolOptions.forks.execArgv` into this top-level
    // option, which no longer belongs to one pool — and `--expose-gc` is
    // rejected by Node in a worker thread. Stryker overrides the pool to
    // `threads` from the outside, so the flag is dropped for its run; the
    // memory probes skip themselves when `gc()` is absent, and mutation
    // testing does not target them anyway.
    execArgv: process.env['STRYKER_MUTATOR_WORKER'] === undefined ? ['--expose-gc'] : [],
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          environment: 'node',
          // `deep` joins the core project rather than the DOM one: it is
          // reactivity, and it needs no document to be tested.
          include: ['packages/{core,deep}/test/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: [
            'packages/{dom,jsx-runtime,testing,router,query,styled,react,devtools,i18n}/test/**/*.test.{ts,tsx}',
            'packages/*/test/compiled/**/*.test.tsx',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'types',
          // Type-level assertions: checked by the type checker rather than
          // executed. They cover what a runtime test cannot — that a computed
          // has no setter, that context tokens are not interchangeable, and
          // that props are readonly all the way down.
          include: [],
          typecheck: {
            enabled: true,
            only: true,
            include: ['packages/*/test/**/*.test-d.ts'],
            tsconfig: './tsconfig.typecheck.json',
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'compiler',
          environment: 'node',
          include: ['packages/compiler/test/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        // Production stub for `dev.ts`, aliased in by the build. Its behaviour
        // is "do nothing"; the module it replaces is covered in full. Excluded
        // explicitly rather than hidden behind an ignore comment.
        'packages/*/src/dev.prod.ts',
        // Type-only modules: they emit no JavaScript, so there is nothing to
        // execute and v8 reports them as 0%.
        'packages/*/src/types.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
