# @firsthandjs/compiler

[Reference index](../README.md#reference) · build only, never shipped to a
browser

Compiles TSX into template clones and DOM parts. Guide:
[Building and deploying](../guide/16-building.md); design:
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
  /** Refuse to compile a value read once in a setup and then kept. Default: true. */
  strictReactivity?: boolean;
}
```

It handles `.tsx` and `.jsx`, runs before the bundler's own TypeScript pass,
and needs no `esbuild.jsx` configuration — configuring `jsx: 'preserve'`
changes nothing and is a type error on Vite 8.

`packageName` should be set and should be stable: component ids are hashed from
it plus the module path, which is what makes an id survive a rebuild
([ADR-0004](../adr/0004-component-identity-without-name-strings.md)). Two packages that both used
the default `app` and shipped in one bundle would collide.

## strictReactivity

**On by default.** `firsthand({ packageName: 'my-app', strictReactivity: false })`
turns it off.

Refuses to compile a declaration whose value is read once in a component setup
and then kept — the mistake the single-run setup invites
([ADR-0019](../adr/0019-strict-reactivity.md)):

```tsx
const Widget = component((props) => {
  const count = props.items.length; // build error under strictReactivity
  return <p>{count} items</p>;
});
```

The error names the declaration, says why the value will not change again, and
points at the two ways out: move the read into the part, handler, `effect` or
`computed` that should re-read it, or wrap it in
[`snapshot`](core.md#snapshot) if reading once is what you meant.

**It is deliberately narrow, because a false positive stops a build.** Only a
declaration whose initialiser is _nothing but_ a read is reported — identifiers,
member accesses, literals and the operators between them. Anything containing a
call is left alone, which covers `signal(props.initial)`, `peek()`, `computed`,
every handler, and `snapshot()` itself. A read inside a nested function is left
alone too: those bodies run again.

What it therefore cannot see is a read that leaves the module — `doSomething(props)`
with the read in another file. That is what the runtime half is for:
[`setStrictReactivity(true)`](core.md#setstrictreactivity) reports the same
mistake during development, including the cases no compiler can follow.

**The runtime half stays opt-in, and this one does not.** The difference is
precision. The compiler sees the _shape_ of a declaration and only reports the
one that is almost always wrong; the runtime sees a read with nothing
subscribing, which `signal(props.initial)` also is. A check that is usually
right can be on by default. One that is often wrong would only teach people to
ignore it.

Neither costs anything in production: this one runs at build time, and the other
lives in a module the production build replaces with empty functions.

## devtools

```ts
firsthand({ packageName: 'my-app', devtools: true });
```

Labels each cell with the variable that holds it and the line it was written
on, for [devtools](devtools.md). **The Vite plugin turns this on while serving
and off while building**, so a production build emits nothing; the option
overrides that either way.

```tsx
const count = signal(0);
// becomes, in development only:
const count = _$label(signal(0), 'signal', 'count (main.tsx:9)');
```

It exists because neither half is available at runtime. A runtime cannot see
that the variable is called `count`, and `new Error().stack` reports a position
in the _compiled_ module — browsers do not apply source maps to `error.stack`,
so the line it names is not the line that was written. The compiler knows both.

Only `signal`, `computed` and `deepSignal` assigned to a plain identifier are
labelled. Anything else is left alone and simply unnamed.

## Source maps

The Vite plugin returns one, so a debugger shows the JSX rather than the
hoisted templates and protocol calls it compiles to. `compileModule` is the
entry point that produces it:

```ts
import { compileModule } from '@firsthandjs/compiler';

const { code, map } = compileModule(source, { filename, sourceMaps: true });
```

`map` is a `SourceMap` — the shape a bundler expects, so the plugin's
`transform` result is assignable to Rollup's `SourceMapInput` without a cast.
It is `null` when no map was asked for.

`transform` remains the string-returning form, and asks for no map.

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
