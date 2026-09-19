# Firsthand — Performance Plan

> **No number in this document is a result.** Targets are hypotheses. Results
> live in `benchmarks/results/*.json` and are summarised in `README.md` only
> after they exist. If a target is missed, the measured value is published and
> the target is marked as missed.
>
> Status: the bundle-size budget and the React comparison have been measured —
> see the README. Allocation profiling, the reconciler comparison (ADR-0010) and
> the Firefox/WebKit benchmark runs have not.

---

## 1. Rules of measurement

These rules exist to make the eventual "faster than React" statement falsifiable
rather than promotional.

1. **Same run, same machine, same browser process.** Firsthand and React are
   measured interleaved within one browser session. Cross-CI-run comparisons are
   never published as ratios.
2. **Locked versions.** React and ReactDOM versions are pinned in
   `benchmarks/package.json` with an exact version and a lockfile, and the
   resolved version is written into every result file.
3. **Identical output.** A DOM-equality assertion runs before timing: both
   implementations must produce byte-identical serialised DOM for the same data,
   modulo framework-internal marker comments, which are asserted to be absent
   from both. A mismatch fails the benchmark.
4. **Production builds** on both sides (`NODE_ENV=production`, minified, no dev
   warnings path).
5. **Same data.** A seeded PRNG generates the dataset once per run and both
   implementations receive the same array contents.
6. **Warmup + repetitions.** >= 5 warmup iterations discarded, >= 25 measured
   iterations, reported as median, p95, and median absolute deviation. Mean and
   standard deviation are reported alongside but the median is the headline.
7. **No benchmark-only code paths.** The benchmark imports the published
   package entry points and is compiled by the published compiler. CI asserts
   that no `benchmarks/**` import reaches a non-exported module.
8. **Raw results are committed** as JSON, with full environment metadata: OS,
   CPU model, core count, RAM, browser, browser version, Node version, Firsthand
   version, React version, git commit, build mode, timestamp.
9. **No cherry-picking.** The summary table contains every measured scenario.
   Scenarios where React wins are printed with the same prominence.
10. **Aggregate claim form.** The headline metric is the geometric mean of the
    per-scenario ratios across the update/render set, with a bootstrap
    confidence interval. A claim is publishable only if the interval excludes
    1.0.

---

## 2. Scenarios

Mount: 1k / 10k / 100k rows.
Replace: 1k / 10k.
Update: every 10th row, single row.
Structure: append 1k, prepend 1k, remove row, swap two rows, reverse, clear.
Branching: conditional branch switch (hot loop).
Depth: deep component tree (depth 50, fanout 3).
Context: value change with 1 / 100 / 10 000 consumers.
Portals: portal content update.
Signals: 100 000 rapid writes, batched and unbatched.
Latency: input/change event to DOM update.
Memory: after mount, after 100 update cycles, after disposal.
Startup: time to first meaningful DOM, total JS execution time.
Bundle: raw, minified, gzip, brotli — per entry point and for a realistic app.

---

## 3. Where the time is expected to go

This started as a hypothesis list. The right-hand column is what the profiler
actually found (`npm run bench:profile`); the rows that still say "not isolated
yet" are the ones nobody has measured.

| Hot path                  | Design intent                                           | Measured                                                       |
| ------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- |
| signal read / write       | one getter, `Object.is`, subscriber walk, no allocation | 0.07 B per write, end to end                                   |
| effect re-run             | reuse existing links in order, allocate only new edges  | 36 B across 1 000 re-evaluated bindings                        |
| template clone            | `cloneNode` once per row                                | 90 B per mounted row; `cloneNode` 31 ms of a 1 000-row mount   |
| part update (text)        | `node.data = v`                                         | `applyChild` is the top self-time frame when nothing else runs |
| part update (class/style) | per-token / per-property diff                           | `removeAttribute` visible, no allocation                       |
| list reconcile            | keyed, nodes reused, minimal `insertBefore`             | LIS chosen by measurement: 2 moves for a swap, not 9 997       |
| event dispatch            | delegated, one lookup per bubble step                   | not isolated yet                                               |
| component create          | one owner object + props descriptor                     | included in the 90 B per row                                   |
| custom element host       | only when opted in                                      | not isolated yet                                               |

Sources: `benchmarks/results/profile.json`, `benchmarks/results/reconcilers.json`,
and `docs/architecture/profiling.md`.

Allocation budget in the steady-state update path: **zero** allocations for a
text/attribute update, one map and one index array for a list reconcile, one
owner per created row. Measured: ~40 bytes across a thousand re-evaluated
bindings, which is the sampling profiler's own floor rather than the
framework's.

---

## 4. Profiling method

- Chromium trace via Playwright CDP (`Profiler.start` / `takePreciseCoverage`),
  self-time attribution per function.
- Allocation sampling (`HeapProfiler.startSampling`) for the update loops; the
  test asserts an upper bound on bytes allocated per 1000 updates.
- `performance.measure` marks around mount / update / reconcile phases.
- GC pressure: `performance.memory` deltas plus explicit `--expose-gc` runs in
  the memory suite.
- Micro-benchmarks for the reactive core alone (no DOM) with `tinybench`, so
  graph regressions are visible independently of DOM noise.

Micro-optimisations are accepted only with a measured win. A change that makes
the code materially worse to read and produces no measurable improvement is
reverted; the benchmark diff is required in the PR.

---

## 5. Bundle size budget

Target: **<= 6 kB gzip** for the runtime a typical application loads.

| Module                         | Budget (gzip) |
| ------------------------------ | ------------: |
| reactive core                  |        1.6 kB |
| owner/context/lifecycle        |        0.6 kB |
| DOM parts + templates          |        1.6 kB |
| events (delegation)            |        0.4 kB |
| keyed list reconciler          |        0.9 kB |
| portals                        |        0.2 kB |
| custom element adapter         |        0.4 kB |
| **total, everything imported** |    **5.7 kB** |

Enforcement: `size-limit` in CI with per-entry budgets and a hard failure on
regression. Tree-shaking is verified by a test that bundles a counter app and
asserts that the list reconciler, portal and element adapter identifiers are
absent from the output. Zero production dependencies; the check is a CI
assertion on `package.json`, not a promise.

If the full surface cannot meet 6 kB without damaging semantics or speed, the
measured size is published with the reason, and the per-app number (which is
what users actually download) is published next to it.

---

## 6. Acceptance condition

"Faster than React" is a condition to be met, not a claim to be made. The
sequence when a scenario loses is: profile, identify the hotspot, fix, re-measure.
If React remains faster in a scenario after that loop, the result is published as
a loss with an explanation of the structural reason.

No result is ever hand-edited. Result files are written by the benchmark runner
and committed verbatim.
