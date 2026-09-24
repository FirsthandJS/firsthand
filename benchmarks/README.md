# Benchmarks

Firsthand versus **React, Solid and Vue**, measured in the same browser session,
on the same data, with the same visible DOM.

```bash
npm run build                        # the packages the benchmark imports
npm --prefix benchmarks/frameworks i # React's rivals, with their own toolchains
npm run bench                        # builds the page, verifies, measures, writes results
node benchmarks/report.mjs --markdown
```

## Who is measured, and how they are written

|           | written as                                   | compiled by                           |
| --------- | -------------------------------------------- | ------------------------------------- |
| Firsthand | components, signals, keyed lists             | the published `@firsthandjs/compiler` |
| React     | memoised components, `useState`, `flushSync` | esbuild, `NODE_ENV=production`        |
| Solid     | `createStore`, `<For>`, `<Show>`             | `babel-preset-solid`                  |
| Vue       | `shallowRef`, `v-for` with `:key`, templates | Vue's own template compiler           |

Each is written the way its own documentation writes it, because a comparison
against a strawman is worth nothing. Two details that matter:

- **Solid is compiled.** Its JSX transform is not an optional extra, and
  measuring its hyperscript runtime would measure a Solid nobody ships.
- **Vue uses templates, not hand-written `h()`.** Vue's template compiler emits
  patch flags that a hand-written render function does not get, so `h()` would
  understate it.

Solid and Vue live in [`frameworks/`](frameworks/package.json) with their own
install. `babel-preset-solid` wants Babel 7 and this repository is built on
Babel 8; giving them their own `node_modules` means neither toolchain has to be
bent to fit the other, and the exact versions the published numbers came from
are pinned there.

## What the runner enforces

The rules in [`../PERFORMANCE_PLAN.md`](../PERFORMANCE_PLAN.md) are implemented
in `run.mjs`, not just described:

1. **DOM equality first.** Before any timing, every implementation walks the
   same operation sequences and its `innerHTML` is compared against Firsthand's
   after every step. A mismatch aborts the run. This has already caught one real
   bug in the Firsthand implementation and one in the Solid one, which is the
   point.
2. **Same session, interleaved.** All four run in one browser process,
   alternating per repetition, so CPU frequency drift and GC state hit them
   equally.
3. **Production builds, pinned versions.** Every framework is bundled for
   production and pinned to an exact version, so the numbers the README
   publishes cannot drift under it. Firsthand is compiled by the published
   compiler and imports the published entry points.
4. **Seeded data.** One deterministic generator, identical rows for all four.
5. **Warmups discarded**, then ≥ 25 measured repetitions, reported as median,
   p95, mean, standard deviation, median absolute deviation, min and max.
6. **Full environment recorded** in every result file: OS, CPU, cores, RAM,
   browser, versions, git commit, build mode, timestamp.
7. **Aggregate honesty.** The headline is the geometric mean of the
   per-scenario ratios with a bootstrap 95 % interval, per rival, and neither
   the runner nor the report will state an advantage when the interval includes
   1.0 — which, against one of these three, it does.

## The one thing that is normalised

Vue writes `class=""` where the others leave the attribute off: a class binding
that evaluates to nothing is normalised to an empty string before it is
patched. The comparison treats the two as equal, because they are the same
element with the same classes and the same layout, and writing the benchmark's
markup around one framework's attribute handling would be worse.

Nothing else is normalised. A comment node, a text node, an attribute value or
an element out of place still fails the run.

## What "one update" means to each of them

A measurement is only fair if every framework is asked for the same thing: the
DOM, changed, before the clock stops.

|           | how the operation is made to reach the DOM                |
| --------- | --------------------------------------------------------- |
| Firsthand | synchronous by design (ADR-0006); nothing to ask for      |
| React     | `flushSync` around every operation                        |
| Solid     | synchronous; `batch` where the scenario asks for batching |
| Vue       | `await nextTick()`, because its scheduler is a microtask  |

