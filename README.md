# Firsthand

A small, fine-grained reactive UI framework for the web platform. Components are
functions that run **once**. State changes update the DOM nodes that read that
state — and nothing else.

```tsx
import { component, signal, computed } from '@firsthandjs/dom';

export const Counter = component((props: ReadonlyProps<{ initial: number }>) => {
  const count = signal(props.initial);
  const doubled = computed(() => count.value * 2);

  return (
    <button class={count.value > 10 ? 'high' : 'normal'} onClick={() => count.value++}>
      {count.value} × 2 = {doubled.value}
    </button>
  );
});
```

Clicking that button updates three things: the text node, the `class` attribute,
and nothing else. The component function does not run again. The `onClick`
handler is created once and always reads the current value.

<!-- headline:start -->
<!-- prettier-ignore-start -->
The whole runtime is **6.36 kB gzip** with no production dependencies. On the
render/update set it is **1.59×** faster than React 19.2.0, **1.34×** faster than Vue 3.5.43 and level with Solid 1.9.15
(geometric means of 27 scenarios, 95 % bootstrap intervals) — measured in the same browser session,
with the same data and the same rendered DOM verified before any timing, and
with every scenario published, including the 11 that Firsthand does not win.
<!-- prettier-ignore-end -->
<!-- headline:end -->

