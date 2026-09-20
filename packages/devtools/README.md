# @firsthandjs/devtools

> **Experimental.** This package is new and its shape is still moving. The
> names, the returned structures and the panel will change without a major
> version while that is true; nothing else in the framework depends on it, and
> a production build contains none of it.

See which signal updates which DOM node, what depends on what, and why an
effect ran.

```bash
npm install --save-dev @firsthandjs/devtools
```

```ts
// main.tsx, above everything else
import { attach } from '@firsthandjs/devtools';

if (import.meta.env.DEV) {
  attach();
}
```

Then, in the browser:

```js
__FIRSTHAND__.panel(); // a panel: pick an element, see what writes it and why
```

Or from the console, on whatever the Elements panel has selected — no import,
because a console cannot resolve a bare specifier:

```js
__FIRSTHAND__.chain($0);
__FIRSTHAND__.causeOf($0);
__FIRSTHAND__.queries();
```

And from a test or a module, where the types apply:

```ts
import { chain, inspect, causeOf } from '@firsthandjs/devtools';

chain(document.querySelector('button'));
// order.ts:12:19
//    ↓
// computed(isEditable)
//    ↓
// button.disabled

causeOf(document.querySelector('button'));
// 'order.ts:12:19' — what changed to make it run
```

`inspect(node)` returns the same thing as data: each part that writes the node,
with its dependencies and their dependencies, as far down as you ask.
`cells()` lists every computed and effect currently alive.

## What it costs

Nothing, in a production build. The hooks it reads live in modules the build
replaces with empty functions, so a shipped bundle contains neither the code
nor its strings — and this package is only downloaded by an application that
imports it.

In development it records nothing until `attach()` is called, because naming
every cell costs a `WeakMap` write and a hundred thousand rows would feel it.

## How it works

It does not instrument anything. The reactive graph is already there, because
propagation and disposal need it: every cell carries its dependencies and its
subscribers, and every owner carries its children. This package attaches names
to those nodes and reads the structure when asked.

**Documentation:** [guide](../../docs/guide/13-devtools.md) ·
[API reference](../../docs/reference/devtools.md) ·
[ADR-0020](../../docs/adr/0020-devtools-without-a-runtime-cost.md) for the
reasoning.

## Licence

MIT
