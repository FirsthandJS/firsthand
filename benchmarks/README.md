# Benchmarks

Firsthand versus React, measured in the same browser session, on the same data,
with the same visible DOM.

```bash
npm run build      # the packages the benchmark imports
npm run bench      # builds the page, verifies, measures, writes results
node benchmarks/report.mjs --markdown
```

## What the runner enforces

The rules in [`../PERFORMANCE_PLAN.md`](../PERFORMANCE_PLAN.md) are implemented
in `run.mjs`, not just described:

1. **DOM equality first.** Before any timing, both implementations walk a nine
   step operation sequence and their `innerHTML` is compared after every step.
   A mismatch aborts the run. This has already caught one real bug in the Firsthand
   implementation, which is the point.
2. **Same session, interleaved.** Both frameworks run in one browser process,
   alternating per repetition, so CPU frequency drift and GC state hit both.
3. **Production builds, pinned versions.** React is bundled with
   `NODE_ENV=production`, and `react` and `react-dom` are pinned to exact
   versions in `package.json` so the number the README publishes cannot drift
   under it. Firsthand is compiled by the published compiler and imports the
   published entry points.
4. **Seeded data.** One deterministic generator, identical rows for both.
5. **Warmups discarded**, then ≥ 25 measured repetitions, reported as median,
   p95, mean, standard deviation, median absolute deviation, min and max.
6. **Full environment recorded** in every result file: OS, CPU, cores, RAM,
   browser, versions, git commit, build mode, timestamp.
7. **Aggregate honesty.** The headline is the geometric mean of the
   per-scenario ratios with a bootstrap 95 % interval, and the report refuses to
   state an advantage when the interval includes 1.0.

## What the numbers include

Each measurement runs the operation and then reads `document.body.offsetHeight`,
which forces style and layout. That is deliberate: stopping the clock at the
last JavaScript statement would credit a framework for work the browser has not
done yet.

It also means every number includes a framework-independent layout cost. For
large tables that cost is substantial, so these figures **understate** the
difference between the frameworks' own work rather than exaggerating it. A
profile that attributes time to JavaScript alone belongs in Phase 11 and is not
what this suite reports.

## Scenario coverage

What the suite measures, and — just as importantly — what it does not.

| Scenario                                    | Status                                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| initial mount 1k, 10k                       | measured (default run)                                                                                                                              |
| initial mount 100k                          | measured (`BENCH_SCALE=heavy`)                                                                                                                      |
| replace 1k, 10k, 100k                       | measured                                                                                                                                            |
| update every 10th row (1k, 10k, 100k)       | measured                                                                                                                                            |
| single row update                           | measured                                                                                                                                            |
| append, prepend                             | measured                                                                                                                                            |
| remove row                                  | measured                                                                                                                                            |
| swap rows (1k, 10k, 100k)                   | measured                                                                                                                                            |
| reverse list                                | measured                                                                                                                                            |
| clear list                                  | measured                                                                                                                                            |
| conditional branch switching                | measured                                                                                                                                            |
| deep component tree                         | measured (20 chains, depth 25)                                                                                                                      |
| context change: 1 / 100 / 10 000 consumers  | measured                                                                                                                                            |
| portal updates                              | measured                                                                                                                                            |
| rapid signal updates, batched and unbatched | measured                                                                                                                                            |
| input/change event latency                  | measured — a real `input` event on the field, timed to the DOM update                                                                               |
| memory after mount / updates / disposal     | measured — retained heap after a forced collection, both frameworks                                                                                 |
| startup / cold start                        | measured — fresh page, first mount of 1 000 rows, including parse and first-execution compilation                                                   |
| bundle size: raw, minified, gzip, brotli    | measured by `npm run build`                                                                                                                         |
| event dispatch cost, isolated               | measured by `npm run bench:micro` — delegated against direct listeners at depths 1, 5 and 20 (ADR-0012)                                             |
| custom element host cost, isolated          | measured by `npm run bench:micro` — hostless against `{ tag: true }` and `{ tag: true, shadow: true }` (ADR-0003)                                   |
| **JS execution time as a separate figure**  | **not measured** — every timing here deliberately includes the forced layout that follows. Splitting the two is what `npm run bench:profile` is for |

One row is still unmeasured, and it is listed rather than omitted — a benchmark
suite that quietly covers only the flattering cases is worse than no suite at
all.

## Adding a scenario

Add it to `SCENARIOS` in `run.mjs` and implement the operation in **both**
`app/firsthand.tsx` and `app/react.jsx`. If the two implementations stop producing
identical DOM, the equality phase will say so before any number is produced.

## Micro-benchmarks

Two questions are about Firsthand's own defaults rather than about React, so they
live apart from the comparison:

```bash
npm run bench:reconcilers   # which keyed reconciler to ship (ADR-0010)
npm run bench:micro         # element host cost, delegated vs direct events
npm run bench:profile       # what allocates, and where the self time goes
```

Each writes its own file under `results/`. None of them feeds the React
aggregate, because none of them is a comparison.

## Spotting a regression

```bash
node benchmarks/compare.mjs <new-result.json> --baseline benchmarks/results/latest.json
```

Prints every scenario whose ratio against React moved by more than 10 %, in
either direction, and marks the rows whose samples were too widely spread for
the movement to mean anything. It compares _ratios_, not raw times, so a
machine that is generally faster or slower than the last one does not look like
a change.

The benchmark workflow runs this and writes the table into the job summary. It
does not fail the build: shared CI hardware is too noisy for that, and a check
that cries wolf gets ignored. `--fail` is there for a machine where the numbers
are known to be stable.

## Results

Raw JSON lives in `results/`. `latest.json` is the most recent run; dated files
are kept. Nothing in `results/` is ever hand-edited — if a number looks wrong,
re-run and commit the new file.

## js-framework-benchmark

A reproducible integration with Stefan Krause's
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) is
tracked separately. The implementation there must be the same code as
`app/firsthand.tsx`: no benchmark-specific runtime, no hardcoded cases, no
different semantics. That constraint is what makes the independent numbers worth
anything.
