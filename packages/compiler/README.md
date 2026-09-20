# @firsthandjs/compiler

The build-time half of Firsthand. Nothing here ships to the browser.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/15-building.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/compiler.md) · [all docs](https://github.com/firsthandjs/firsthand/blob/main/docs/README.md)

```ts
// vite.config.ts
import { firsthand } from '@firsthandjs/compiler/vite';

export default { plugins: [firsthand({ packageName: 'my-app' })] };
```

What it does:

- hoists static markup into one `<template>` per shape, cloned per instance;
- turns every dynamic expression into a thunk handed to a specialised part;
- rewrites a keyed `.map()` into a list part with live item reads;
- gives each `component(...)` a stable build id that survives minification;
- refuses to compile props destructuring, because that would snapshot.

It emits calls against the published protocol in `@firsthandjs/dom/internal` and
has no privileged access to the runtime.

Full documentation: the [repository README](../../README.md) and
[ADR-0009](../../docs/adr/0009-compiler-templates-and-thunks.md).

MIT licensed.
