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

### A big list where one row changes

A `signal<Row[]>` is one signal holding an array. Changing one row means a new
array, so the keyed list re-keys every row to move one text node. At ten
thousand rows that is 1.85 ms of work to change a label.

`deepSignal` makes every property its own signal, so the same change wakes the
part that reads that label and nothing else — 0.008 ms, measured by
`npm run bench:deep`:

```tsx
import { deepSignal } from '@firsthandjs/deep';

const state = deepSignal({ rows: [] as Row[] });

// One property, one part. The list is not re-run.
state.rows[index].label = 'changed';
```

It is a trade rather than a free win: proxying ten thousand rows costs about
1.6× on the first mount. Worth it for a table you mount once and edit often;
not worth it for one you rebuild whenever it is shown.

And keep the size of the win in proportion. In that same measurement the
browser spent **33 ms** laying the table out again, either way. Where a list
is large enough for this to matter, the layout is usually the bill — which is
why the next section is about measuring rather than guessing.

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
| a site per expression | 31.00 ms | 10.820 ms | 12.1 MB |
| one render function | **21.00 ms** | **8.185 ms** | **10.3 MB** |
| | 1.48x | 1.32x | 1.17x |

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

There is headroom left, and it has now been measured rather than estimated.
A run looks each of its sites up through `site(store, index)` and re-walks the
template's `nextSibling` chain on every pass — twenty of each, per run, for
the same twenty nodes it walked last time. A third variant in the same
benchmark takes both once per instance instead, through the same published
protocol:

<!-- prettier-ignore-start -->

| | mount | update | heap |
|---|---|---|---|
| one render function | 21.00 ms | 8.185 ms | 10.3 MB |
| sites and navigation hoisted | **21.20 ms** | **6.775 ms** | **7.6 MB** |
| | — | 1.21x | 1.36x |

<!-- prettier-ignore-end -->

So about a sixth of the update path, and a quarter of the heap, are bookkeeping
a compiler could do once. Doing it needs one more thing than hoisting: the
sweep that disposes what a run did not reach uses those very lookups to know
what was reached, so only the sites a run reaches **unconditionally** can be
hoisted — which the compiler knows and the runtime does not.

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
npm run bench            # against React, Solid and Vue, one session, same DOM
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

The README publishes them in full, including the scenarios Firsthand loses and
the rows whose spread makes a median unreliable. The short version: clearly
ahead of React 19 on the render/update set, and **level with Solid** — which is
the honest and the interesting result, because Solid makes the same bet from a
different direction. Where a confidence interval includes 1.0 the README says
so rather than rounding it into a win.

Those absolute milliseconds are worth less than the ratio. The same machine
measures 4–6 % differently from one day to the next — thermal state, what else
the operating system is doing — and every implementation moves together when it
does. That is the reason every scenario is measured in one interleaved browser
session: the ratio survives a slow day, the medians do not.

What is **not** measured: Firefox and WebKit performance (they run the
correctness suite only), and JavaScript time separately from the layout it
causes — every timing deliberately includes it.

---

Next: [Building and deploying](16-building.md).
