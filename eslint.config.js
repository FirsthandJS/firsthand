import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Lint rules, in three groups.
 *
 * 1. Correctness — `strictTypeChecked`, plus the handful this project tightens.
 * 2. Shape — the SOLID and clean-code limits from
 *    `docs/architecture/code-rules.md`. Every one of them is a number, so that
 *    "this module is doing too much" is a build failure rather than a review
 *    opinion.
 * 3. Layering — which package may import which, and which globals a package
 *    may not see at all. This is dependency inversion expressed as a lint rule.
 *
 * The limits below skip blank lines and comments on purpose. This codebase
 * explains its reasoning in prose above the code, and a size limit that counted
 * those lines would be a limit on explanation. Deleting a comment to get under
 * one of these numbers is breaking the rule, not keeping it.
 */

/**
 * `../` is banned; `@/` is the way out of a directory (code-rules §3).
 *
 * Only inside a package, because that is the only place `@/` has a meaning —
 * it resolves to the current package's `src/`. `benchmarks/` and `scripts/`
 * are not packages and keep relative paths.
 */
const parentRelative = {
  group: ['../*', '../**'],
  message: "Use '@/…' (this package's src) instead of '../…' — docs/architecture/code-rules.md §3.",
};

/**
 * The parent-relative ban, plus whatever layering this package is under.
 * Composed in one place because a later `no-restricted-imports` replaces an
 * earlier one wholesale rather than merging with it — the per-package blocks
 * below would otherwise each punch a hole in the `../` rule.
 */
/** @param {...string[]} groups */
const imports = (...groups) => [
  'error',
  {
    patterns: [parentRelative, ...groups.map((group) => ({ group }))],
    paths: /** @type {string[]} */ ([]),
  },
];

/** SOLID and clean-code limits for shipped code. */
const shape = {
  // S: one reason to change. Size is the proxy a linter can compute.
  'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
  'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
  'max-statements': ['error', 30],
  // O: a function that keeps being edited to admit one more case grows a
  // branch each time. When the set is open-ended, use a table, not a chain.
  complexity: ['error', 12],
  'max-depth': ['error', 4],
  'max-nested-callbacks': ['error', 3],
  // I: four parameters, then an options object — unless it allocates in a hot
  // path, which is one of the three documented reasons to disable a rule.
  'max-params': ['error', 4],
  // Clean code, the part of it a linter can hold.
  'no-param-reassign': ['error', { props: false }],
  'no-else-return': ['error', { allowElseIf: false }],
  'no-lonely-if': 'error',
  'prefer-const': 'error',
  'no-var': 'error',
  'object-shorthand': ['error', 'properties'],
  'prefer-template': 'error',
};

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
        // One project per package, plus one for everything outside them. A
        // single repo-wide project could not give `@/` a meaning: `paths` is
        // global to a config, so `@/index.js` would resolve to whichever
        // package was listed first.
        project: ['./tsconfig.eslint.json', './packages/*/tsconfig.test.json'],
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
    // The shape limits apply to every module that ships, and to the tests,
    // which are read far more often than they are written.
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
    rules: { ...shape, 'no-restricted-imports': imports() },
  },
  {
    // A test may be longer than the code it tests — a table of cases is one
    // idea however many rows it has — but it is still code somebody has to
    // read, so the limits are looser rather than absent.
    //
    // `max-lines-per-function` is off here, and it is the one rule that does
    // not transfer. In a test file every function is a `describe` or an `it`
    // callback: `describe` is a grouping, not a function anybody calls, and a
    // per-function limit on it measures the suite twice while naming it wrongly.
    // The file limit is what says a suite has grown too big, and it stays.
    files: ['packages/*/test/**/*.ts', 'packages/*/test/**/*.tsx'],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 4],
      'max-depth': ['error', 4],
      // describe > describe > it > act > a callback the test passes in: six is
      // the depth an ordinary nested suite reaches without anything being wrong.
      'max-nested-callbacks': ['error', 6],
      'no-restricted-imports': imports(),
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
      'no-restricted-imports': imports(['@firsthandjs/*']),
    },
  },
  {
    // The server layer writes the same values the DOM layer writes, into a
    // string instead of a node. The same rule applies for the same reason:
    // `[object Object]` is what the platform does, and what the browser would
    // have done with the same value.
    files: ['packages/server/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-base-to-string': 'off',
      'no-restricted-imports': imports([
        '@firsthandjs/compiler*',
        '@firsthandjs/dom*',
        '@firsthandjs/jsx-runtime*',
      ]),
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
      'no-restricted-imports': imports(['@firsthandjs/compiler*', '@firsthandjs/jsx-runtime*']),
    },
  },
  {
    // The optional packages sit on top of the runtime and know nothing about
    // each other: the router must work without the cache, and the cache
    // without the router.
    files: [
      'packages/router/src/**/*.ts',
      'packages/data/src/**/*.ts',
      'packages/styled/src/**/*.ts',
      'packages/react/src/**/*.ts',
    ],
    rules: {
      // Writing an arbitrary value into CSS or into a React prop is the
      // platform's behaviour, including `[object Object]`. These packages do
      // not second-guess it, exactly as the DOM layer does not.
      '@typescript-eslint/no-base-to-string': 'off',
      'no-restricted-imports': imports([
        '@firsthandjs/compiler*',
        '@firsthandjs/router*',
        '@firsthandjs/data*',
        '@firsthandjs/styled*',
        '@firsthandjs/react*',
      ]),
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
      'no-restricted-imports': imports([
        '@firsthandjs/core*',
        '@firsthandjs/dom*',
        '@firsthandjs/jsx-runtime*',
      ]),
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
