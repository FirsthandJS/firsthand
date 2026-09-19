# @firsthandjs/jsx-runtime

Runtime JSX for environments where the Firsthand compiler is not configured: a
REPL, a test that imports TSX directly, a tool that transpiles with
`jsxImportSource`.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/01-getting-started.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/jsx-runtime.md) · [all docs](https://github.com/firsthandjs/firsthand/blob/main/docs/README.md)

It produces real DOM through the same protocol as the compiled output — there
is no second semantics and no second runtime. What it cannot do is hoist static
markup into a `<template>`, and it cannot see an expression that a JSX call has
already evaluated, so a dynamic value must be written as a thunk:

```tsx
<p>{() => count.value}</p>
```

The compiler writes those thunks for you. Use it for production.

Full documentation: the [repository README](../../README.md).

MIT licensed.
