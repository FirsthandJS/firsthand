# ADR-0020: Devtools that production does not pay for

**Status:** accepted · 2026-09-20 · the package is **experimental**: the
mechanism below is settled, the surface it exposes is not

## Problem

Fine-grained reactivity is pleasant in the small and opaque in the large. The
question that comes up in a big application is always some version of:

```
order.status
   ↓
computed(isEditable)
   ↓
Button.disabled
```

Which signal updates this DOM node? What depends on this computed? Why did that
effect just run? Which query did that invalidation hit? When does this
component's scope end? In a framework that re-renders, the answer is "the
component ran again" and a profiler is enough. Here the answer is a path
through a graph, and nothing shows it.

The constraint is absolute: **production must pay nothing**. Not a branch in
the read path, not a field on a cell, not a byte in the bundle. `.value` is the
hottest path in the framework and `bench:ic` exists to keep it monomorphic.

## What is already there

The reactive graph is not something devtools need to record. It is the
mechanism:

- every `Cell` carries `deps` and `subs` as doubly-linked `Link` lists, because
  propagation needs them (ADR-0002),
- every `Owner` carries `parent`, `head`, `tail`, `prev`, `next` and its
  `cells`, because disposal needs them,
- so from a root owner the whole component tree is enumerable, and from any
  cell the whole dependency graph is walkable in both directions.

That is the finding this ADR rests on. Devtools do not instrument the graph.
They read it.

What is genuinely missing is three things: **names**, a **way in**, and the
**causes** of an effect run, which is the one fact the graph does not retain
because nothing needs it after the flush.

## Constraints

- Zero production cost: the shipped bundle must contain neither the code nor
  its strings, and the measured performance must not move. What this could not
  reach is the last few bytes of the calls themselves — see the measurement
  below, which reports them rather than rounding them away.
- No new public API on `@firsthandjs/core`. An exported function cannot be
  shaken out of its own package's bundle, which is how strict reactivity came
  to cost 70 bytes (ADR-0019). Devtools must cost nothing at all.
- Nothing in the hot path, including in development, until someone asks for it.

## Options

1. **A field on `Cell`.** One `name` per node. Costs memory per cell in
   production and changes the shape every graph access sees. Rejected on
   ADR-0002 grounds alone.
2. **An exported devtools API on core.** Bytes in every application that never
   opens devtools.
3. **A global hook, spoken to only from each package's dev module.** Each
   package already has `dev.ts`, which the production build aliases to
   `dev.prod.ts` — empty bodies, and because those functions are not exported
   from the package's entry, the minifier removes the calls entirely. Verified
   for ADR-0019: no check and no message string in the shipped bundle.

## Chosen design

Option 3.

**The hook.** `globalThis.__FIRSTHAND_DEVTOOLS__` is an object that
`@firsthandjs/devtools` installs. Every package talks to it through its own
`dev.ts` and never through an import of another package, so there is no new
cross-package surface and nothing to export. In production the modules that
mention it do not exist.

**Off until asked.** Recording names costs a `WeakMap` write per cell, which a
hundred thousand rows would notice even in development. So nothing is recorded
until `@firsthandjs/devtools` is imported and attaches. The cost of not
attaching is one `if` in a module that production does not ship.

**Names.** Two sources today, and a third that is designed for:

- the DOM layer, which knows the node and the property a part writes, so a
  binding is `button.disabled` rather than an anonymous effect;
- the creation site, as `file:line:column`, for everything else — the first
  stack frame that does not belong to the framework;
- and, not yet built, the compiler under a `devtools` option, which is the only
  thing that can know `const count = signal(0)` is called `count`. The runtime
  cannot see a variable name, so until then a signal is named by where it was
  written.

**Causes.** The one piece of bookkeeping: what changed. Reported from `write`,
once per write, and paired with whatever runs before the next one — which is
what turns "this effect ran" into "this effect ran because `order.status`
changed". It was first placed in the propagation loops, where the dependency is
known exactly; that was a hook in the inner loop of the graph for a slightly
better answer, and the trade was the wrong way round.

## Performance implications

Measured rather than asserted, because the constraint was the point.

- **No devtools code ships.** The production bundle contains neither the hooks
  nor their strings: `grep` for the protocol in `packages/*/dist` finds nothing.
- **The hot path is untouched.** `bench:ic` reports 1.01× for a site reading
  mixed cell shapes against one reading a single shape — the same ratio as
  before, and the control still costs ~29×. The first draft of this change put
  the cause hook inside `propagate`, the inner loop of the graph; it was moved
  to `write`, which runs once per write rather than once per subscriber.
- **Component creation, measured A/B.** The hook that names a component's
  scope sits on the instantiation path, so it was compared against a build with
  the call sites removed entirely — same machine, three runs each, medians of
  the 2000-component mount: **14.00 ms with, 14.00 ms without**, inside a
  spread of 13.65–14.55 ms. The arithmetic agrees: two empty calls per
  instance is 4000 calls, roughly 6 µs, 0.04 % of the run. Below the noise by
  construction, not by luck.
- **The calls do cost bytes.** An empty function is removed; a _call_ to one is
  not, because a bundler cannot prove a call has no effect. Measured on the
  full runtime: **+32 bytes minified, +9 gzip** — 0.2 %. Neither `@__PURE__`
  annotations nor esbuild's `pure` option removes them, because both act on
  module-level side-effect analysis rather than on statements inside a function
  body. The honest number is above; it is not zero, and calling it zero would
  have been the easier sentence to write.
- **Development, not attached**: one comparison at cell creation and at flush.
- **Development, attached**: a `WeakMap` write per cell and a reference per
  scheduled effect. Walking the graph happens when the panel asks, not while
  the application runs.

## Memory implications

Everything devtools keeps is in `WeakMap`s keyed by the cell or the node, so a
disposed subtree takes its labels with it. The root registry holds weak
references and is swept when it is read.

## DX implications

- The chain above becomes something the panel prints, both directions: from a
  DOM node up to the signals that feed it, and from a signal down to everything
  it reaches.
- It is an ordinary import rather than a browser extension, so it works in
  every browser, in a test, and over SSH on someone else's machine.
- One more package, which an application only downloads if it imports it.

## Rejected alternatives

- **A browser extension.** A better panel and a much worse reach: three stores
  to publish to, a messaging bridge to maintain, and nothing at all in a
  headless test. The hook is designed so an extension could be added later
  against the same protocol.
- **Recording the graph as it is built.** Unnecessary — it is already the
  graph — and it would mean a second copy that can disagree with the first.
- **Always-on development recording.** Measurable at the scale where devtools
  matter most, which is exactly the wrong trade.
