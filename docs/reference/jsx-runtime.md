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
    "jsx": "react-jsx",
    "jsxImportSource": "@firsthandjs/jsx-runtime",
  },
}
```

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
