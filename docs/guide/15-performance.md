# Performance

[Index](../README.md) · Previous: [Devtools](14-devtools.md) · Next:
[Building and deploying](16-building.md)

---

Most of what makes an application fast here is structural: you get it by
writing ordinary code, and you would have to work to lose it. This page is
about the parts that are _not_ automatic, and about how to find out rather than
guess.

## What you get without trying

- A component body runs **once**. A parent changing does not re-run a child, so
  there is no `memo()` to remember.
- An update writes the DOM nodes that read the value. A text interpolation is a
  text node write; an attribute is an attribute write.
- A handler is created once. There is no `useCallback`.
- A `computed` whose value did not change notifies nothing downstream, so a
  change stops spreading where it stops meaning anything.
- Static markup is cloned from a `<template>`, not built element by element.
- Event handlers are delegated: mounting a thousand rows registers zero
  listeners.
- The steady-state update path allocates nothing for a text or attribute
  change — measured at ~40 bytes across a thousand re-evaluated bindings.

## What is not automatic

### Keys

A `.map()` without a `key` is reconciled by node identity, which for freshly
created nodes means "replace". With a key, rows keep their nodes, their state
and their owners across a reorder.

```tsx
{
  items.value.map((item) => <Row key={item.id} item={item} />);
}
```

### Unbatched loops

A write flushes synchronously. A loop of _n_ writes does _n_ DOM passes:

```ts
batch(() => {
  for (const id of selection) {
    selected.value = { ...selected.value, [id]: true };
  }
});
```

Firsthand batches its own multi-writes, so this only bites when you write in a
loop yourself.

### Reading more than you need

A part depends on what it read. Reading a whole object where you need one field
makes the part depend on the object:

```tsx
<p>{user.value.name}</p>            // re-runs when `user` is replaced
<p>{name.value}</p>                 // re-runs when the name changes
```

Both are usually fine. It matters when the object changes often and the field
does not — split the signal, or derive with a `computed`, which stops the
propagation when its own value is unchanged.

### Query identity

A query's identity is its tags plus its `variables`. A value in neither is
captured in the fetcher's closure, and the entry will answer out of its first
result for ever. See [Data](09-data.md#variables).

### Styles per value

An interpolation in a declaration's **value** becomes a custom property — one
rule for any number of instances. An interpolation producing a whole block
becomes a class per distinct result. Prefer the first for anything that varies
per row. See [Styling](07-styling.md).

### The React bridge

Below a bridged component the React model applies, with React's own performance
characteristics, and React itself is about 45 kB gzip. That is the price of
running a React component, and it is the same price a React application pays.
See [React interop](11-react-interop.md).

## Render functions

A [render function](03-components.md#functions-are-the-unit-of-reactive-work)
collapses a view into one reactive scope: one read of the source, one pass of
derivation, and a write only where the value moved. Where a component's sites
share a source — a detail view, a card, a row — that is less work than giving
each site a scope of its own.

The same component, written both ways, compiled by the real compiler and
checked to render the same 20,000 nodes before
anything is timed. 1,000 instances of
20 sites, all derived from one signal;
medians of 11 repetitions with the
order rotated.

<!-- prettier-ignore-start -->

| | mount | update | heap |
|---|---|---|---|
| a site per expression | 31.40 ms | 11.435 ms | 14.0 MB |
| one render function | **20.70 ms** | **8.355 ms** | **8.8 MB** |
| | 1.52x | 1.36x | 1.59x |

<!-- prettier-ignore-end -->

`npm run bench:runs` reproduces it, and writes
`benchmarks/results/render-functions.json`.

**What the numbers are, and are not.** They are one shape: twenty sites and one
source. Turn that around — twenty sites with twenty independent sources — and
the fine-grained form is the faster one, because a run would look at all twenty
to write the one that moved. The compiler does not make you choose blindly:
an expression that names nothing from the run keeps its own scope either way,
so a view that mixes the two gets both behaviours in the one component.

Three things move the numbers, in order of size:

- **Fewer effects.** Twenty sites derived from one signal are twenty effects,
  twenty subscriptions and twenty reads of that signal. A run is one of each.
  This is most of the mount and heap difference.
- **One derivation.** `const person = profile.value` unpacks the source once
  instead of twenty times.
- **Writes that do not happen.** Each site remembers what it last wrote, so a
  run that produces what is already on screen touches nothing. Comparing a
  remembered string costs about half of setting one; comparing against the DOM
  instead — reading `text.data` back — measured _slower than not comparing at
  all_, which is why the remembered value is the one that is kept.

There is headroom left: every write looks its site up through
`site(store, index)` rather than through a local, and a hand-written stand-in
that hoisted those lookups measured about 20 % better again on the update path.

## Measuring

Guessing is what the benchmarks in this repository exist to replace. Three
predictions in the ADRs were **wrong** and were corrected by measurement: the
element host was cheaper than feared, delegation was faster rather than slower,
and the reconciler the design expected to win lost.

For your own application:

```ts
performance.mark('start');
// the interaction
performance.mark('end');
performance.measure('interaction', 'start', 'end');
```

Then read the flame chart. What you are usually looking for is not framework
time at all — it is layout caused by reading a geometry property in a loop, or
a `JSON.parse` of something large, or an image decode.

The repository's own harness, if you want to compare implementations:

```bash
npm run bench            # against React, same browser session, DOM verified identical
npm run bench:micro      # element host, delegation, individual operations
npm run bench:profile    # allocation per binding and per signal write
npm run bench:reconcilers
npm run bench:ic         # whether `.value` reads stay monomorphic (R2)
```

Its rules — locked versions, warmups, medians and p95, published losses, raw
JSON committed — are in
[Benchmark methodology](../../README.md#benchmark-methodology). They are worth
copying whether or not you use this framework.

## The numbers, and their caveats

The README publishes them in full, including the scenarios React wins and the
rows whose spread makes a median unreliable. The short version: about 1.54×
faster than React 19 on the render/update set, 4.1 s against 30.9 s at 100 000
rows, less memory retained and less left behind after disposal, all in
Chromium.

Those absolute milliseconds are worth less than the ratio. The same machine
measures 4–6 % differently from one day to the next — thermal state, what else
the operating system is doing — and both implementations move together when it
does. That is the reason every scenario is measured in one interleaved browser
session: the ratio survives a slow day, the medians do not.

What is **not** measured: Firefox and WebKit performance (they run the
correctness suite only), and JavaScript time separately from the layout it
causes — every timing deliberately includes it.

---

Next: [Building and deploying](16-building.md).
