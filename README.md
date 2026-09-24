# Firsthand

### ▶ [Try it in the playground](https://firsthandjs.github.io/firsthandjs-playground/) — no install, runs in your browser

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
The whole runtime is **7.49 kB gzip** with no production dependencies. On the
render/update set it is **1.67×** faster than React 19.2.0, **1.13×** faster than Solid 1.9.15 and **1.48×** faster than Vue 3.5.43
(geometric means of 27 scenarios, 95 % bootstrap intervals) — measured in the same browser session,
with the same data and the same rendered DOM verified before any timing, and
with every scenario published, including the 8 that Firsthand does not win.
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

**[The guide](docs/guide/)** — seventeen pages, in order:
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
[building and deploying](docs/guide/16-building.md),
[server rendering](docs/guide/17-server-rendering.md).

**[The reference](docs/reference/)** — one page per package, every export with
its signature:
[core](docs/reference/core.md),
[dom](docs/reference/dom.md),
[server](docs/reference/server.md),
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
DOM equality verified before timing · commit `23344f6c` ·
2026-09-22

Each implementation is written the way its own documentation writes it: React
with memoised components and `flushSync`, Solid with a store and `<For>`,
compiled by `babel-preset-solid`, Vue with `shallowRef` and templates so that
its compiler emits the patch flags a real application gets. Medians, in
milliseconds; every scenario is here, including the ones Firsthand loses.

| Scenario | Firsthand | React | Solid | Vue | Fastest |
| --- | ---: | ---: | ---: | ---: | :--- |
| `mount-1k` | 35.42 ms | 42.81 ms | 36.66 ms | 41.98 ms | Firsthand 1.04× |
| `mount-10k` ~ | 430.00 ms | 710.58 ms | 425.42 ms | 459.46 ms | Solid 1.01× |
| `replace-1k` | 42.00 ms | 56.89 ms | 44.07 ms | 48.35 ms | Firsthand 1.05× |
| `replace-10k` ~ | 508.62 ms | 908.21 ms | 486.87 ms | 530.36 ms | Solid 1.04× |
| `update-every-10th-1k` ~ | 8.87 ms | 9.22 ms | 7.82 ms | 11.79 ms | Solid 1.13× |
| `update-every-10th-10k` ~ | 92.36 ms | 98.41 ms | 90.69 ms | 132.67 ms | Solid 1.02× |
| `select-row` | 0.420 ms | 0.530 ms | 0.725 ms | 3.43 ms | Firsthand 1.26× |
| `append-1k-to-1k` ~ | 41.56 ms | 48.50 ms | 43.41 ms | 50.76 ms | Firsthand 1.04× |
| `append-1k-to-10k` ~ | 77.84 ms | 85.33 ms | 96.16 ms | 118.47 ms | Firsthand 1.10× |
| `remove-row` ~ | 2.78 ms | 3.49 ms | 4.20 ms | 6.09 ms | Firsthand 1.26× |
| `swap-rows-1k` ~ | 2.95 ms | 36.16 ms | 4.64 ms | 6.33 ms | Firsthand 1.57× |
| `swap-rows-10k` ~ | 38.41 ms | 628.59 ms | 57.37 ms | 69.71 ms | Firsthand 1.49× |
| `reverse-1k` ~ | 33.49 ms | 37.29 ms | 36.20 ms | 37.50 ms | Firsthand 1.08× |
| `reverse-10k` ~ | 377.94 ms | 639.41 ms | 397.77 ms | 503.20 ms | Firsthand 1.05× |
| `clear-1k` | 3.69 ms | 8.16 ms | 3.92 ms | 4.47 ms | Firsthand 1.06× |
| `clear-10k` | 40.83 ms | 84.83 ms | 37.69 ms | 44.38 ms | Solid 1.08× |
| `prepend-1k-to-10k` ~ | 77.35 ms | 96.17 ms | 95.56 ms | 120.69 ms | Firsthand 1.24× |
| `update-single-row-10k` ~ | 33.40 ms | 36.11 ms | 28.66 ms | 73.97 ms | Solid 1.17× |
| `conditional-branch-switch-1k` | 15.59 ms | 20.03 ms | 14.13 ms | 13.91 ms | Vue 1.02× |
| `deep-tree-mount` | 1.12 ms | 1.53 ms | 1.11 ms | 1.22 ms | Solid 1.009× |
| `context-change-1` ~ | 0.140 ms | 0.155 ms | 0.145 ms | 0.150 ms | Firsthand 1.04× |
| `context-change-100` | 1.25 ms | 1.36 ms | 1.27 ms | 1.50 ms | Firsthand 1.02× |
| `context-change-10k` | 127.20 ms | 142.18 ms | 134.03 ms | 157.21 ms | Firsthand 1.05× |
| `rapid-updates-1k-unbatched` ~ | 0.550 ms | 2.66 ms | 0.905 ms | 2.67 ms | Firsthand 1.65× |
| `rapid-updates-1k-batched` ~ | 0.145 ms | 0.255 ms | 0.190 ms | 0.180 ms | Firsthand 1.24× |
| `portal-update` ~ | 0.090 ms | 0.105 ms | 0.100 ms | 0.120 ms | Firsthand 1.11× |
| `input-event-latency` ~ | 0.155 ms | 0.265 ms | 0.195 ms | 0.210 ms | Firsthand 1.26× |

