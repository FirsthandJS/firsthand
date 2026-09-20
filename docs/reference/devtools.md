# @firsthandjs/devtools

[Reference index](../README.md#reference) · 1.96 kB gzip · depends on
`@firsthandjs/core` · development only

See which signal updates which DOM node, what depends on what, and why an
effect ran. Guide: [Devtools](../guide/14-devtools.md). Reasoning:
[ADR-0020](../adr/0020-devtools-without-a-runtime-cost.md).

```ts
// main.tsx, above everything else
import { attach } from '@firsthandjs/devtools';

if (import.meta.env.DEV) {
  attach();
}
```

---

> **Experimental.** This package is new and its shape is still moving. The
> names, the returned structures and the panel will change without a major
> version while that is true; nothing else in the framework depends on it, and
> nothing else in the framework depends on it.

## The console, and the panel

`attach()` also puts the API on `globalThis.__FIRSTHAND__`, because a browser
console cannot import: a bare specifier has no resolver there, and in a bundled
application the module is inside the bundle. It is spelled to pair with `$0`,
the element the Elements panel has selected.

```js
__FIRSTHAND__.panel($0); // open the panel on it
__FIRSTHAND__.chain($0); // or just the chain, as text
```

**Ctrl+Shift+F** opens and closes the panel, and `attach()` says so on the
console once, because a tool that gives no sign of itself is one nobody opens.
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
status (order.ts:12)
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

## stack

```ts
function stack(node: Node): string[];
```

The components a node's part lives inside, outermost first —
`['App', 'OrderPage', 'SaveButton']`. Empty when nothing reactive writes the
node.

A walk rather than a recording: the owner tree already holds the shape, since
a component's scope is the parent of everything its setup created. The DOM
layer contributes only the name.

## timeline

```ts
function timeline(node?: Node): Update[];

interface Update {
  /** Milliseconds since the page loaded. */
  at: number;
  /** What was written. */
  source: string;
  /** What ran, in the order it ran. */
  ran: string[];
  /** Where the write came from, application frames only. */
  stack: string[];
}
```

Every update, oldest first: one write and everything that ran because of it.
With a node, only the updates that ran that node's parts — matched by identity
rather than by name, because two paragraphs both have a part called `p.text`.

An entry whose `ran` is empty is a write that woke nothing. That is not a gap
in the recording; it is usually the answer.

The last 100 updates.

`stack` holds the frames exactly as the engine gave them, which means positions
in the **compiled** module: browsers do not apply source maps to `error.stack`.
The panel reads each one back through the map the module already carries and
shows the written position instead. Anything else reading `stack` should do the
same, or say plainly that the numbers are generated ones.

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

| Source            | Example                     | When                                  |
| ----------------- | --------------------------- | ------------------------------------- |
| The DOM write     | `button.disabled`, `p.text` | Any part                              |
| The property path | `user.address.city`         | Deep state                            |
| The function      | `isEditable`                | A named `computed` or `effect` body   |
| The variable      | `status (order.ts:12)`      | A signal in a module the compiler saw |
| The creation site | `order.ts:12:19`            | Everything the compiler could not see |

A runtime cannot see that `const count = signal(0)` is called `count`; the
compiler can, and does, under a development server. What it did not see — a
cell created before `attach()` ran, or outside a compiled module — is named by
where it was created.

That position is the one the _compiled_ module has, and it is kept whole in the
data, URL and all, because reading it back to the written line needs the module
it came from. The panel resolves and shortens it before showing it, the same as
it does a stack frame.

## What it costs

**The framework's side ships nothing.** The hooks this reads live in modules
the production build replaces with empty functions, so a shipped bundle
contains neither that code nor its strings.

**This package is not stripped.** It is an ordinary module: imported
unconditionally it is in your production bundle, so guard the import with
`import.meta.env.DEV` (or your bundler's equivalent) if that matters. Of the
package itself, 1.96 kB gzip is the part an import pulls in; the panel is a
further 4.83 kB, loaded when it is opened.

The one honest exception, measured rather than rounded away: the _calls_ to
those empty functions cost **32 bytes minified, 9 gzip** across the whole
runtime, because a bundler cannot prove a call has no effect. Nothing else
moves: `bench:ic` reports mixed cell shapes at 1.02×, and a 2000-component
mount measures the same as a build with the call sites removed.
