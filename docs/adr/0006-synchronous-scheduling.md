# ADR-0006: Synchronous flush with explicit batching

Status: accepted (Phase 1)

## Problem

When does `signal.value = x` reach the DOM? The answer has to be exact,
documented and defensible, because it determines input latency, the amount of
redundant work, and whether developers need `await tick()` in their code and
their tests.

## Constraints

- Minimal latency between an input event and the painted result.
- No unnecessary microtasks.
- Event handlers must always observe current state.
- Related changes must be batchable.
- No unnecessary layout thrashing.

## Options considered

1. **Synchronous flush per write.** Lowest latency, no scheduling machinery, no
   awaits in tests. A loop of `n` writes does `n` DOM passes.
2. **Microtask batching by default** (Preact signals, Vue). Coalesces bursts
   automatically, but every interaction pays a microtask hop before paint, and
   "is the DOM updated yet?" becomes un-answerable synchronously — which infects
   test code, measurement code and any integration with non-reactive libraries.
3. **`requestAnimationFrame` batching.** Aligns with paint and coalesces
   aggressively, but adds up to a full frame of latency to every interaction and
   makes synchronous reads of laid-out geometry impossible after a write.
4. **Priority scheduler with time slicing.** Solves a problem created by
   re-rendering whole component trees. With fine-grained updates the unit of
   work is a single DOM part, so there is nothing meaningful to slice; it adds
   size, complexity and unpredictability.

## Chosen design

Option 1 plus explicit `batch()`. A write flushes the effect queue at the end of
the outermost write or batch. No microtask is ever scheduled by a write.

Framework-internal multi-writes (list reconciliation, props propagation, context
swap) are batched internally, so the common "one user action, many derived
changes" case does one DOM pass without the developer doing anything.

Documented semantics:

```ts
count.value = 1;               // DOM is updated when this statement returns
el.offsetHeight;               // reads post-update layout, no await needed

batch(() => { a.value = 1; b.value = 2; });   // one flush after the callback

effect(() => { ... });         // runs immediately on creation, then on change
```

Nested batches flush once, at the outermost exit. Writes performed _during_ a
flush are appended to the same queue and processed in the same pass; a
re-entrancy depth limit converts runaway cycles into a thrown
`FirsthandCycleError` rather than a frozen tab.

## Performance implications

- Best case for the input-latency benchmark: no scheduling hop between handler
  and DOM.
- Worst case: a tight unbatched write loop performs redundant DOM work. This is
  measured in the `rapid signal updates` scenario, both batched and unbatched,
  and both numbers are published.
- Layout thrashing is avoided by ordering, not by deferral: within one flush,
  parts write and never read layout.

## Memory implications

One module-level queue array, reused. No timers, no promise chains, no
per-update scheduling objects.

## DX implications

- Tests do not need `await tick()`; `expect(el.textContent)` works immediately.
- Integration with imperative libraries is straightforward.
- The cost — that the developer is responsible for batching tight loops — is
  documented with the exact rule and a lint hint in dev when a single event
  handler triggers an unusually large number of flushes.

## Rejected alternatives

Microtask default (latency and un-observability), rAF default (a frame of
latency), priority scheduling (solves a re-render problem this framework does
not have, at real byte and complexity cost).
