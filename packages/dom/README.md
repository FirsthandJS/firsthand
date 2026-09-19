# @firsthandjs/dom

DOM parts, components, portals and keyed lists — and a re-export of
`@firsthandjs/core`, so applications have one import site.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/03-components.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/dom.md) · [all docs](https://github.com/firsthandjs/firsthand/blob/main/docs/README.md)

```tsx
import { component, render, signal } from '@firsthandjs/dom';

const Counter = component(() => {
  const count = signal(0);
  return <button onClick={() => count.value++}>{count.value}</button>;
});

render(() => <Counter />);
```

Pair it with [`@firsthandjs/compiler`](../compiler) at build time: static markup
becomes a cloned `<template>` and every dynamic expression becomes a specialised
DOM part.

`@firsthandjs/dom/internal` is the compiler/runtime protocol. It is public on
purpose — compiled output is code you could have written by hand — but it is not
covered by semantic versioning in the same way the main entry point is.

Full documentation: the [repository README](../../README.md).

MIT licensed.
