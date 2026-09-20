# ADR-0018: Deep reactivity beside signals, not inside them

**Status:** accepted · 2026-09-20

## Problem

A `signal` holds one value and notifies when that value is replaced. For a
tree, that is the wrong grain:

```ts
const form = signal({ user: { name: 'Ada' }, tags: ['x'] });
form.value.user.name = 'Grace'; // nothing happens
form.value = { ...form.value, user: { ...form.value.user, name: 'Grace' } }; // this does
```

The second line is correct and nobody enjoys writing it. For a settings tree, a
document, or a form with thirty fields, spreading down to the leaf on every
keystroke is the whole day's work — and each spread replaces objects that
nothing else changed, so every reader of every sibling is notified too.

Vue answers this with `reactive()`: a proxy where reading any property at any
depth subscribes, and writing any property notifies. The request was to have
that here **without changing `signal`**.

## Constraints

- `signal` keeps its semantics, its size and its performance exactly. It is the
  hot path, it is measured, and a framework that quietly makes every signal a
  proxy would break both the numbers and the mental model.
- An application that does not use deep state must not pay a byte for it.
- Deep reads must be ordinary reads to the rest of the framework: a `computed`,
  an `effect`, a DOM binding and `untrack` must all work with no special case.
- The set of values it accepts must be enforced by the **type**, not discovered
  at runtime.

## Options

1. **A `deep: true` option on `signal`.** One import, and wrong: it changes the
   return type of the most used function in the framework, and every call site
   then has to know which kind it is holding.
2. **Deep reactivity inside `@firsthandjs/core`.** Convenient, but the core is
   the thing every application downloads, and this is not something every
   application needs. The project's own non-goal — "anything optional inside
   the core runtime" — rules it out.
3. **Its own package, built on `signal`.** `@firsthandjs/deep`, one dependency,
   optional by construction.

## Chosen design

Option 3. `deepSignal(object)` returns a proxy; each property that is **read**
gets a version cell (an ordinary `signal(0)`), and a write bumps it. Nothing
new enters the reactive graph: the cells are signals, so dependency tracking,
the synchronous flush, disposal and `untrack` all behave as they already do.

Three details worth stating:

- **Cells are created on read, not on write.** Writing a property nobody has
  read allocates nothing, so building state up before anything renders is free.
- **`length` is compared, not assumed.** Writing an array index updates
  `length` implicitly, which makes the explicit `length` write inside `push` a
  no-op — so watching the assignment would mean `push` never notifies a length
  reader. The trap compares the length before and after instead. That bug was
  real and is now a test.
- **Array mutators run inside `batch`.** `push` writes an index and then a
  length; without batching, one logical change would flush twice.

### Only objects and arrays

`Deep = Record<PropertyKey, unknown> | unknown[]`, enforced by the signature.
A `Map`, `Set`, `Date`, `RegExp`, `Promise`, function or class instance is a
compile error, and one found inside deep state is handed back unproxied.

The reason is not taste. Those objects reach their internal state through
`this`, and inside a proxy `this` is the proxy — a proxied `Map` throws on
`get`. Vue handles it with a second family of handlers per collection type;
that is a real amount of code for a case where "keep it in a `signal` and
replace it" works. Saying no keeps the package at 0.72 kB and keeps the failure
at compile time.

## Performance implications

- **`@firsthandjs/core` is untouched**: 2.31 kB gzip, the same file, the same
  benchmark numbers. The runtime budget claim (5.88 kB for core plus dom) is
  unaffected because nothing was added to either.
- `@firsthandjs/deep` is **0.72 kB gzip**, downloaded only if imported.
- A deep read is a proxy trap plus a cell read; a signal read is a property
  read. The documentation says which to reach for rather than implying they
  cost the same.
- A proxy per object reached and a `Map` of cells per object that is read.
  Nested objects are wrapped lazily, so an untouched branch costs nothing.

## Memory implications

Proxies and cell tables are held in `WeakMap`s keyed by the raw object, so a
subtree that becomes unreachable takes its proxy and its cells with it. Cells
are per property **that was read**, not per property.

## DX implications

- No `.value` inside deep state: `state.user.name = 'Grace'` is the write.
- The same object comes back every time, so `===` means what it looks like and
  a keyed list can use a row object as its key.
- `raw(state)` escapes the proxy for a `structuredClone` or a `fetch` body.
- Two shapes to choose between, which is the honest cost of this ADR: a value
  is a `signal`, a tree you edit in place is a `deepSignal`. The guide and the
  reference both carry the table.

## Rejected alternatives

- **Making `signal` deep by default.** It would make every signal a proxy, slow
  the hot path, and silently change what a write means for existing code.
- **A compiler transform** that rewrites nested writes into spreads. It would
  work only for state the compiler can see, and fail exactly where state
  crosses a function boundary — the case that motivated this.
- **Supporting `Map` and `Set`** with collection handlers. More code than the
  rest of the package, for state that a `signal` already models adequately when
  replaced rather than mutated.
- **Returning a cell (`.value`) that happens to be deep.** Two mechanisms in
  one object, and the question "does this write notify?" would depend on which
  layer you touched.
