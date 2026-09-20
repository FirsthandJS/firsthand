# @firsthandjs/devtools

[Reference index](../README.md#reference) · 1.12 kB gzip · depends on
`@firsthandjs/core` · development only

See which signal updates which DOM node, what depends on what, and why an
effect ran. Reasoning:
[ADR-0020](../adr/0020-devtools-without-a-runtime-cost.md).

```ts
// main.tsx, above everything else
import { attach } from '@firsthandjs/devtools';

if (import.meta.env.DEV) {
  attach();
}
```

---

## attach / detach

```ts
function attach(): void;
function detach(): void;
```

`attach()` installs the hook the framework's development modules look for.
Call it **before the application creates anything**: a cell that already exists
keeps working and stays in the graph, it is simply unnamed.

Nothing is recorded until it is called. Naming every cell costs a `WeakMap`
write, and a hundred thousand rows would feel that even in development — which
is exactly the size at which devtools matter, so the cost is opt-in.

`detach()` stops recording and forgets what it learned. It exists for tests.

## chain

```ts
function chain(node: Node): string;
```

The path from a DOM node up to what feeds it, as text. This is the question
the package exists for: the node is on the screen, the value is wrong, and you
want to know where it came from.

```
order.ts:12:19
   ↓
computed(isEditable)
   ↓
button.disabled
```

One path, not a tree: a chain is a story. When a part reads several sources,
the longest path is drawn and `inspect` has the rest. When nothing reactive
writes the node it says so in a sentence rather than returning an empty string.

## inspect

```ts
function inspect(node: Node, depth?: number): GraphNode[];

interface GraphNode {
  kind: 'signal' | 'computed' | 'effect' | 'part';
  name: string;
  value: unknown;
  dependencies: GraphNode[];
  dependents: GraphNode[];
}
```

The same answer as data, one entry per part that writes the node. `depth`
bounds how far up the dependencies are followed (8 by default). A diamond —
two paths reaching the same signal — appears as two paths, because that is
what the application has.

## cells

```ts
function cells(): GraphNode[];
```

Every computed and effect currently alive, in owner order, each with its
immediate dependencies and dependents. Signals appear as dependencies rather
than on their own: nothing owns a signal, so there is no list of them to walk.

## causeOf

```ts
function causeOf(node: Node): string | null;
```

What changed to make the part that writes this node run. `null` if it has not
run since anything changed, or if nothing reactive writes the node.

This is the one thing devtools record rather than read: the graph keeps no
history, because nothing needs it once the flush is over.

## What the names are

| Source            | Example                     | When                                    |
| ----------------- | --------------------------- | --------------------------------------- |
| The DOM write     | `button.disabled`, `p.text` | Any part                                |
| The function      | `isEditable`                | A named `computed` or `effect` body     |
| The creation site | `order.ts:12:19`            | Everything else, including every signal |

A runtime cannot see that `const count = signal(0)` is called `count` — only a
compiler can, and that option is not built yet. Until it is, a signal is named
by where it was written, which is a link your editor can follow.

## What it costs

**Nothing ships.** The hooks this reads live in modules the production build
replaces with empty functions, so a shipped bundle contains neither the code
nor its strings, and this package is downloaded only by an application that
imports it.

The one honest exception, measured rather than rounded away: the _calls_ to
those empty functions cost **14 bytes minified, 5 gzip** across the whole
runtime, because a bundler cannot prove a call has no effect. The hot path is
unchanged — `bench:ic` still reports 1.01× for mixed cell shapes.
