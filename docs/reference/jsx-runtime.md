# @firsthandjs/jsx-runtime

[Reference index](../README.md#reference) · 0.59 kB gzip · depends on
`@firsthandjs/dom`

The JSX type namespace, and a runtime fallback for environments where the
compiler is not configured.

---

## The types

Importing this package — directly, or through `@firsthandjs/dom` — declares the
`JSX` namespace: `JSX.Element`, `JSX.IntrinsicElements` and the element and
event typings that make `onClick`, `class`, `style`, `prop:`/`attr:` and `on:`
type-check.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    // "preserve" when the compiler plugin is doing the transform, which is the
    // usual setup; "react-jsx" when TypeScript itself emits the calls.
    "jsx": "preserve",
    "jsxImportSource": "@firsthandjs/jsx-runtime",
  },
}
```

**`react-jsx` has nothing to do with React.** It is TypeScript's name for the
_automatic JSX runtime_ — the mode that emits
`import { jsx } from "<jsxImportSource>/jsx-runtime"` instead of calling
`React.createElement`. TypeScript named the mode after the tool it first
supported and kept the name; Solid, Preact and Vue configure their own runtimes
with the same setting. With `jsxImportSource` pointing here, the import
resolves to this package and no React is installed, imported or involved.

Which of the two to use is decided by who transforms the JSX:
[Why JSX has to be configured at all](../guide/01-getting-started.md#why-jsx-has-to-be-configured-at-all).

The namespace is declared in the package's entry module rather than in a
`.d.ts` beside it, so it is always emitted with the build and cannot go missing
from a published tarball.

If TypeScript reports **`Duplicate identifier 'Element'`**, the source and the
built copy are both in the program. Map both entry points at the same target:

```jsonc
"paths": {
  "@firsthandjs/jsx-runtime/jsx-runtime": ["./packages/jsx-runtime/src/index.ts"],
  "@firsthandjs/jsx-runtime/jsx-dev-runtime": ["./packages/jsx-runtime/src/index.ts"]
}
```

## The runtime

```ts
const Fragment: unique symbol;
function jsx(type: unknown, props: Record<string, unknown>): unknown;
const jsxs: typeof jsx;
const jsxDEV: typeof jsx;
```

This path runs when TSX is transpiled by something other than the Firsthand
compiler — a REPL, a test that imports TSX directly, a tool configured only
with `jsxImportSource`. It produces real DOM through the same protocol as
compiled output: there is no second semantics and no second runtime.

What it cannot do is hoist static markup into a `<template>`; it creates
elements one at a time. **The performance numbers are measured on the compiled
path**, and this is the reason the README says so.

One convention exists only here: a **function value** in an attribute or child
position is treated as a dynamic thunk. A runtime JSX call has already
evaluated its arguments and cannot see the expression, so it has no other way
to know what is dynamic. The compiler emits those thunks itself, so compiled
code never depends on this rule.
