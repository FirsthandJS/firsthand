# @firsthandjs/deep

Deep reactivity for Firsthand: a proxy where every property, at any depth, is a
signal — the shape Vue calls `reactive()`.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/02-reactivity.md#deep-state) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/deep.md) · [all docs](https://github.com/firsthandjs/firsthand/blob/main/docs/README.md)

```
npm install @firsthandjs/deep
```

0.74 kB gzip. It depends on `@firsthandjs/core` and changes nothing about
`signal`.

```ts
import { effect } from '@firsthandjs/core';
import { deepSignal } from '@firsthandjs/deep';

const state = deepSignal({ user: { name: 'Ada' }, todos: [] as string[] });

effect(() => console.log(state.user.name)); // subscribes to that property
state.user.name = 'Grace'; // and only that effect re-runs
state.todos.push('write the docs'); // arrays too, as one update
```

## Why it exists

A signal holds one value and notices when that value is **replaced**:

```ts
const form = signal({ user: { name: 'Ada' } });
form.value.user.name = 'Grace'; // invisible: the signal holds the same object
```

Replacing the object is right for small state and tedious for a form, a
document or a settings tree. `deepSignal` tracks per property instead, so an
effect that read `state.user.name` ignores a change to `state.user.age`, and a
write to a property nobody has read costs nothing at all.

## Only objects and arrays

```ts
deepSignal(new Map()); // compile error
deepSignal(new Date()); // compile error
deepSignal(new Point()); // compile error
```

Those read their own internals through `this`, and inside a proxy `this` is the
proxy — a proxied `Map` throws on `get`. Keep them in a `signal` and replace
them on each edit; one held inside deep state still works, it is simply not
reactive itself.

## The rest of the surface

| Export            | What it does                                       |
| ----------------- | -------------------------------------------------- |
| `deepSignal(obj)` | The proxy. Same type in, same type out             |
| `raw(value)`      | The object behind a proxy, for clones and requests |
| `isDeep(value)`   | Whether something is a proxy this package made     |

Full rules — `Object.keys`, `in`, `delete`, every array mutator, identity — are
in the [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/deep.md),
and the reasoning is in [ADR-0018](https://github.com/firsthandjs/firsthand/blob/main/docs/adr/0018-deep-reactivity-as-its-own-package.md).