> **Status: pre-release.** The runtime, the compiler and the test suite are
> complete and at 100 % coverage. The raw data behind the numbers above, the
> caveats, and what is _not_ yet measured are in [Performance](#performance).

---

---

## Contents

- [Motivation](#motivation)
- [Design goals](#design-goals)
- [Non-goals](#non-goals)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Documentation](#documentation)
- [Performance](#performance)
- [Benchmark methodology](#benchmark-methodology)
- [Testing](#testing)
- [Browser support](#browser-support)
- [Limitations](#limitations)
- [Contributing](#contributing)

---

## Motivation

Every UI framework has to answer one question: when a piece of state changes,
what has to happen to the screen?

Firsthand answers it by remembering, at the moment the value is read, which DOM
parts read it. A write then goes straight to those parts:

```
state / context / prop
        ↓
dependency graph
        ↓
only the DOM nodes that actually read it
```

A component function is therefore setup code, not render code: it runs once per
instance, wires its reads to the nodes they produce, and is finished. From that
one decision the rest follows — there is no virtual DOM, no render snapshot, no
hook slot table, no dependency array, and no closure holding a value from an
earlier render.

Another well-travelled answer is to re-run the component and compare the result
with the previous one, which is what React does. It buys things this model does
not have: a component is a pure function of its props, time-slicing and
concurrent rendering become possible, and the mental model is uniform — there is
exactly one way anything updates. The costs are the bookkeeping that makes it
work: hook order, dependency arrays, memoisation, and values captured per
render.

Neither answer is the correct one. They are different trades, and this project
is a thorough version of the second trade — with the measurements published in
full so you can see what it costs and what it buys.

## Design goals

- **A component function runs once per instance.** `console.log` in a component
  body prints once, whatever happens to its state afterwards.
- **Updates are fine-grained.** A text interpolation is a text node write. An
  attribute is an attribute write.
- **Reads are live.** An event handler that reads `count.value` sees the current
  value, always. There is no framework-induced stale closure.
- **Props are real JavaScript values.** Same object reference in, same object
  reference out. Nothing is serialised, copied or frozen on your behalf.
- **Little JavaScript, few allocations, little DOM work.** The steady-state
  update path allocates nothing for a text or attribute change.
- **Web platform first.** Native events, native custom elements, native
  templates, constructable stylesheets.
- **No third-party production dependencies.** `@firsthandjs/dom` depends on
  `@firsthandjs/core` and nothing else.

## Non-goals

- Server-side rendering and hydration (not implemented; see
  [Limitations](#limitations)).
- A form library.
- Anything optional inside the core runtime. Routing lives in
  `@firsthandjs/router`, which an application that does not route never downloads;
  the numbers below are the runtime alone.
- Concurrent rendering and time slicing. They exist to keep a long render from
  blocking the main thread; here the unit of work is a single DOM part, so
  there is no long render to interrupt — and no way to interrupt one either
  ([ADR-0006](docs/adr/0006-synchronous-scheduling.md)).
- API compatibility with React, or porting its idioms. Where you need React
  components themselves, [`@firsthandjs/react`](docs/reference/react.md) runs
  them as they are.

## Installation

```bash
npm install @firsthandjs/dom
npm install --save-dev @firsthandjs/compiler
```

Vite:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { firsthand } from '@firsthandjs/compiler/vite';

export default defineConfig({
  plugins: [firsthand({ packageName: 'my-app' })],
});
```

That is the whole setup. The plugin is `enforce: 'pre'`, so it sees your TSX
before anything else does and leaves no JSX behind for the bundler to think
about — no `esbuild.jsx`, no `jsxImportSource`, nothing else. Verified against
Vite 7 and Vite 8, which produce byte-identical output.

The compiler is build-time only and never ships to the browser. Without it,
`@firsthandjs/jsx-runtime` provides a runtime JSX fallback with identical semantics
and no template hoisting — use it for experiments, not for production.

## Quick start

```tsx
import { component, render, signal } from '@firsthandjs/dom';

const App = component(() => {
  const name = signal('world');
  return (
    <div>
      <input value={name.value} onInput={(event) => (name.value = event.currentTarget.value)} />
      <p>Hello {name.value}</p>
    </div>
  );
});

// Mounts into document.body. Pass a container as the second argument to mount
// somewhere else — no element lookup and no cast needed either way.
render(() => <App />);
```

`render` returns a disposer. Calling it unsubscribes every effect, runs every
cleanup and removes exactly the nodes it inserted.

A component is also an ordinary callable value: `Counter({ initial: 1 })` does
exactly what `<Counter initial={1} />` compiles to. That is what makes it a
valid TSX element type with no `as` at the use site.

## Documentation

This file is the overview and the evidence. How to _use_ the framework is in
[`docs/`](docs/README.md).

**[The guide](docs/guide/)** — sixteen pages, in order:
[getting started](docs/guide/01-getting-started.md),
[reactivity](docs/guide/02-reactivity.md),
[components](docs/guide/03-components.md),
[rendering](docs/guide/04-rendering.md),
[context and lifecycle](docs/guide/05-context-and-lifecycle.md),
[events and forms](docs/guide/06-events-and-forms.md),
[styling](docs/guide/07-styling.md),
[routing](docs/guide/08-routing.md),
[data](docs/guide/09-data.md),
[web components](docs/guide/10-web-components.md),
[React interop](docs/guide/11-react-interop.md),
[internationalisation](docs/guide/12-internationalisation.md),
[testing](docs/guide/13-testing.md),
[devtools](docs/guide/14-devtools.md),
[performance](docs/guide/15-performance.md),
[building and deploying](docs/guide/16-building.md).

**[The reference](docs/reference/)** — one page per package, every export with
its signature:
[core](docs/reference/core.md),
[dom](docs/reference/dom.md),
[jsx-runtime](docs/reference/jsx-runtime.md),
[compiler](docs/reference/compiler.md),
[deep](docs/reference/deep.md),
[devtools](docs/reference/devtools.md),
[i18n](docs/reference/i18n.md),
[router](docs/reference/router.md),
[data](docs/reference/data.md),
[styled](docs/reference/styled.md),
[react](docs/reference/react.md),
[testing](docs/reference/testing.md).

**[The ADRs](docs/adr/)** — every decision with performance or semantic
consequences, including the ones measurement proved wrong. See also
[API conventions](docs/api-conventions.md),
[architecture](ARCHITECTURE.md) and the
[risk register](docs/architecture/risks.md).

**Runnable code** — [`examples/`](examples/) (one idea each, up to a
100 000-row table), [`integrations/interop/`](integrations/interop/) (MUI,
Shoelace and styled components on one page) and
[`integrations/storybook/`](integrations/storybook/).

## The packages

| Package                    | Size (gzip) | What it is                                      |
| -------------------------- | ----------- | ----------------------------------------------- |
| `@firsthandjs/core`        | 2.36 kB     | Signals, computeds, effects, context, owners    |
| `@firsthandjs/dom`         | 4.20 kB     | Components, rendering, elements, lists, portals |
| `@firsthandjs/jsx-runtime` | 0.59 kB     | JSX types, and the runtime fallback             |
| `@firsthandjs/deep`        | 0.72 kB     | Deep reactivity: every property is a signal     |
| `@firsthandjs/devtools`    | 6.29 kB     | **Experimental.** What updates what, and why    |
| `@firsthandjs/compiler`    | build only  | The TSX transform and the bundler plugin        |
| `@firsthandjs/router`      | 3.36 kB     | Routes, links, history, lazy routes             |
| `@firsthandjs/data`        | 3.84 kB     | Resources, actions, tags, the cache, fetch      |
| `@firsthandjs/data-axios`  | 0.58 kB     | Axios, as a client                              |
| `@firsthandjs/data-urql`   | 0.58 kB     | urql, as a client                               |
| `@firsthandjs/data-apollo` | 0.65 kB     | Apollo, as a client, and its observables        |
| `@firsthandjs/styled`      | 1.98 kB     | CSS-in-JS with custom properties                |
| `@firsthandjs/react`       | 0.66 kB     | React components inside Firsthand               |
| `@firsthandjs/i18n`        | 0.37 kB     | i18next and friends, made reactive              |
| `@firsthandjs/testing`     | dev only    | `mount`, `cleanup`, leak probes                 |

Every package is independent: installing `@firsthandjs/dom` pulls in the core and
nothing else.

## Performance

Measured, not asserted. Everything below comes from
[`benchmarks/results/latest.json`](benchmarks/results/latest.json), produced by
`npm run bench`, which verifies that every implementation renders the same DOM
before it times anything.

Three frameworks are measured against, for three different reasons. **React**
is the model most readers know. **Solid** is the closest neighbour — fine-grained
reactivity and a compiler, the same bet from a different direction — and is
therefore the hardest test of whether any of this is worth doing. **Vue** is the
other mainstream answer, and its compiler is good enough that a hand-written
`h()` version would have flattered us.

Every implementation is written the way its own documentation writes it, all
four render the same DOM — verified before anything is timed — and every
scenario is published, including the ones Firsthand loses. Where a confidence
interval includes 1.0, this page says _level_ rather than rounding it into a
win. The raw data is in the repository, so you can disagree with the
conclusions using the same numbers.

<!-- benchmark:start -->
<!-- prettier-ignore-start -->

### Firsthand vs React 19.2.0, Solid 1.9.15, Vue 3.5.43

Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz, 12 cores · Chromium via Playwright · Node v24.19.0 ·
25 measured repetitions after 5 warmups ·
production builds · interleaved in one browser session ·
DOM equality verified before timing · commit `4c9b0367` ·
2026-09-22

Each implementation is written the way its own documentation writes it: React
with memoised components and `flushSync`, Solid with a store and `<For>`,
compiled by `babel-preset-solid`, Vue with `shallowRef` and templates so that
its compiler emits the patch flags a real application gets. Medians, in
milliseconds; every scenario is here, including the ones Firsthand loses.

| Scenario | Firsthand | React | Solid | Vue | Fastest |
| --- | ---: | ---: | ---: | ---: | :--- |
| `mount-1k` | 34.50 ms | 39.50 ms | 35.50 ms | 37.20 ms | Firsthand 1.03× |
| `mount-10k` | 396.70 ms | 617.40 ms | 409.70 ms | 432.60 ms | Firsthand 1.03× |
| `replace-1k` | 39.70 ms | 52.60 ms | 39.60 ms | 47.20 ms | level |
| `replace-10k` | 436.20 ms | 768.60 ms | 441.80 ms | 518.60 ms | Firsthand 1.01× |
| `update-every-10th-1k` | 7.70 ms | 8.60 ms | 7.40 ms | 11.30 ms | Solid 1.04× |
| `update-every-10th-10k` | 83.40 ms | 94.60 ms | 83.40 ms | 121.60 ms | level |
| `select-row` ~ | 0.40 ms | 0.50 ms | 0.70 ms | 3.50 ms | Firsthand 1.25× |
| `append-1k-to-1k` | 38.30 ms | 44.10 ms | 42.60 ms | 48.20 ms | Firsthand 1.11× |
| `append-1k-to-10k` | 75.20 ms | 76.70 ms | 85.80 ms | 110.90 ms | Firsthand 1.02× |
| `remove-row` | 2.50 ms | 3.10 ms | 3.80 ms | 5.80 ms | Firsthand 1.24× |
| `swap-rows-1k` | 2.60 ms | 33.60 ms | 4.30 ms | 6.00 ms | Firsthand 1.65× |
| `swap-rows-10k` | 34.10 ms | 575.20 ms | 53.00 ms | 66.00 ms | Firsthand 1.55× |
| `reverse-1k` | 30.80 ms | 33.80 ms | 32.50 ms | 34.30 ms | Firsthand 1.06× |
| `reverse-10k` | 367.00 ms | 578.90 ms | 370.60 ms | 405.30 ms | Firsthand 1.01× |
| `clear-1k` | 5.00 ms | 6.80 ms | 3.50 ms | 4.10 ms | Solid 1.17× |
| `clear-10k` | 52.10 ms | 75.20 ms | 36.40 ms | 43.10 ms | Solid 1.18× |
| `prepend-1k-to-10k` | 68.40 ms | 88.10 ms | 83.90 ms | 111.20 ms | Firsthand 1.23× |
| `update-single-row-10k` | 31.20 ms | 35.80 ms | 27.50 ms | 65.70 ms | Solid 1.13× |
| `conditional-branch-switch-1k` | 14.10 ms | 17.80 ms | 13.20 ms | 12.70 ms | Vue 1.04× |
| `deep-tree-mount` | 1.00 ms | 1.40 ms | 1.00 ms | 1.10 ms | level |
| `context-change-1` ~ | 0.10 ms | 0.20 ms | 0.10 ms | 0.10 ms | level |
| `context-change-100` | 1.10 ms | 1.20 ms | 1.20 ms | 1.30 ms | Firsthand 1.09× |
| `context-change-10k` | 119.60 ms | 133.40 ms | 115.10 ms | 143.20 ms | Solid 1.04× |
| `rapid-updates-1k-unbatched` ~ | 0.60 ms | 2.40 ms | 0.70 ms | 2.50 ms | Firsthand 1.17× |
| `rapid-updates-1k-batched` ~ | 0.10 ms | 0.30 ms | 0.20 ms | 0.10 ms | level |
| `portal-update` ~ | 0.20 ms | 0.10 ms | 0.10 ms | 0.10 ms | level |
| `input-event-latency` ~ | 0.20 ms | 0.20 ms | 0.10 ms | 0.10 ms | level |

| Against | Geometric mean of the per-scenario ratios | 95 % bootstrap CI | Claimable |
| --- | ---: | :---: | :--- |
| React 19.2.0 | **1.589×** | 1.240–2.164 | yes — the interval excludes 1.0 |
| Solid 1.9.15 | **1.040×** | 0.925–1.162 | **no** — the interval includes 1.0 |
| Vue 3.5.43 | **1.336×** | 1.087–1.647 | yes — the interval excludes 1.0 |

A ratio above 1.0 means Firsthand is faster by that factor. Where the interval
includes 1.0 the two are level as far as this suite can tell, and this project
publishes that rather than rounding it into a claim. Firsthand was the fastest
of the 4, or level with whoever was, in 16 of 27 scenarios in this run.

Rows marked `~` had a median absolute deviation above 10 % of the median on
at least one side — usually a garbage collection landing inside some of the
measured windows. Their medians are not reliable point estimates, and the
ratio should not be read as a firm result.


### Memory and cold start

Retained heap relative to an empty page, each reading taken after a forced
collection, so it is memory that is actually held rather than memory that
has not been collected yet. Cold start is a fresh page and the first mount
of 1 000 rows, so it includes parsing and first-execution compilation.

| | after mounting 1 000 rows | after 100 update cycles | after disposal | cold start |
| --- | ---: | ---: | ---: | ---: |
| **Firsthand** | 1.78 MB | 2.00 MB | 0.31 MB | 57.10 ms |
| React | 2.21 MB | 2.87 MB | 0.67 MB | 71.50 ms |
| Solid | 1.85 MB | 2.14 MB | 0.97 MB | 58.20 ms |
| Vue | 2.21 MB | 2.28 MB | 0.82 MB | 75.20 ms |

The third column is the one to read: it is what the page still holds once
the tree has been torn down.

### Mass data: 100 000 rows

A separate, slower run (`BENCH_SCALE=heavy npm run bench`), with
7 repetitions after 1 warmups. Kept out of the aggregate
above rather than folded into it: averaging measurements taken with
different sample sizes would quietly weaken the confidence interval.

| Scenario | Firsthand | React | Solid | Vue | Fastest |
| --- | ---: | ---: | ---: | ---: | :--- |
| `mount-100k` | 3730.10 ms | 28075.60 ms | 4134.90 ms | 4619.30 ms | Firsthand 1.11× |
| `clear-100k` | 488.50 ms | 1590.10 ms | 376.50 ms | 429.60 ms | Solid 1.14× |
| `update-every-10th-100k` | 848.50 ms | 2028.40 ms | 804.60 ms | 1237.50 ms | Solid 1.05× |

### Bundle size

| Module | minified | gzip | brotli |
| --- | ---: | ---: | ---: |
| `@firsthandjs/core` | 6.50 kB | **2.36 kB** | 2.14 kB |
| `@firsthandjs/dom` | 11.79 kB | **4.66 kB** | 4.17 kB |
| `@firsthandjs/dom/internal` | 11.37 kB | **4.67 kB** | 4.18 kB |
| `@firsthandjs/jsx-runtime` | 1.15 kB | **0.59 kB** | 0.50 kB |
| full runtime (core + dom, everything imported) | 17.24 kB | **6.36 kB** | 5.74 kB |


Optional packages, downloaded only by an application that imports them:

| Module | minified | gzip | brotli |
| --- | ---: | ---: | ---: |
| `@firsthandjs/deep` | 1.58 kB | **0.72 kB** | 0.66 kB |
| `@firsthandjs/devtools` | 16.90 kB | **6.29 kB** | 5.52 kB |
| `@firsthandjs/i18n` | 0.63 kB | **0.37 kB** | 0.32 kB |
| `@firsthandjs/router` | 8.36 kB | **3.36 kB** | 3.06 kB |
| `@firsthandjs/data` | 9.96 kB | **4.12 kB** | 3.75 kB |
| `@firsthandjs/data (.gql loader path, parser tree-shaken)` | 7.04 kB | **2.89 kB** | 2.65 kB |
| `@firsthandjs/data-axios` | 1.22 kB | **0.59 kB** | 0.51 kB |
| `@firsthandjs/data-urql` | 1.09 kB | **0.59 kB** | 0.51 kB |
| `@firsthandjs/data-apollo` | 1.34 kB | **0.66 kB** | 0.58 kB |
| `@firsthandjs/styled` | 4.18 kB | **1.98 kB** | 1.79 kB |
| `@firsthandjs/react` | 1.19 kB | **0.66 kB** | 0.58 kB |
| `@firsthandjs/react/auto` | 1.20 kB | **0.66 kB** | 0.58 kB |

No third-party production dependencies, asserted in CI: `@firsthandjs/dom` pulls
in `@firsthandjs/core` and nothing else, and the optional packages depend on
those two and nothing else. At build time there is exactly one third-party
toolchain: the compiler uses Babel to parse TSX. The full-runtime row is
measured with *everything* imported; an application that uses no portals, no
keyed lists and no element hosts links less than that.

<!-- prettier-ignore-end -->
<!-- benchmark:end -->

### What else is verified

| Design property                                           | Verified by                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Component functions run once per instance                 | unit tests + browser tests                                                            |
| Only the reading parts update                             | unit tests + browser tests                                                            |
| Static markup is cloned from a `<template>`               | compiler tests + executed compiled output                                             |
| Keyed rows keep their DOM nodes across reorders           | unit tests + browser tests                                                            |
| A keyed list inside a conditional keeps its rows          | regression test (this cost 12× before it was found)                                   |
| Mounting a list registers zero event listeners            | unit tests (delegation)                                                               |
| Disposal leaves zero graph edges and zero DOM             | memory tests, including `WeakRef` probes under forced GC                              |
| Bundle size ≤ 6 kB gzip                                   | measured                                                                              |
| Faster than React on the render/update set                | measured                                                                              |
| Steady-state updates allocate nothing                     | measured: 36 B for 1 000 re-evaluated bindings, 0.07 B per signal write               |
| A custom element host is worth avoiding by default        | measured: 1.51× mount time and twice the DOM nodes (ADR-0003)                         |
| Delegated events beat direct listeners                    | measured: cheaper to register and faster to dispatch at depths 1, 5 and 20 (ADR-0012) |
| The shipped list reconciler is the best of the candidates | measured: three candidates compared, LIS chosen (ADR-0010)                            |

### The suite found real bugs, which is the point

The DOM-equality phase and the scenario set together caught three defects
before any number was published: a benchmark component reading the wrong prop
shape, an anchor comment that made the two implementations render different
markup, and — the expensive one — a keyed list inside a conditional that lost
its row identity, which cost 12× on a single-row update at 10 000 rows. All
three are described in
[ADR-0010](docs/adr/0010-list-reconciliation-decided-by-measurement.md).

A benchmark that cannot fail is not evidence.

## Benchmark methodology

The rules, in full, are in [`PERFORMANCE_PLAN.md`](PERFORMANCE_PLAN.md). The
short version:

- Firsthand and React are measured **in the same browser session**, interleaved,
  with pinned React versions recorded in every result file.
- Both implementations must produce **byte-identical DOM** for the same data; a
  mismatch fails the run before any timing happens.
- Production builds, the same seeded dataset, warmup runs discarded, ≥ 25
  measured repetitions, reported as median, p95 and a robust spread.
- Raw results are committed as JSON with OS, CPU, RAM, browser, versions, git
  commit, build mode and timestamp.
- **No benchmark-only code paths.** The benchmark imports the published entry
  points and is compiled by the published compiler; the compiler/runtime
  protocol is public, so there is nothing a benchmark can use that an
  application cannot.
- Every scenario is published, including losses. An aggregate claim is only made
  when a bootstrap confidence interval on the geometric mean excludes 1.0.
- Anything measured has a command that reproduces it: `npm run bench`,
  `bench:micro`, `bench:profile`, `bench:reconcilers`, `bench:ic`, and
  `BENCH_SCALE=heavy npm run bench` for the 100 000-row set. Re-running them
  moves the digits — machines and browsers are not deterministic — so the
  numbers here are the latest run, not the best one seen.

## Testing

Firsthand renders real DOM synchronously, so tests need no wrapper object and no
`await` after a state change:

```tsx
import { cleanup, mount } from '@firsthandjs/testing';

afterEach(cleanup);

it('counts up', () => {
  const view = mount(() => <Counter initial={0} />);
  view.get<HTMLButtonElement>('button').click();
  expect(view.text()).toBe('1');
});
```

`@firsthandjs/testing` is six exports: `mount`, `cleanup`, `autoCleanup`,
`withRoot` for reactivity with no DOM, `subscriberCount` for leak assertions,
and `tick` for asynchronous application code.

It works with **Vitest** (node, happy-dom, jsdom or browser mode) and
**Playwright** without an adapter — Playwright drives a Firsthand page like any
other page.

<!-- tests:start -->
<!-- prettier-ignore-start -->
This repository is the demonstration: 937 tests under Vitest and 90
under Playwright across Chromium, Firefox and WebKit, covering the framework,
the router, the query cache and all seven examples.
<!-- prettier-ignore-end -->
<!-- tests:end -->

**Storybook** works through the stock HTML renderer plus fifteen lines of glue
— there is no `@firsthandjs/storybook` and there does not need to be one, because
Firsthand components build DOM and that is what `@storybook/html-vite` asks a
story for. [`integrations/storybook/`](integrations/storybook/) is a working
one, kept outside the workspace so that nobody has to install Storybook to work
on the framework; `npm test` there builds it and drives four stories — a
counter, args as props, the router on a memory history and the data layer
mutating and invalidating — in a real browser.

Full guide, including which Vitest environment to use and how to assert that a
DOM node survived an update: [`docs/guide/13-testing.md`](docs/guide/13-testing.md).

## Browser support

Modern evergreen browsers: Chromium, Firefox and WebKit. Firsthand relies on
`<template>`, `composedPath()`, custom elements, ES2022 and ES modules. No
polyfills are shipped and none are planned.

Cross-engine testing runs through Playwright, and the full suite — 29 tests
covering the framework, the router, the data layer and the seven example
applications, including the 100 000-row table — passes in all three engines. The performance numbers in this
README are Chromium only.

## Limitations

Stated plainly, because a README that hides them wastes your time:

- **No SSR or hydration.** Firsthand builds DOM in the browser. Server rendering is
  a design problem for a later version, not a missing switch.
- **Benchmarked on Chromium only.** Firefox and WebKit run the correctness
  suite — all of it, including 100 000 rows — but not the benchmark.
- **`.value` access sites have not been checked for inline-cache state.** One
  node shape is used for signals, computeds and effects so that they stay
  monomorphic, but nothing has measured whether they do (R2 in the risk
  register — the one risk still open).
- **Namespaced element names** (`<svg:circle>`) are rejected by the compiler;
  write the element without a namespace.
- **The runtime JSX fallback does not hoist templates** and does not give you
  reactive props from JSX spread. Use the compiler for production.
- **Delegated events** run during the document's dispatch, so a native listener
  attached between your element and the document sees the event first.
  `onClick:native` is the escape hatch.
- **Light DOM by default** means no style isolation by default. That is a
  deliberate trade ([ADR-0007](docs/adr/0007-light-dom-default.md)).
- **Adjacent dynamic expressions get an anchor.** `{a}{b}` puts an empty
  comment node between them, because the first part needs something to insert
  before. Write `{`${a}${b}`}` if a single text node matters to you.
- **No devtools extension** yet.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The two rules worth reading before you
start: coverage stays at 100 % without ignore comments, and performance claims
need committed measurements.

Architecture: [`ARCHITECTURE.md`](ARCHITECTURE.md) ·
API design: [`API_DESIGN.md`](API_DESIGN.md) ·
Decisions: [`docs/adr/`](docs/adr/) ·
Risks: [`docs/architecture/risks.md`](docs/architecture/risks.md)

## License

[MIT](LICENSE)
