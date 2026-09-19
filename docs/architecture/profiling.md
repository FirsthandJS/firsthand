# Profiling

```bash
npm run bench:profile     # writes benchmarks/results/profile.json
```

Two questions the timing benchmark cannot answer: **what allocates**, and
**where the self time goes**. Both are measured with Chromium's own profilers
through CDP, on the same benchmark application, with the setup mounted _before_
the profiling window opens — leaving it inside attributes the cost of building a
thousand rows to the operation under test, which is how a profile ends up
pointing at the wrong function.

This profiles Firsthand only. It is the input to the next optimisation, not a
comparison; mixing React into it would invite reading it as one.

The bundle is built unminified and resolved against the package sources, so the
hotspots have names. It is the same code as the timed build; only the
identifiers differ.

## Allocation per operation

Sampling heap profiler, 256-byte sampling interval. Figures are estimates.

| Scenario               |       Bytes per operation | What that is                                                                                                                                    |
| ---------------------- | ------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `select-row-1k`        |                  **41 B** | 1 000 `class` bindings re-evaluate. Nothing is allocated; this is the profiler's own floor.                                                     |
| `update-single-row-1k` |                 **175 B** | One row's text changes in a list of 1 000. The bytes are the reconciler's index map, plus the new array the _application_ builds with `.map()`. |
| `swap-rows-1k`         |                 **528 B** | The reconciler's `Map` and `Int32Array` for the changed middle. By design (ADR-0010).                                                           |
| `rapid-signal-writes`  | **977 B / 10 000 writes** | **0.10 bytes per signal write.**                                                                                                                |
| `update-every-10th-1k` |                    2.8 kB | 100 text nodes updated, plus the application's own array.                                                                                       |
| `mount-1k`             |                    100 kB | 100 bytes per row: the cloned nodes, one owner, and the effects for its dynamic parts.                                                          |

The design claim was that a steady-state text or attribute update allocates
nothing and that a re-running effect with stable dependencies reuses its edges
rather than rebuilding them. `select-row-1k` at 41 bytes across a thousand
re-evaluated bindings, and a signal write at 0.10 bytes, are what that claim
looks like when it is true. These are sampled estimates, so they move by a few
bytes between runs; the order of magnitude is the claim, not the digits.

## Self time

CPU profiler, 100 µs sampling interval.

| Scenario               | Top self time                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `mount-1k`             | the row body, then `removeChild` (91 ms) and `cloneNode` (31 ms) — the platform, not the framework |
| `update-every-10th-1k` | the row body, then `applyChild` (6 ms)                                                             |
| `swap-rows-1k`         | the row body, then `reconcile` (7 ms)                                                              |
| `rapid-signal-writes`  | `applyChild` (71 ms), then `flush` (7 ms)                                                          |

The recurring answer is that the framework is not where the time goes: the
application callback and the DOM are. `applyChild` leading the rapid-write
scenario is the exception and is expected — with nothing else happening, the
text-node write _is_ the workload.

## What this does not measure

- **GC pause distribution.** The allocation figures say how much garbage is
  produced; they do not say when collection happens or how long it takes.
- **Other engines.** Firefox and WebKit have no equivalent CDP profiler here.
  The allocation behaviour is a property of the code rather than the engine, but
  it has not been confirmed on them.
- **Real applications.** A benchmark row is a simpler shape than most components.

## Using it

Run it before and after a change that is meant to be faster, and put both
numbers in the pull request. A change that makes the code materially harder to
read and moves neither figure gets reverted — see
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).
