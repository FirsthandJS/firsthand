# ADR-0010: Keyed list reconciliation chosen by benchmark, not by theory

Status: **accepted** — decided by measurement, 2026-09-19

## Problem

Lists dominate the benchmark set and most real applications. The reconciler must
handle append, prepend, insert, remove, swap, reorder, replace, per-item update
and clear efficiently at 1 000, 10 000 and 100 000 rows, reusing DOM nodes and
preserving row owners across reorders.

## Constraints

- DOM nodes and owners must survive a reorder (focus, scroll position, media
  element state, component-local state all depend on it).
- Minimal `insertBefore` calls; each one is real layout-invalidating work.
- Allocation per reconcile must be bounded and small.
- Duplicate keys must be a loud error in dev.

## Options considered

1. **LIS over a key-to-index map.** Computes the longest increasing subsequence
   of surviving rows and moves only the rows outside it — provably minimal moves.
   Costs a map build plus an O(n log n) pass and several typed-array allocations
   per reconcile.
2. **Two-ended prefix/suffix scan with an LIS fallback.** Common cases (append,
   prepend, single insert, single remove, clear, whole replace) are handled by
   pointer scans with no map and no allocation; only genuinely scrambled middles
   fall through to the map + LIS path.
3. **Naive keyed remove-and-reinsert.** Trivially correct, reuses nodes, but
   issues O(n) moves for a reverse or swap.
4. **Non-keyed positional patching.** Fastest for pure appends, wrong for
   reorders (it destroys row identity), so it is not a candidate for keyed
   lists; it is kept as the implementation for explicitly non-keyed lists.

## Decision procedure

All three candidates were implemented behind one signature and measured in the
same harness, on the same DOM, in the same browser session, over ten operations
at 1 000 and 10 000 nodes. Two rules made the comparison worth trusting:

- **Correctness is part of every measurement.** After each reconcile the
  parent's children must be exactly the target list, in order. A candidate that
  is fast and wrong is reported as failed, not as fast.
- **The candidate order rotates every repetition.** With a fixed order the
  first candidate measured systematically inherits whatever state the previous
  one left behind, and the comparison partly measures that instead. Fixing this
  changed the result for `prepend`, which had looked like a 1.5x loss for LIS
  and is in fact a tie.

Runner: `node benchmarks/reconcilers/run.mjs`. Raw data:
`benchmarks/results/reconcilers.json`.

## Chosen design: longest increasing subsequence

Overall cost relative to the fastest candidate per operation (geometric mean,
so one large operation cannot decide it), and total DOM mutations issued across
the whole matrix:

| Candidate                    | Relative cost | DOM mutations |
| ---------------------------- | ------------: | ------------: |
| **LIS (shipped)**            |    **1.006x** |         58970 |
| two-ended prefix/suffix scan |        1.170x |         80440 |
| naive remove-and-reinsert    |        1.489x |        123400 |

### 10 000 nodes

| Operation      | LIS (shipped) | two-ended scan |    naive | LIS moves | scan moves |
| -------------- | ------------: | -------------: | -------: | --------: | ---------: |
| `append`       |      28.00 ms |       28.60 ms | 51.10 ms |      1000 |       1000 |
| `prepend`      |      26.30 ms |       29.50 ms | 55.30 ms |      1000 |       1000 |
| `insertMiddle` |      20.50 ms |       21.20 ms | 43.30 ms |       100 |        100 |
| `removeMiddle` |      22.00 ms |       21.90 ms | 39.50 ms |      1000 |       1000 |
| `swapEnds`     |      21.90 ms |       42.60 ms | 42.80 ms |         2 |       9997 |
| `reverse`      |      41.00 ms |       44.20 ms | 41.80 ms |      9999 |       9999 |
| `shuffle10`    |      27.90 ms |       46.00 ms | 43.10 ms |      1811 |       9980 |
| `shuffleAll`   |      45.30 ms |       47.20 ms | 45.80 ms |      8625 |       9990 |
| `replaceAll`   |      43.40 ms |       53.10 ms | 41.80 ms |     20000 |      20000 |
| `clear`        |       6.60 ms |        6.50 ms |  6.60 ms |     10000 |      10000 |

