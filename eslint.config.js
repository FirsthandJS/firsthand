import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// `tseslint.config` composes typed config arrays; ESLint's own `defineConfig`
// does not accept them directly yet.
// eslint-disable-next-line @typescript-eslint/no-deprecated
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/__snapshots__/**',
      'benchmarks/results/**',
      // Maintainer-only tooling, kept out of the published tree entirely.
      'internal/**',
      '.stryker-tmp/**',
      'reports/**',
      // A separate project with its own toolchain, its own tsconfig and its
      // own dependencies — linting it from here would mean installing
      // Storybook to work on the framework. It has its own checks:
      // `npm test` there builds it and drives the stories in a browser.
      'integrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.eslint.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // `unknown` with narrowing, never an unchecked `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Reading a signal for its side effect on tracking is idiomatic here.
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Devtools are a tool for the console, so they may use it. `info` rather
    // than `warn`: attaching is not a problem, and dressing it as one would
    // train people to ignore the warnings that are.
    files: ['packages/devtools/src/**/*.ts'],
    rules: {
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
    },
  },
  {
    // The reactive core must stay loadable without a DOM.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'document',
          message: '@firsthandjs/core must not touch the DOM (ARCHITECTURE §1).',
        },
        { name: 'window', message: '@firsthandjs/core must not touch the DOM (ARCHITECTURE §1).' },
      ],
      'no-restricted-imports': ['error', { patterns: ['@firsthandjs/*'], paths: [] }],
    },
  },
  {
    // The DOM layer may depend on the core, and on nothing else.
    files: ['packages/dom/src/**/*.ts'],
    rules: {
      // Writing an arbitrary value into a text node or an attribute is the
      // platform's own behaviour, including `[object Object]` for a plain
      // object. Firsthand does not second-guess it, and does not serialise.
      '@typescript-eslint/no-base-to-string': 'off',
      'no-restricted-imports': [
        'error',
        { patterns: ['@firsthandjs/compiler*', '@firsthandjs/jsx-runtime*'] },
      ],
    },
  },
  {
    // The optional packages sit on top of the runtime and know nothing about
    // each other: the router must work without the cache, and the cache
    // without the router.
    files: [
      'packages/router/src/**/*.ts',
      'packages/query/src/**/*.ts',
      'packages/styled/src/**/*.ts',
      'packages/react/src/**/*.ts',
    ],
    rules: {
      // Writing an arbitrary value into CSS or into a React prop is the
      // platform's behaviour, including `[object Object]`. These packages do
      // not second-guess it, exactly as the DOM layer does not.
      '@typescript-eslint/no-base-to-string': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@firsthandjs/compiler*',
            '@firsthandjs/router*',
            '@firsthandjs/query*',
            '@firsthandjs/styled*',
            '@firsthandjs/react*',
          ],
        },
      ],
    },
  },
  {
    // `declare global { namespace JSX }` is the only way to say what TSX
    // accepts: the rule is about namespaces as modules, and this is not one.
    files: ['packages/jsx-runtime/src/index.ts', 'packages/react/src/auto.ts'],
    rules: { '@typescript-eslint/no-namespace': 'off' },
  },
  {
    // The compiler is build-time only: it must not import the runtime.
    files: ['packages/compiler/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@firsthandjs/core*', '@firsthandjs/dom*', '@firsthandjs/jsx-runtime*'] },
      ],
    },
  },
  {
    files: [
      '**/test/**/*.ts',
      '**/test/**/*.tsx',
      'tests/**/*',
      'scripts/**/*.mjs',
      'benchmarks/**/*',
      'examples/**/*',
      '*.config.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      // `void element.offsetHeight` is the idiomatic way to force layout; the
      // rule cannot tell that the read itself is the point.
      '@typescript-eslint/no-meaningless-void-operator': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      'no-console': 'off',
    },
  },
);