The unbatched scenario is the one to read carefully. It asks for _n_ updates
that each reach the DOM, which Firsthand and Solid do synchronously, React does
with _n_ calls to `flushSync`, and Vue can only do with _n_ microtask turns —
Vue has no synchronous flush at all. That is a real difference in what the
frameworks offer, not a trick of the harness, but it is worth knowing before
reading that row as a verdict on Vue's speed.

## Why the measurement is awaited

Vue's scheduler flushes on a microtask, which cannot be drained from inside a
synchronous function. A measurement that stopped at the last statement would
stop before Vue's DOM had changed and would credit it for work it had not done.
So the harness awaits every operation — which costs all four the same one
microtask hop, rather than charging it to the one that needs it.

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

Add it to `SCENARIOS` in `run.mjs` and implement the operation in **all four**
of `app/firsthand.tsx`, `app/react.jsx`, `app/solid.jsx` and `app/vue.js`. If any
of them stops producing the same DOM, the equality phase will say so before a
number is produced.

## Server rendering and hydration

The other half of the job, and its own two runners:

```bash
npm run bench:ssr       # rendering to markup, in Node
npm run bench:hydrate   # taking that markup over, in Chromium
```

They keep the rules above, applied to a server:

- **The output is compared before anything is timed.** Each framework's markup
  is stripped of the bookkeeping it needs for its own hydration — comments,
  `data-hk`, `data-v-…` — and what is left has to be identical: same elements,
  same classes, same order, same text. A framework that rendered less cannot
  look faster.
- **Interleaved in one process**, warmed up, medians over repetitions.
- **Production builds on every side.** This is worth stating because getting it
  wrong was worth a factor of three here: the first hydration numbers were a
  _development_ build of Firsthand against production rivals, and
  `devHydrationMismatch` alone was 13 % of the run. Both runners apply the
  published build's `dev.js` → `dev.prod.ts` swap and the same pure-call
  annotations.
- **Hydratable output on both sides.** Solid is compiled with
  `hydratable: true` and Firsthand emits its region markers, because markup a
  browser cannot take over is not the thing this is about.
- **Cross-origin isolated**, for the hydration run, so the clock reads in 5 µs
  steps rather than Chromium's clamped 100 µs.

React is measured for rendering and not for hydration: `hydrateRoot` schedules
its work rather than doing it, so a number taken the same way would be the time
to _start_ hydrating. Leaving it out is more honest than reporting it as
something it is not.

Results go to `results/ssr.json` and `results/hydration.json`, and into the
README from there.

## Micro-benchmarks

Some questions are about Firsthand's own defaults rather than about anyone
else, so they live apart from the comparison:

```bash
npm run bench:reconcilers   # which keyed reconciler to ship (ADR-0010)
npm run bench:micro         # element host cost, delegated vs direct events
npm run bench:profile       # what allocates, and where the self time goes
npm run bench:deep          # an array in a signal against `deepSignal`
npm run bench:latency       # where the two sub-millisecond scenarios go
npm run bench:ic            # whether `.value` goes megamorphic (R2)
```

`bench:deep` is the one that answers a question about the comparison itself.
`update-single-row-10k` is the scenario Firsthand loses, and the reason looked
structural: the table keeps its rows in a `signal<Row[]>`, so changing one
label is a new array of ten thousand, while Solid's implementation keeps its
rows in a store and changes one nested signal. It measures both ways, with the
clock stopped before _and_ after the browser is made to lay the page out
again:

| 10 000 rows, one label changed |   mount |  update | update, without layout |
| ------------------------------ | ------: | ------: | ---------------------: |
| `signal<Row[]>`                | 26.6 ms | 33.7 ms |               1.850 ms |
| `deepSignal`                   | 43.6 ms | 32.3 ms |           **0.008 ms** |