| Against | Geometric mean of the per-scenario ratios | 95 % bootstrap CI | Claimable |
| --- | ---: | :---: | :--- |
| React 19.2.0 | **1.669×** | 1.331–2.246 | yes — the interval excludes 1.0 |
| Solid 1.9.15 | **1.127×** | 1.054–1.210 | yes — the interval excludes 1.0 |
| Vue 3.5.43 | **1.485×** | 1.262–1.773 | yes — the interval excludes 1.0 |

**Fastest** names the winner of the row and its margin over the next one. The
page is served cross-origin isolated, so `performance.now()` reads in 5 µs
steps rather than Chromium's default 100 µs — without that the sub-millisecond
rows would all report the same number and there would be nothing to compare.

A ratio above 1.0 in the table below means Firsthand is faster by that factor.
Where the interval includes 1.0 the two are level as far as this suite can
tell, and this project publishes that rather than rounding it into a claim.
Firsthand was the fastest of the 4, or tied with whoever was, in 19 of 27
scenarios in this run.

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
| **Firsthand** | 1.88 MB | 2.11 MB | 0.31 MB | 64.88 ms |
| React | 2.21 MB | 2.87 MB | 0.67 MB | 80.90 ms |
| Solid | 1.85 MB | 2.14 MB | 0.97 MB | 68.25 ms |
| Vue | 2.21 MB | 2.28 MB | 0.83 MB | 85.47 ms |

The third column is the one to read: it is what the page still holds once
the tree has been torn down.

### Server rendering and hydration

Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz, 12 cores · Node v24.19.0 ·
1 000 rows · 9 measured repetitions after 3 warmups ·
production builds on every side · the markup compared before anything is
timed · commit `fff7582a` · 2026-09-22

Reproduce with `node benchmarks/ssr/run.mjs` and
`node benchmarks/ssr/hydrate.mjs`.

| | Firsthand | Solid | Vue | React | Fastest |
| --- | ---: | ---: | ---: | ---: | :--- |
| render to markup | 0.171 ms | 0.205 ms | 15.02 ms | 199.67 ms | Firsthand |
| markup size | 222 802 B | 238 694 B | 222 802 B | 222 802 B | Firsthand, Vue and React |
| hydrate | 4.12 ms | 4.62 ms | 10.48 ms | — | Firsthand |

React's `hydrateRoot` schedules its work rather than doing it, so a number
taken the same way would be the time to *start* hydrating. It is left out
rather than reported as something it is not.

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
| `@firsthandjs/core` | 7.65 kB | **2.81 kB** | 2.55 kB |
| `@firsthandjs/dom` | 13.61 kB | **5.37 kB** | 4.83 kB |
| `@firsthandjs/dom/internal` | 14.21 kB | **5.69 kB** | 5.12 kB |
| `@firsthandjs/jsx-runtime` | 1.15 kB | **0.59 kB** | 0.50 kB |
| full runtime (core + dom, everything imported) | 20.25 kB | **7.49 kB** | 6.77 kB |


Optional packages, downloaded only by an application that imports them:

| Module | minified | gzip | brotli |
| --- | ---: | ---: | ---: |
| `@firsthandjs/dom/hydrate` | 6.19 kB | **2.58 kB** | 2.38 kB |
| `@firsthandjs/deep` | 1.58 kB | **0.72 kB** | 0.66 kB |
| `@firsthandjs/devtools` | 17.44 kB | **6.40 kB** | 5.62 kB |
| `@firsthandjs/i18n` | 0.63 kB | **0.37 kB** | 0.32 kB |
| `@firsthandjs/router` | 8.36 kB | **3.36 kB** | 3.06 kB |
| `@firsthandjs/data` | 13.65 kB | **5.25 kB** | 4.80 kB |
| `@firsthandjs/data (.gql loader path, parser tree-shaken)` | 9.56 kB | **3.58 kB** | 3.29 kB |
| `@firsthandjs/data-axios` | 1.31 kB | **0.62 kB** | 0.55 kB |
| `@firsthandjs/data-urql` | 1.20 kB | **0.63 kB** | 0.55 kB |
| `@firsthandjs/data-apollo` | 1.61 kB | **0.75 kB** | 0.68 kB |
| `@firsthandjs/styled` | 4.49 kB | **2.05 kB** | 1.86 kB |
| `@firsthandjs/react` | 1.19 kB | **0.66 kB** | 0.58 kB |
| `@firsthandjs/react/auto` | 1.20 kB | **0.66 kB** | 0.58 kB |
| `@firsthandjs/server` | 2.84 kB | **1.26 kB** | 1.11 kB |
| `@firsthandjs/server/internal` | 3.56 kB | **1.57 kB** | 1.38 kB |

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
This repository is the demonstration: 1294 tests under Vitest and 102
under Playwright across Chromium, Firefox and WebKit, covering the framework,
the router, the query cache and all eight examples.
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

- **No streaming server rendering.** `@firsthandjs/server` renders a whole
  document and hands it over — `renderToString` for markup that needs no data,
  `renderToStringAsync` for markup that does. Sending a shell first and the
  rest as it resolves is not implemented.
- **A server render runs no effects.** There is no later for a second run to
  happen in: `effect` does not run, `ref` is not called and listeners are not
  attached — `hydrate` attaches them when the browser takes over. A
  `useResource` runs once and is awaited by `renderToStringAsync`, and one
  without a `persist` name renders its markup but arrives unanswered, so the
  browser loads it again
  ([the guide](docs/guide/17-server-rendering.md),
  [ADR-0027](docs/adr/0027-server-rendering-and-hydration.md)).
- **Benchmarked on Chromium only.** Firefox and WebKit run the correctness
  suite — all of it, including 100 000 rows — but not the benchmark.
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
