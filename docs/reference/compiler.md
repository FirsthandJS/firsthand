# @firsthandjs/compiler

[Reference index](../README.md#reference) · build only, never shipped to a
browser

Compiles TSX into template clones and DOM parts. Guide:
[Building and deploying](../guide/14-building.md); design:
[ADR-0009](../adr/0009-compiler-templates-and-thunks.md).

---

## @firsthandjs/compiler/vite

```ts
import { firsthand } from '@firsthandjs/compiler/vite';

export default defineConfig({
  plugins: [firsthand({ packageName: 'my-app' })],
});
```

```ts
function firsthand(options?: FirsthandPluginOptions): VitePluginLike;

interface FirsthandPluginOptions {
  /** Used when hashing stable component ids. */
  packageName?: string;
}
```

It handles `.tsx` and `.jsx`, runs before the bundler's own TypeScript pass,
and needs no `esbuild.jsx` configuration — configuring `jsx: 'preserve'`
changes nothing and is a type error on Vite 8.

`packageName` should be set and should be stable: component ids are hashed from
it plus the module path, which is what makes an id survive a rebuild
([ADR-0004](../adr/0004-component-identity-without-name-strings.md)). Two packages that both used
the default `app` and shipped in one bundle would collide.

## The Babel plugin

```ts
import firsthandPlugin from '@firsthandjs/compiler';

// babel.config.js
export default { plugins: [['@firsthandjs/compiler', { packageName: 'my-app' }]] };
```

`firsthandPlugin` is the default export, so any Babel-based toolchain — Rollup,
webpack, Jest, esbuild via a Babel step — can use it directly. It requires the
JSX syntax plugin (and, for TSX, the TypeScript syntax plugin) ahead of it.

## transform

```ts
function transform(code: string, options?: TransformOptions): string;

interface TransformOptions extends FirsthandPluginOptions {
  filename?: string;
  /** Parse TypeScript syntax. */
  typescript?: boolean;
}
```

Compiles one module and returns the code. This is what the Vite plugin and the
compiler's own tests call, and it is the way to see what your TSX became.

Type annotations are **left in the output**: stripping them is the bundler's
job, and doing it here would duplicate the work and add a source-map hop.

## stableId

```ts
function stableId(packageName: string, filename: string): string;
```

The id hash, exported so a tool can reproduce a component id without running
the compiler.

## What it emits

Static markup is hoisted into one `<template>` per JSX tree and cloned;
dynamic expressions become thunks passed to the specialised parts in
[`@firsthandjs/dom/internal`](dom.md#firsthandjsdominternal); nodes are reached by
child index rather than by query. Props destructuring in a component's
parameter list is rewritten into live reads, so `({ count }) => …` stays
reactive.

The emitted code is a contract with the runtime, versioned by
`PROTOCOL_VERSION`: the compiler and `@firsthandjs/dom` are upgraded together.
