# Reactivity

[Index](../README.md) · Previous: [Getting started](01-getting-started.md) ·
Next: [Components](03-components.md)

---

Three primitives, and one rule about when the DOM changes.

```ts
import { signal, computed, effect, batch, untrack } from '@firsthandjs/dom';
```

## Signals

A signal is a value that remembers who read it.

```ts
const count = signal(0);

count.value; // read — and subscribe, if something is watching
count.value = 1; // write
count.peek(); // read without subscribing
count.set((n) => n + 1); // update from the previous value
```

A write that does not change the value does nothing at all — `Object.is` by
default:

```ts
count.value = 1;
count.value = 1; // nothing downstream runs
```

Pass your own comparison when that default is wrong:

```ts
const point = signal({ x: 0, y: 0 }, { equals: (a, b) => a.x === b.x && a.y === b.y });
const always = signal(0, { equals: false }); // notify on every write
```

### Objects are not deeply reactive

A signal holds a value; it does not watch inside it.

```ts
const user = signal({ name: 'Ada' });
user.value.name = 'Grace'; // nothing happens
user.value = { ...user.value, name: 'Grace' }; // this is the write
```

This is a deliberate choice, not a missing feature: a proxy that watches every
property has to allocate one per object and intercept every access. What you
get instead is that a write is visible in the code that performs it.

## Computeds

A computed derives a value, lazily and once per change.

```ts
const doubled = computed(() => count.value * 2);
```

- **Lazy**: a computed nobody reads never runs.
- **Memoised**: reading it twice runs the body once.
- **Glitch-free**: it never produces an intermediate value that could not have
  existed, and does so without a topological sort — see
  [ADR-0001](../adr/0001-fine-grained-reactivity-instead-of-rerender.md).

The interesting property is that a computed whose inputs changed but whose own
value did not **notifies nothing**:

```ts
const positive = computed(() => count.value > 0);

count.value = 5;
count.value = 9; // `positive` recomputes, stays true, and nothing downstream runs
```

That is what keeps a change from spreading further than it means anything.

## Effects

An effect runs now, and again whenever something it read changes.

```ts
const stop = effect(() => {
  document.title = `${String(count.value)} items`;
});

stop(); // unsubscribe
```

Return a function to clean up before each re-run and on disposal:

```ts
effect(() => {
  const id = setInterval(tick, delay.value);
  return () => clearInterval(id);
});
```

**Dependencies are observed, not declared.** A conditional read genuinely drops
the dependency it did not take:

```ts
effect(() => {
  if (enabled.value) {
    console.log(data.value); // while disabled, `data` is not a dependency
  }
});
```

Inside a component, an effect is owned by that component and disposed with it —
you rarely need the returned disposer. See
[Context and lifecycle](05-context-and-lifecycle.md).

## When does the DOM update?

**Synchronously, at the end of the outermost write or `batch()`.** A signal
write never schedules a microtask, so there is no `await tick()` in your code
or in your tests:

```ts
count.value = 1;
element.textContent; // already the new value
```

The trade-off is explicit: an unbatched loop of _n_ writes does _n_ DOM passes.

```ts
batch(() => {
  first.value = 1;
  second.value = 2;
}); // one pass
```

Firsthand batches its own multi-writes — list reconciliation, prop propagation,
context swaps — so "one user action, many derived changes" is already one pass.
The reasoning and what was rejected are in
[ADR-0006](../adr/0006-synchronous-scheduling.md).

## Deep state

A signal holds **one value** and notices when that value is replaced. Mutating
inside it is invisible:

```ts
const user = signal({ name: 'Ada' });
user.value.name = 'Grace'; // nothing updates: the signal still holds the same object
user.value = { ...user.value, name: 'Grace' }; // this is what a signal wants
```

Replacing the object is fine for small state and gets tedious for a form or a
document. `@firsthandjs/deep` is the other shape — the one Vue calls
`reactive()`:

```bash
npm install @firsthandjs/deep
```

```ts
import { deepSignal } from '@firsthandjs/deep';

const state = deepSignal({ user: { name: 'Ada' }, todos: [] as string[] });

effect(() => console.log(state.user.name)); // subscribes to that one property
state.user.name = 'Grace'; // and only that effect re-runs
state.todos.push('write the docs'); // arrays too, as one update
```

Every property, at any depth, behaves like a signal — without `.value`
anywhere, because the proxy is the value. Reads are tracked per property, so an
effect that read `state.user.name` ignores a change to `state.user.age`, and
writing a property nobody has read costs nothing at all.

It is 0.72 kB, it does not change `signal`, and both live in the same graph:
one effect can read a signal and deep state together.

**Only objects and arrays.** A `Map`, a `Date` or a class instance is rejected
by the type, because those read their own internals through `this` and a proxy
is not the object. Keep them in a `signal` and replace them on each edit.
[The reference](../reference/deep.md) has the full rules, including what
happens to `Object.keys`, `in` and each array mutator.

**Which to reach for.** A value — a count, a flag, an id — is a `signal`. A
tree you edit in place is `deepSignal`. A signal read is one property read; a
deep read is a proxy trap plus a cell read, which is the price of not threading
`.value` through a structure.

## Reading without subscribing

```ts
const id = untrack(() => currentUser.value.id); // read, do not depend on it
count.peek(); // the same thing for one signal
```

Use it when you want a value but not a dependency — logging, an id passed to a
request, a one-time initialisation.

## Cycles

An effect that writes what it reads is a bug, and it is reported as one:

```ts
effect(() => {
  count.value = count.value + 1; // throws FirsthandCycleError
});
```

The flush gives up after a large but finite number of steps rather than hanging
the tab.

## Types

```ts
const count: Signal<number> = signal(0);
const doubled: ReadonlyCell<number> = computed(() => count.value * 2);
```

`ReadonlyCell` has no setter — assigning to `doubled.value` is a type error,
which the [type-level tests](../../packages/core/test/types.test-d.ts) assert.

---

Next: [Components](03-components.md) — what a component is when it only runs
once.
