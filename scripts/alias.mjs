/**
 * `@/` — one implementation, four consumers.
 *
 * `@/x.js` means "`x.js` in the `src/` of the package this file belongs to".
 * It is the only way out of a directory (docs/architecture/code-rules.md §3),
 * and it has to mean the same thing to the type checker, to the test runner,
 * to the bundler and to whoever installs the published package:
 *
 * | Consumer   | How it learns about `@/`                                   |
 * | ---------- | ---------------------------------------------------------- |
 * | TypeScript | `paths` in each package's `tsconfig.json`                   |
 * | Vitest     | `firsthandAlias()` below, as a Vite plugin                  |
 * | esbuild    | `esbuildAlias` below, in `scripts/build.mjs`                |
 * | a consumer | nothing — `rewriteDeclarations` turns `@/` back into a      |
 * |            | relative path before the `.d.ts` files are published        |
 *
 * That last row is the whole reason this file is shared rather than three
 * copies: an installed package has no alias, so every `@/` must be gone from
 * `dist` — and "gone" has to mean the same resolution the type checker used,
 * or the types and the code disagree.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The alias, as it appears in source. */
export const PREFIX = '@/';

/**
 * The `src/` directory of the package a file belongs to, or `null` for a file
 * outside `packages/` — `benchmarks/` and `scripts/` are not packages, which is
 * why the lint rule leaves their relative imports alone.
 */
export function packageSrcOf(file) {
  const parts = resolve(file).split(sep);
  const at = parts.lastIndexOf('packages');
  if (at === -1 || parts[at + 1] === undefined) {
    return null;
  }
  return parts
    .slice(0, at + 2)
    .concat('src')
    .join(sep);
}

/**
 * The file `@/…` names, with the extension the source actually has.
 *
 * Source specifiers carry `.js` because that is what the emitted JavaScript
 * will import; on disk the file is `.ts` or `.tsx`. Resolving both here keeps
 * that translation in one place rather than in each consumer.
 */
export function resolveAlias(specifier, importer) {
  if (!specifier.startsWith(PREFIX)) {
    return null;
  }
  const src = packageSrcOf(importer);
  if (src === null) {
    return null;
  }
  const target = join(src, specifier.slice(PREFIX.length));
  for (const candidate of candidates(target)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** The on-disk files a `.js` specifier could name, in resolution order. */
function candidates(target) {
  const withoutExtension = target.replace(/\.js$/, '');
  return [
    `${withoutExtension}.ts`,
    `${withoutExtension}.tsx`,
    target,
    join(target, 'index.ts'),
    join(target, 'index.tsx'),
  ];
}

/** Vite/Vitest: resolve `@/…` against the importing file's package. */
export function firsthandAlias() {
  return {
    name: 'firsthand-alias',
    enforce: 'pre',
    resolveId(source, importer) {
      return importer === undefined ? null : resolveAlias(source, importer);
    },
  };
}

/** esbuild: the same rule, for the bundled JavaScript. */
export const esbuildAlias = {
  name: 'firsthand-alias',
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) => {
      const path = resolveAlias(args.path, args.importer);
      return path === null ? null : { path };
    });
  },
};

/**
 * Rewrites every `@/…` in a package's emitted declarations to a relative
 * specifier, in place.
 *
 * `tsc` copies the specifier through verbatim — it has no reason not to, the
 * alias is in the tsconfig — but the tsconfig is not published and the
 * consumer's is not ours. So the last thing the build does to a `.d.ts` is
 * undo the alias, against the same `src` layout `dist` mirrors.
 *
 * Returns the number of specifiers rewritten, so the build can say so.
 */
export function rewriteDeclarations(packageDir) {
  let rewritten = 0;
  for (const file of declarations(join(packageDir, 'dist'))) {
    const before = readFileSync(file, 'utf8');
    const after = before.replace(/(['"])@\/([^'"]+)\1/g, (_match, quote, path) => {
      rewritten += 1;
      return `${quote}${toRelative(file, path)}${quote}`;
    });
    if (after !== before) {
      writeFileSync(file, after);
    }
  }
  return rewritten;
}

/**
 * `dist` mirrors `src`, so the path from one declaration to another is the path
 * their sources had. Always prefixed with `./` — a bare `graph/cell.js` would
 * be a package name.
 */
function toRelative(file, path) {
  const from = dirname(file);
  const to = join(dirname(file).split(`${sep}dist`)[0], 'dist', path);
  const specifier = relative(from, to).split(sep).join('/');
  return specifier.startsWith('.') ? specifier : `./${specifier}`;
}

/** Every `.d.ts` and `.d.ts.map` under a directory. */
function* declarations(directory) {
  if (!existsSync(directory)) {
    return;
  }
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* declarations(path);
    } else if (entry.endsWith('.d.ts')) {
      yield path;
    }
  }
}

export { root };
