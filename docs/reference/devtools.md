# @firsthandjs/devtools

[Reference index](../README.md#reference) · 1.12 kB gzip · depends on
`@firsthandjs/core` · development only

See which signal updates which DOM node, what depends on what, and why an
effect ran. Guide: [Devtools](../guide/13-devtools.md). Reasoning:
[ADR-0020](../adr/0020-devtools-without-a-runtime-cost.md).

```ts
// main.tsx, above everything else
import { attach } from '@firsthandjs/devtools';

if (import.meta.env.DEV) {
  attach();
}
```

---

## The console, and the panel

`attach()` also puts the API on `globalThis.__FIRSTHAND__`, because a browser
console cannot import: a bare specifier has no resolver there, and in a bundled
application the module is inside the bundle. It is spelled to pair with `$0`,
the element the Elements panel has selected.

```js
__FIRSTHAND__.panel($0); // open the panel on it
__FIRSTHAND__.chain($0); // or just the chain, as text
```

`__FIRSTHAND__.panel()` opens a panel in the page: pick an element, see what
writes it and why. It lives in a shadow root with `all: initial`, so neither
stylesheet reaches the other, and its code is behind a dynamic import — a
session that never opens it never downloads it.

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

## queries

```ts
function queries(): QueryEvent[];

interface QueryEvent {
  event: 'created' | 'invalidated' | 'dropped';
  key: string;
  tags: readonly string[];
}
```

What the query cache has done, oldest first. This is the one part of the
framework whose behaviour is **not** in the reactive graph: a tag match is a
decision rather than an edge, and an invalidation that matched nothing looks
exactly like one that was never sent.

```ts
queries().filter((e) => e.event === 'invalidated');
// [{ event: 'invalidated', key: 'order|…', tags: ['order(id: 7)'] }]
```

Tags are rendered as a person would write them — `order(id: 7)` — rather than
as the cache's own key, which separates with control characters so two
different tags can never collide into one string.

Bounded to the last 200 events: a long session should not turn a debugging tool
into a memory leak.

## Deep state

Properties of a [`deepSignal`](deep.md) are named by their path, because a
version cell on its own says nothing — a hundred objects all have a `name`:

```ts
const state = deepSignal({ user: { address: { city: 'Cambridge' } } });
// reading state.user.address.city subscribes to `user.address.city`
```

The path is recorded at the only moment it is knowable: when a nested object is
first reached through its parent. An object you never reach has no path and
costs nothing.

Two names are worth knowing. `todos.length` is an array's length, which a read
of `state.todos.length` subscribes to **in addition** to `todos` itself — both
appear, which is the answer to "why did this update when I replaced the whole
array?". And `keys` is what `Object.keys`, `for…in` and spreading subscribe to:
whether the set of keys changed.

## What the names are

| Source            | Example                     | When                                    |
| ----------------- | --------------------------- | --------------------------------------- |
| The DOM write     | `button.disabled`, `p.text` | Any part                                |
| The property path | `user.address.city`         | Deep state                              |
| The function      | `isEditable`                | A named `computed` or `effect` body     |
| The creation site | `order.ts:12:19`            | Everything else, including every signal |

A runtime cannot see that `const count = signal(0)` is called `count` — only a
compiler can, and that option is not built yet. Until it is, a signal is named
by where it was written, which is a link your editor can follow.

## What it costs

**Nothing ships.** The hooks this reads live in modules the production build
replaces with empty functions, so a shipped bundle contains neither the code
nor its strings, and this package is downloaded only by an application that
imports it. Of the package itself, 1.40 kB gzip is the part an import pulls in;
the panel is a further 1.95 kB, loaded when it is opened.

The one honest exception, measured rather than rounded away: the _calls_ to
those empty functions cost **14 bytes minified, 5 gzip** across the whole
runtime, because a bundler cannot prove a call has no effect. The hot path is
unchanged — `bench:ic` still reports 1.01× for mixed cell shapes.