Solid uses a fine-grained store here; Firsthand's equivalent data-model path
is `deepSignal`: **0.008 ms of framework work instead of 1.850 ms, against a
higher mount cost.**

And the scenario is **94 % layout**. The framework's share of it is under two
milliseconds either way, and no list API can win back what the browser spends
laying out ten thousand rows.

**The main suite is not changed because of this, and should not be.** The rule
there is that each framework is written the way its own documentation writes
it, which makes Solid with a store legitimate and Firsthand with a
`signal<Row[]>` legitimate. What would not be legitimate is switching to
`deepSignal` for `update-single-row-10k` and keeping the cheaper plain signal
for `mount-10k` — that hides the 1.6× mount cost and picks the best data model
per scenario. So this measurement lives here, beside the suite, and feeds no
aggregate.

`bench:latency` answers the other question the comparison raises.
`portal-update` and `input-event-latency` are the two rows Firsthand is
furthest behind on, and in a geometric mean every scenario weighs the same —
so a 0.135 ms miss there moves the aggregate more than a 2.5 ms miss on a
ten-thousand-row update does. Before optimising either, it is worth knowing
what is being paid for. Five variants, Firsthand only, each timed twice: once
for the framework's own work and once with the browser made to lay the page
out again.

| 50 operations, median per operation  | framework | with layout |
| ------------------------------------ | --------: | ----------: |
| text update, in place                |   0.50 µs |     12.1 µs |
| text update, through a portal        |   0.50 µs |     12.1 µs |
| input event to text, delegated       |   5.00 µs |     41.4 µs |
| input event to text, direct listener |   5.70 µs |     41.7 µs |
| input event, handler does nothing    |   3.80 µs |     30.2 µs |

Both hypotheses it was built to test are refuted, and that is the result:

- **A portal costs nothing.** Writing through one and writing in place are the
  same number to two decimal places, with layout and without. Whatever
  `portal-update` measures, it is not the portal.
- **Delegation is not the slower path.** It was suspected because a delegated
  listener rebuilds `composedPath` and redefines `currentTarget`; measured, it
  is 0.7 µs _faster_ than a direct listener, and indistinguishable once the
  page is laid out. There is no policy to add — no "high-cardinality events
  delegated, latency-sensitive form events direct" — because there is nothing
  to choose between.

What the last row says is where the time actually is: an event whose handler
does nothing still costs 3.8 µs of the 5.0. The dispatch, not the update, is
most of it, and 30.2 µs of the 41.4 is the browser laying the page out after
a keystroke. So no API changed and no compiler path was rewritten on the
strength of these two rows, which is what the measurement was for.

Each writes its own file under `results/`. None of them feeds an aggregate,
because none of them is a comparison.

## Spotting a regression

```bash
node benchmarks/compare.mjs <new-result.json> --baseline benchmarks/results/latest.json
```

Prints every scenario whose ratio against React moved by more than 10 %, in
either direction — React is the reference there because it is the one with the
longest run of committed baselines — and marks the rows whose samples were too widely spread for
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

`latest.json` records the version it measured, and `npm run check` refuses a
build where that is not the version in the workspace. `check:readme` proves the
README transcribes these files correctly; it cannot prove they are about this
code, and for a while they were not — the headline comparison against React,
Solid and Vue was measured on 0.9.0 and published from 0.11.1, faithfully
transcribed and two releases out of date. Re-record with `npm run bench`, then
`npm run bench:readme`.

A version rather than a timestamp or a file hash, deliberately: a benchmark
measures a machine as much as a tree, and a rule demanding a re-run for every
touched source file is a rule people turn off. A version is the unit the claim
is made in.

## js-framework-benchmark

A reproducible integration with Stefan Krause's
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) is
tracked separately. The implementation there must be the same code as
`app/firsthand.tsx`: no benchmark-specific runtime, no hardcoded cases, no
different semantics. That constraint is what makes the independent numbers worth
anything.
