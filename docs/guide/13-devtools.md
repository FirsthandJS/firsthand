# Devtools

[Index](../README.md) · Previous: [Testing](12-testing.md) · Next:
[Performance](14-performance.md)

---

Fine-grained reactivity is pleasant in the small and opaque in the large. Small
means you can hold the graph in your head. Large means somebody asks why a
button is disabled, and the honest answer is "something wrote something".

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

That is the whole setup.

## Point at it

```ts
__FIRSTHAND__.panel();
```

A panel opens in the corner of the page. Press **Pick**, click the element that
is wrong, and the answer is on the screen: what writes it, what that reads, why
it last ran, and the values along the way. A second tab shows what the query
cache has been doing.

It draws itself in a shadow root with `all: initial`, so the page's stylesheet
cannot reach it and its own cannot reach the page — an inspector that changes
what it is inspecting is worse than none. The panel's code is behind a dynamic
import, so a session that never opens it never downloads it.

### From the console, without an import

You cannot write `import { chain } from '@firsthandjs/devtools'` in a browser
console: a bare specifier has no resolver there, and in a bundled application
the module is inside the bundle. So `attach()` puts the whole API on
`globalThis` instead, spelled to pair with `$0` — the element the Elements
panel has selected:

```js
__FIRSTHAND__.chain($0); // the chain for whatever you clicked in Elements
__FIRSTHAND__.panel($0); // or open the panel on it
__FIRSTHAND__.queries(); // what the cache did
```

This is plain JavaScript in the console: no types, no autocompletion for the
arguments. The panel is the better tool for looking around; the console is the
better one when you know exactly what you want, or want to `filter` the result.

The same functions are importable in a test or a module, where the types do
apply:

```ts
import { chain } from '@firsthandjs/devtools';
```

## Why is this node like that?

```ts
__FIRSTHAND__.chain($0);
```

```
order.ts:12:19
   ↓
computed(isEditable)
   ↓
button.disabled
```

Read it bottom-up: the `disabled` property of that button is written by a part,
the part reads a computed called `isEditable`, and that computed reads a signal
created at `order.ts:12:19`. Three links, and the question is answered.

`chain` draws one path — the longest — because a chain is a story. When a part
reads several sources, [`inspect`](#the-same-answer-as-data) has the rest.

## Why did that just run?

```ts
__FIRSTHAND__.causeOf($0); // 'order.ts:12:19'
```

What changed to make the part run. `null` means it has not run since anything
changed — which is itself an answer, and usually the surprising one.

This is the only thing devtools record rather than read. The graph keeps no
history, because nothing needs it once the update is over.

## The same answer as data

```ts
__FIRSTHAND__.inspect($0);
// [{ kind: 'part', name: 'button.disabled', value: true,
//    dependencies: [{ kind: 'computed', name: 'isEditable', … }],
//    dependents: [] }]
```

Each entry is a part that writes the node, with what it reads, and what reads
_that_, as far as you ask (`inspect(node, 12)`). Both directions are there:
`dependents` answers "what else would change if I touched this".

`cells()` is the same shape for everything currently alive, walked from the
roots through the owner tree.

## What the names mean

| You see                | It is                                                       |
| ---------------------- | ----------------------------------------------------------- |
| `button.disabled`      | A part writing that property of that element                |
| `p.text`               | A part writing text into that element                       |
| `computed(isEditable)` | A computed whose function has a name                        |
| `user.address.city`    | A property of [deep state](02-reactivity.md#deep-state)     |
| `todos.length`         | An array's length, inside deep state                        |
| `keys`                 | Whether the _set_ of keys changed — `Object.keys`, `for…in` |
| `order.ts:12:19`       | Created there, and nothing named it                         |

The last row is the common one for signals, and it is worth knowing why: a
runtime cannot see that `const count = signal(0)` is called `count`. Only a
compiler can, and that option is not built yet. The creation site is a link
your editor follows, which is the next best thing.

Naming a `computed` or an `effect` is therefore worth the keystrokes when you
expect to be debugging it:

```ts
const isEditable = computed(function isEditable() {
  return order.status.value === 'draft';
});
```

## The query cache

The cache is the one part of the framework whose behaviour is **not** in the
reactive graph. A tag match is a decision, not an edge — so an invalidation
that matched nothing looks exactly like one that was never sent.

```ts
__FIRSTHAND__.queries().filter((e) => e.event === 'invalidated');
// [{ event: 'invalidated', key: 'order|…', tags: ['order(id: 7)'] }]
```

Created, invalidated and dropped, oldest first, with the tags each entry
carries. When a mutation does not refresh what you expected, this is where the
answer is: either the invalidation is not there, or its tags did not match the
ones the query carries.

The last 200 events, so that a long session does not turn a debugging tool into
a memory leak.

## Deep state

Properties of a [`deepSignal`](02-reactivity.md#deep-state) are named by their
path, because a version cell on its own says nothing — a hundred objects all
have a `name`.

```ts
const state = deepSignal({ user: { address: { city: 'Cambridge' } } });
// reading state.user.address.city subscribes to `user.address.city`
```

One thing surprises people, and devtools show it plainly: reading
`state.todos.length` subscribes to **two** things — the `todos` property of the
root, and the array's own `length`. Both appear in `dependencies`, which is the
answer to "why did this update when I replaced the whole array?".

## In a test

`attach()` works anywhere, so an assertion about the graph is an ordinary test:

```ts
import { attach, detach, inspect } from '@firsthandjs/devtools';

it('subscribes to exactly one property', () => {
  attach();
  render(() => <p>{state.user.name}</p>, host);

  expect(inspect(host.querySelector('p'))[0]?.dependencies.map((d) => d.name)).toEqual([
    'user.name',
  ]);
  detach();
});
```

That is a real use, not a demonstration: "this part reads more than it should"
is a performance bug that is otherwise invisible until the profile is taken.

## What it costs

**Nothing in production.** The hooks devtools read live in modules the build
replaces with empty functions, so a shipped bundle contains neither the code
nor the message strings, and the package itself is only downloaded by an
application that imports it.

Of the package, an application that imports it downloads 1.40 kB gzip; the
panel is another 1.95 kB, and only if it is opened.

The measured exception, because this documentation does not round numbers away:
the _calls_ to those empty functions cost 14 bytes minified and 5 gzip across
the whole runtime, since a bundler cannot prove a call has no effect. The hot
path is unchanged — `bench:ic` still reports 1.01× for mixed cell shapes.

**In development, nothing until `attach()`.** Naming every cell costs a
`WeakMap` write, and a hundred thousand rows would feel that — which is exactly
the size at which devtools matter most, so the cost is opt-in rather than
merely small.

Call it before the application creates anything. A cell created earlier still
works and still appears; it is simply unnamed.

---

Next: [Performance](14-performance.md) — what is fast by construction, what is
not, and how to measure it.
