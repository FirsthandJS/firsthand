# ADR-0011: Eager unlinking, and leak tests that can actually fail

Status: accepted (Phase 1)

## Problem

A long-lived application creates and destroys millions of reactive scopes. Any
retained reference — a subscriber link, a context record, an event handler, a DOM
node — accumulates. "No leaks" must be a tested property, not an intention.

## Constraints

- Disposal must be complete: after disposing a component, nothing in the live
  graph may reference its signals, effects, DOM nodes or handlers.
- Tests must be deterministic enough to run in CI on three engines.
- GC is not observable directly in a standard browser context.

## Options considered

1. **Rely on GC and weak collections throughout** (`WeakRef` subscribers,
   `FinalizationRegistry` cleanup). Removes whole classes of leaks, but makes
   update semantics non-deterministic (a subscriber may vanish mid-flush) and
   costs weak-ref overhead on the hottest structure in the framework.
2. **Eager, explicit unlinking on disposal**, with strong references in the
   graph. Deterministic, fast, but every path that creates a subscription must
   have a matching disposal path — which is exactly what the owner tree
   guarantees structurally.
3. **No explicit disposal, detach on next notify.** Cheap to implement, leaks
   until something notifies, unbounded in the general case.

## Chosen design

Option 2. Every subscription is created under an owner; owner disposal unlinks
every edge in both directions, runs cleanups, removes delegated handler entries
and detaches DOM. `WeakRef` appears only in _tests_, never in the runtime hot
path.

## Testing strategy

- **Structural assertions** (deterministic, all engines): after disposal, assert
  that every source's subscriber list is empty, that the owner's child list is
  empty, that the delegated-handler map has no entry for the removed nodes, and
  that a signal written after disposal runs no effects. These fail immediately
  on a regression and do not depend on GC.
- **Allocation-bounded loops**: create and destroy 10 000 components, repeat N
  times, and assert that retained heap growth between cycle 2 and cycle N stays
  under a threshold. Run in Chromium with `--expose-gc` and explicit GC between
  cycles; reported, not gated, on Firefox and WebKit where forcing GC is not
  available.
- **`WeakRef` probes**: hold weak references to a disposed component's signal,
  owner and root DOM node; after forced GC, assert `deref() === undefined`. Only
  executed where forced GC exists; skipped with a recorded reason elsewhere,
  never silently.

## Performance implications

Strong references and pointer unlinking are the fast option; weak collections
would add indirection to every subscriber walk. Disposal is O(edges in the
subtree) with no allocation.

## Memory implications

The point of the ADR: retained size after disposal returns to the pre-creation
baseline modulo allocator noise, and that is asserted rather than assumed.

## DX implications

Developers rarely dispose manually — owners do it. The exception is code created
outside a component, where `createRoot` hands back an explicit `dispose` and the
documentation says plainly that not calling it leaks.

## Rejected alternatives

Weak-everything (non-deterministic updates, hot-path cost), detach-on-notify
(unbounded retention), and "assume GC handles it" (untestable, and wrong as soon
as one global subscriber list exists).