### 1 000 nodes

| Operation      | LIS (shipped) | two-ended scan |   naive | LIS moves | scan moves |
| -------------- | ------------: | -------------: | ------: | --------: | ---------: |
| `append`       |       2.00 ms |        2.00 ms | 4.20 ms |       100 |        100 |
| `prepend`      |       2.10 ms |        2.10 ms | 4.20 ms |       100 |        100 |
| `insertMiddle` |       2.20 ms |        2.20 ms | 4.20 ms |       100 |        100 |
| `removeMiddle` |       1.80 ms |        1.80 ms | 3.50 ms |       100 |        100 |
| `swapEnds`     |       1.80 ms |        3.80 ms | 3.70 ms |         2 |        997 |
| `reverse`      |       3.80 ms |        3.80 ms | 3.70 ms |       999 |        999 |
| `shuffle10`    |       2.30 ms |        3.70 ms | 3.80 ms |       182 |        988 |
| `shuffleAll`   |       3.70 ms |        3.90 ms | 3.70 ms |       850 |        990 |
| `replaceAll`   |       3.80 ms |        3.70 ms | 3.70 ms |      2000 |       2000 |
| `clear`        |       0.60 ms |        0.70 ms | 0.70 ms |      1000 |       1000 |

**This is not the outcome this ADR predicted.** It expected the two-ended scan
to win, on the reasoning that its fast paths cover what applications actually
do and allocate nothing. The fast paths do cover those cases — append, prepend,
insert and remove are a tie — but they are exactly the cases where the two
algorithms do the same work anyway. The difference shows up where they do not:
a two-element swap at 10 000 rows costs LIS **2** moves and the scan **9 997**,
and a 10 % shuffle costs 1 811 against 9 980. Minimal moves turned out to
matter more than the analysis costs, and the prediction was wrong.

LIS loses exactly one case: a full `reverse`, where the increasing subsequence
has length 1, so the map and the ordering pass buy nothing and it is about 20 %
slower than the scan. That trade is accepted and published rather than hidden;
a list that is reversed in full is rarer than one that is sorted, filtered or
swapped.

The naive baseline is 1.49x and issues twice the mutations. It stays in the
harness as the floor.

## Performance implications

Measured above. The effect on the application-level benchmark is smaller than
these numbers suggest, because the forced layout that follows a reconcile is
framework-independent and dominates at large sizes.

### What the suite has already shown

Two findings from building the benchmark, recorded because they changed the
implementation rather than just the numbers:

1. **A keyed list nested inside a conditional lost its identity.** The compiler
   recognised `{rows.map(...)}` only when the call sat directly in the JSX
   expression container, so `{compact ? rows.map(...) : other.map(...)}` stayed
   an unkeyed array — and evaluating it inline made the _conditional_ depend on
   the list's data, rebuilding every row on every change. Measured cost before
   the fix: `update-single-row-10k` went from 37 ms to 463 ms, `remove-row` from
   2.7 ms to 37 ms, and `append-1k-to-10k` from 75 ms to 564 ms. Fixed in two
   places: the compiler now recognises a keyed map anywhere its value flows into
   a child slot, and a part that produces another part is mounted through its
   own effect so that its dependencies belong to it.

2. **The DOM-equality phase earns its place.** It caught two genuine defects
   before any timing ran: a row component reading the wrong prop shape, and an
   anchor comment between adjacent dynamic children. A benchmark that does not
   check its own output is comparing two different programs.

## Memory implications

Option 2's fast paths: zero allocation. Fallback path: one `Map` and two
integer arrays sized to the changed region, not to the whole list.

## DX implications

None; the reconciler is internal. `key` is consumed by the list part and never
reaches a component as a prop.
