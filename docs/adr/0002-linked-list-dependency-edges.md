# ADR-0002: Doubly-linked reusable edges instead of Sets or arrays

Status: accepted (Phase 1)

## Problem

Every reactive node needs a dependency list and a subscriber list. These lists
are rebuilt on every evaluation of every computed and effect, which makes them
the single hottest data structure in the framework.

## Constraints

- O(1) removal of a single edge (disposal, dependency drop).
- Zero allocation in the common case where dependencies did not change.
- No duplicate subscriptions when the same source is read twice in one run.
- Must support dynamic dependency sets.

## Options considered

1. **`Set<Node>` on both ends.** Simple, deduplicates for free, O(1) add/delete.
   But: a `Set` allocates internal storage, rehashes as it grows, iterates with
   an allocated iterator, and cannot express "the same edge, re-validated" — the
   dependency set must be cleared and refilled on each run, which produces
   garbage proportional to edge count per evaluation.
2. **Arrays with index-based reconciliation.** Cheaper than `Set` for small
   counts and iterable without allocation, but removal is O(n), and the
   "unsubscribe from the source" direction requires searching the source's
   subscriber array.
3. **Doubly-linked `Link` objects shared by both directions, reused in order.**
   Each edge is one object participating in two intrusive lists: the
   subscriber's dependency list and the source's subscriber list. On
   re-evaluation the subscriber walks its existing dependency list in order; if
   the next source read matches the next link's `dep`, the link is reused
   untouched. Divergence allocates from that point; the tail is unlinked.

## Chosen design

Option 3, with version counters for deduplication within a single evaluation
pass. The common case — a computed or effect reading the same sources in the
same order — reuses every link and allocates nothing.

## Performance implications

- Zero allocation for a re-run with stable dependencies, which is the case for
  virtually every DOM part.
- Unlinking during disposal is pointer surgery, O(1) per edge, and it detaches
  both directions at once, which is what makes disposal leak-free.
- Iteration is a pointer walk with no iterator object and no bounds checks.
- Cost: more pointer fields per edge (6) than a `Set` entry. Measured in the
  core micro-benchmark; the allocation saving dominates at realistic graph
  sizes. If a future measurement contradicts this, the structure is replaceable
  behind the internal graph API.

## Memory implications

One object of 6 pointers plus a header per live edge, versus a `Set` entry plus
the `Set`'s own load-factor overhead on both ends. Dead edges are unlinked
eagerly, so a disposed subtree drops to zero retained edges immediately rather
than waiting for a GC cycle to notice a cleared `Set`.

## DX implications

None — this structure is entirely internal. It does constrain the internal code
style: graph functions are written as flat pointer walks, not as iterator
pipelines, which is less pleasant to read and is compensated with comments and
exhaustive unit tests.

## Rejected alternatives

`Set` (allocation and rehash per evaluation), arrays (O(n) removal and
back-reference search), and "never unsubscribe, filter on notify" (unbounded
memory growth in long-lived apps).
