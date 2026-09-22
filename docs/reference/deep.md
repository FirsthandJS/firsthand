# @firsthandjs/deep

[Reference index](../README.md#reference) · 0.72 kB gzip · depends on
`@firsthandjs/core`

Reactivity that follows an object all the way down — the shape Vue calls
`reactive()`. Guide: [Reactivity](../guide/02-reactivity.md#deep-state).

---

## deepSignal

```ts
function deepSignal<T extends Deep>(value: T): T;

type Deep = Record<PropertyKey, unknown> | unknown[];
```

```ts
import { deepSignal } from '@firsthandjs/deep';

const state = deepSignal({ user: { name: 'Ada' }, todos: [] as string[] });

effect(() => console.log(state.user.name)); // subscribes to that property
state.user.name = 'Grace'; // and only that effect re-runs
state.todos.push('write the docs'); // arrays included
```

Returns a proxy with the same type as what you passed. Read it, write it,
spread it, iterate it, hand it to a component — it is your object, with every
property behaving like a signal.

**Reads are tracked per property.** An effect that read `state.user.name` does
not re-run when `state.user.age` changes. Nested objects are wrapped lazily, so
a branch nobody reaches is never proxied.

**Writes notify only what read them.** Writing a property nobody has read costs
nothing: the version cell that carries the notification is created on first
read, not on first write.

**Identity is stable.** `deepSignal(x)` twice returns the same proxy,
`deepSignal(proxy)` returns that proxy, and `state.user === state.user`. A
proxy assigned back into the tree is stored as its raw object, so the tree
holds one representation of everything.

### What counts as a key change

| Written                    | What is notified                                            |
| -------------------------- | ----------------------------------------------------------- |
| `state.a = 1` (existing)   | readers of `a`, unless the value is `Object.is`-equal       |
| `state.b = 2` (new)        | readers of `b`, and readers of `Object.keys`/`for…in`/`in`  |
| `delete state.a`           | the same, in reverse                                        |
| `list.push(x)`             | readers of the new index and of `length`, in **one** update |
| `list[5] = x` past the end | readers of that index and of `length`                       |

Array mutators — `push`, `pop`, `shift`, `unshift`, `splice`, `sort`,
`reverse`, `fill`, `copyWithin` — run inside `batch`, so a `push` is one update
rather than an index write followed by a length write.

## raw

```ts
function raw<T>(value: T): T;
```

The object a proxy wraps, or the value itself if it is not one. For handing
state to something that must not track it — a `structuredClone`, a `fetch`
body, a library that stores what it is given.

## isDeep

```ts
function isDeep(value: unknown): boolean;
```

Whether a value is a proxy this package created.

## What it does not wrap

Only plain objects and arrays are followed. A `Map`, a `Set`, a `Date`, a
`RegExp`, a `Promise`, a function and a class instance are handed back
untouched — and the type rejects them outright:

```ts
deepSignal(new Map()); // compile error
deepSignal(new Date()); // compile error
deepSignal(new Point()); // compile error
```

That is deliberate. Those objects read their internal state through `this`, and
`this` inside a proxy is the proxy, not the object — so a proxied `Map` throws
on `get`. Vue solves it with a second set of handlers per collection type; this
package solves it by saying no, which is 0.74 kB instead of several. A `Map`
held **inside** deep state still works, it is simply not reactive itself:

```ts
const state = deepSignal({ index: new Map<string, number>() });
state.index.get('a'); // works, not tracked
state.index = new Map(); // tracked: the property was replaced
```

## When to use which

| You have                                         | Reach for                       |
| ------------------------------------------------ | ------------------------------- |
| A value — a count, a flag, a selected id         | `signal`                        |
| A form, a document, a settings tree              | `deepSignal`                    |
| A list of rows you replace wholesale             | `signal` holding an array       |
| A list of rows you edit in place                 | `deepSignal`                    |
| Anything a `Map`, `Set` or class instance models | `signal`, replaced on each edit |

A signal read is one property read on one object. A deep read is a proxy trap
plus a cell read — more work per access, in exchange for not having to thread
`.value` through a tree or replace objects to make a change visible. Both live
in the same graph: an effect can read from one of each.
