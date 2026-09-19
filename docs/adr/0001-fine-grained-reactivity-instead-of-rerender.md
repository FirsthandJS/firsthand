# ADR-0001: Fine-grained reactivity instead of component re-render

Status: accepted (Phase 1)

## Problem

The framework must update the DOM in response to a state change by touching
only what read that state — without re-invoking the component function,
producing a new UI tree and diffing it.

Re-running and diffing is the other well-established answer, and a good one:
a component stays a pure function of its props, and there is exactly one way
anything updates. It is not the answer here, and the requirement is to be
honest about what follows from choosing differently. The bookkeeping that model
needs — hook call order, dependency arrays, render snapshots, values captured
per render — does not arise here; in exchange, a component body is setup code
that runs once, which is its own thing to learn.

## Constraints

- A component function runs exactly once per instance.
- A state change must reach only the DOM nodes that actually read that state.
- No virtual DOM, no temporary render objects in the hot path.
- Dependencies must be discovered automatically and must be dynamic (a
  conditional read must be able to drop a dependency).
- Update order must be deterministic and glitch-free.

## Options considered

1. **Virtual DOM with memoisation.** Rejected outright by the requirements, and
   it allocates a tree per update by construction.
2. **Dirty-checking / polling.** No allocation per update, but O(state) work per
   frame and unbounded latency. Fails "only the dependent nodes".
3. **Push-only observer graph** (classic observables). Every write eagerly
   recomputes every dependent. Diamond dependencies produce glitches
   (intermediate inconsistent states) unless a topological sort is maintained,
   which costs ordering bookkeeping per edge.
4. **Pull-only (lazy) graph.** Correct and glitch-free, but nothing knows when to
   re-run the DOM effects; you need an external driver, i.e. polling.
5. **Push-invalidate / pull-evaluate hybrid.** A write marks dependents as
   "dirty" (effects) or "maybe dirty" (computeds) and queues effects. Computeds
   evaluate lazily on read and short-circuit when their inputs turn out
   unchanged.

## Chosen design

Option 5. Writes propagate invalidation only. Effects are queued in invalidation
order and flushed synchronously at the end of the outermost write or `batch`.
Computeds are lazy and memoised; a computed whose value did not change
(`Object.is`) does not propagate further, which also terminates diamond
propagation at the earliest possible point.

Dependency edges are re-observed on every evaluation, giving dynamic dependency
graphs and automatic cleanup without any declaration by the developer.

## Performance implications

- Cost of a write is proportional to the number of _invalidated_ nodes, not to
  the size of the component tree or of the state.
- No tree allocation, no diff, no reconciliation pass for ordinary updates.
- Glitch freedom comes from laziness, not from maintaining a topological order,
  so there is no per-edge ordering metadata to update.
- Cost of a read is one getter plus a link check; see ADR-0002.

## Memory implications

Steady state holds one `Link` per live dependency edge and nothing else per
update. No per-render garbage, so GC pressure during interaction is essentially
flat — this is measured explicitly in the memory suite.

## DX implications

- No dependency arrays, no hook order, no `useCallback`/`useMemo`.
- The mental model is "the DOM reads state; changing state updates those reads".
- The cost: reactivity is tied to _reading the cell_, so passing `count.value`
  into a plain function snapshots it. This is ordinary JavaScript and is
  documented explicitly rather than papered over.

## Rejected alternatives

Virtual DOM (allocation and diff per update), push-only graphs (glitches or
ordering overhead), dirty checking (latency and O(state) work).
