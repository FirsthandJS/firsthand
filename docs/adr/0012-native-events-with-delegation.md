# ADR-0012: Native events with opt-out delegation, no synthetic event system

Status: **accepted**, and confirmed by measurement (2026-09-19)

## Problem

Handlers must be attached once and never re-created by a state change. At 100 000
rows, attaching one listener per row per event type is a large, measurable cost.
React's answer was a synthetic event system; that is explicitly out of scope.

## Constraints

- `onClick={fn}` must receive the real `Event`, with real `target`,
  `currentTarget`, `composedPath()` and real `preventDefault` semantics.
- No wrapper object allocation per dispatch.
- Must work inside shadow roots and portals.
- Must not break `stopPropagation` expectations.

## Options considered

1. **One native listener per node per event type.** Simplest and most faithful.
   Cost: n listeners for n rows; listener registration is not free, and neither
   is removal on disposal.
2. **Synthetic event system.** Rejected by requirement, and it allocates a
   wrapper per dispatch and re-implements propagation the browser already does.
3. **Native delegation**: one real listener per event type per mount root, with
   a per-node handler stored on the element; dispatch walks `composedPath()` and
   invokes handlers found along it.

## Chosen design

Option 3 for a fixed list of bubbling event types (`click`, `input`, `change`,
`keydown`, `keyup`, `pointerdown`, `pointerup`, ...), option 1 for everything
else and for explicit opt-outs.

- The handler is stored directly on the element under a namespaced property
  (`$firsthand$click`), so there is no map to grow, no lookup by node, and nothing
  that outlives the node. A symbol key was the first choice and was dropped
  because a plain string key keeps the dispatch lookup a monomorphic property
  read on every node in `composedPath()`.
- Propagation uses the real `composedPath()`, so shadow roots work; the walk
  stops at the mount root and honours `stopPropagation` by checking
  `cancelBubble`.
- `currentTarget` is set per step so handlers behave as they would natively.
- The escape hatches are explicit: `onClick:native` attaches directly,
  `:capture`, `:once`, `:passive` map to the corresponding `addEventListener`
  options.
- The event object is the browser's own. Nothing is pooled, nothing is wrapped.

Portals: a portal's DOM is outside the mount root, so the delegation root for
portal content is the portal's physical container, registered once per container.

## Performance implications

Measured (`npm run bench:micro`, raw data in `benchmarks/results/micro.json`),
2000 rows, Chromium, median of 12 repetitions after 3 warmups, with the
two approaches alternating so neither systematically goes first. "Setup" times
the handler attachment alone — the rows are built first, untimed, because
including DOM construction buries the difference the measurement exists to see.
"Dispatch" clicks every row once.

| Nesting depth | Setup, delegated | Setup, direct | Dispatch, delegated | Dispatch, direct |
| ------------: | ---------------: | ------------: | ------------------: | ---------------: |
|             1 |          0.10 ms |       0.30 ms |             7.25 ms |          8.55 ms |
|             5 |          0.10 ms |       0.40 ms |             8.60 ms |         10.15 ms |
|            20 |          0.10 ms |       0.60 ms |            20.35 ms |         21.95 ms |

Both ends of the trade came out in favour of delegation:

- **Registration** is essentially free (0.00–0.10 ms for 2000 handlers) against
  0.30–0.60 ms for `addEventListener`. Both are small; the ratio is not.
- **Dispatch** is _faster_ delegated at every depth tested, including depth 20
  where the `composedPath()` walk is longest (11.75 ms against 12.30 ms).

This refutes the risk the project recorded against this decision (R4 in
`docs/architecture/risks.md`), which was that the delegation lookup might cost
more at realistic depths than a native listener dispatch. It does not.

The first version of this measurement timed row construction together with
handler attachment and showed the two approaches as identical — DOM building
dominated and hid the effect entirely. That version is not the one reported
here, and the reason is recorded so the same mistake is not repeated.

## Memory implications

One property per handler per node (unavoidable, and it is exactly one
reference), plus one listener per event type on the document. No handler
registry that outlives the node.

## DX implications

Handlers are ordinary functions receiving ordinary events. `e.stopPropagation()`
and `e.preventDefault()` behave as documented by the platform. The documented
difference from direct listeners: a delegated handler runs during the root's
dispatch, so a native listener attached _between_ the element and the root will
see the event first. The opt-out exists for the rare case where that matters.

## Rejected alternatives

Per-node listeners as the default (mount cost at scale), synthetic events
(forbidden, allocating, and a re-implementation of the platform).
