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
The whole runtime is **5.89 kB gzip** with no production dependencies. On the
render/update set it is **1.56× faster** than React 19.2.0 (geometric mean of 27
scenarios, 95 % CI 1.25–2.10) — measured in the same browser session with
byte-identical DOM verified before any timing, and with every scenario published,
including the 2 React wins.
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

**[The guide](docs/guide/)** — fourteen pages, in order:
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
[testing](docs/guide/12-testing.md),
[performance](docs/guide/14-performance.md),
[building and deploying](docs/guide/15-building.md).

**[The reference](docs/reference/)** — one page per package, every export with
its signature:
[core](docs/reference/core.md),
[dom](docs/reference/dom.md),
[jsx-runtime](docs/reference/jsx-runtime.md),
[compiler](docs/reference/compiler.md),
[router](docs/reference/router.md),
[query](docs/reference/query.md),
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
| `@firsthandjs/dom`         | 4.15 kB     | Components, rendering, elements, lists, portals |
| `@firsthandjs/jsx-runtime` | 0.59 kB     | JSX types, and the runtime fallback             |
| `@firsthandjs/deep`        | 0.72 kB     | Deep reactivity: every property is a signal     |
| `@firsthandjs/devtools`    | 1.40 kB     | **Experimental.** What updates what, and why    |
| `@firsthandjs/compiler`    | build only  | The TSX transform and the bundler plugin        |
| `@firsthandjs/router`      | 3.36 kB     | Routes, links, history, lazy routes             |
| `@firsthandjs/query`       | 3.23 kB     | The cache, tags, REST, GraphQL, codegen         |
| `@firsthandjs/styled`      | 1.97 kB     | CSS-in-JS with custom properties                |
| `@firsthandjs/react`       | 0.66 kB     | React components inside Firsthand               |
| `@firsthandjs/testing`     | dev only    | `mount`, `cleanup`, leak probes                 |

Every package is independent: installing `@firsthandjs/dom` pulls in the core and
nothing else.

## Performance

Measured, not asserted. Everything below comes from
[`benchmarks/results/latest.json`](benchmarks/results/latest.json), produced by
`npm run bench`, which verifies that both implementations render byte-identical
DOM before it times anything.

React 19 is the comparison because it is the model most readers know and the
one with a mature, idiomatic implementation to measure against — not because a
benchmark settles which design is better. Both implementations are written the
way their own documentation recommends, every scenario is published including
the ones React wins, and the raw data is in the repository so you can disagree
with the conclusions using the same numbers.

<!-- benchmark:start -->
<!-- prettier-ignore-start -->

### Firsthand vs React 19.2.0

Intel(R) Core(TM) i7-8700K CPU @ 3.70GHz, 12 cores · Chromium via Playwright · Node v24.19.0 ·
25 measured repetitions after 5 warmups ·
production builds · interleaved in one browser session ·
DOM equality verified before timing · commit `1908ce50` ·
2026-09-19

| Scenario | Firsthand median | React median | Firsthand p95 | React p95 | Faster |
| --- | ---: | ---: | ---: | ---: | :--- |
| `mount-1k` | 33.00 ms | 39.50 ms | 41.30 ms | 55.30 ms | Firsthand 1.20× |
| `mount-10k` | 396.50 ms | 619.10 ms | 458.60 ms | 686.20 ms | Firsthand 1.56× |
| `replace-1k` | 39.60 ms | 48.60 ms | 44.30 ms | 53.70 ms | Firsthand 1.23× |
| `replace-10k` ~ | 447.50 ms | 779.20 ms | 563.60 ms | 964.80 ms | Firsthand 1.74× |
| `update-every-10th-1k` | 7.70 ms | 8.30 ms | 8.60 ms | 9.70 ms | Firsthand 1.08× |
| `update-every-10th-10k` | 87.50 ms | 90.20 ms | 129.50 ms | 106.30 ms | Firsthand 1.03× |
| `select-row` ~ | 0.40 ms | 0.50 ms | 0.50 ms | 0.60 ms | Firsthand 1.25× |
| `append-1k-to-1k` ~ | 41.40 ms | 43.40 ms | 83.60 ms | 52.70 ms | Firsthand 1.05× |
| `append-1k-to-10k` | 70.30 ms | 77.80 ms | 106.20 ms | 95.40 ms | Firsthand 1.11× |
| `remove-row` | 2.50 ms | 3.00 ms | 4.30 ms | 4.00 ms | Firsthand 1.20× |
| `swap-rows-1k` | 2.70 ms | 33.10 ms | 3.10 ms | 45.50 ms | Firsthand 12.26× |
| `swap-rows-10k` ~ | 36.10 ms | 556.30 ms | 64.30 ms | 651.80 ms | Firsthand 15.41× |
| `reverse-1k` | 31.10 ms | 33.40 ms | 36.60 ms | 38.10 ms | Firsthand 1.07× |
| `reverse-10k` | 378.20 ms | 582.90 ms | 445.30 ms | 693.70 ms | Firsthand 1.54× |
| `clear-1k` | 4.90 ms | 8.50 ms | 5.60 ms | 9.60 ms | Firsthand 1.73× |
| `clear-10k` | 51.50 ms | 88.90 ms | 62.60 ms | 100.40 ms | Firsthand 1.73× |
| `prepend-1k-to-10k` | 78.70 ms | 83.10 ms | 93.10 ms | 106.70 ms | Firsthand 1.06× |
| `update-single-row-10k` | 32.50 ms | 33.20 ms | 43.50 ms | 37.20 ms | Firsthand 1.02× |
| `conditional-branch-switch-1k` | 13.60 ms | 19.10 ms | 22.30 ms | 27.90 ms | Firsthand 1.40× |
| `deep-tree-mount` | 1.00 ms | 1.40 ms | 1.70 ms | 2.10 ms | Firsthand 1.40× |
| `context-change-1` ~ | 0.10 ms | 0.10 ms | 0.20 ms | 0.20 ms | React 1.00× |
| `context-change-100` | 1.10 ms | 1.20 ms | 2.20 ms | 2.80 ms | Firsthand 1.09× |
| `context-change-10k` | 114.60 ms | 128.90 ms | 136.10 ms | 199.40 ms | Firsthand 1.12× |
| `rapid-updates-1k-unbatched` ~ | 0.50 ms | 2.30 ms | 0.90 ms | 3.40 ms | Firsthand 4.60× |
| `rapid-updates-1k-batched` | 0.10 ms | 0.20 ms | 0.20 ms | 0.40 ms | Firsthand 2.00× |
| `portal-update` ~ | 0.10 ms | 0.10 ms | 0.40 ms | 0.10 ms | React 1.00× |
| `input-event-latency` ~ | 0.20 ms | 0.20 ms | 0.40 ms | 0.30 ms | Firsthand 1.00× |

**Geometric mean of the per-scenario ratios: 1.563×**
(95 % bootstrap CI 1.246–2.102). The interval
excludes 1.0, which is the condition this project set before it would make an
aggregate claim at all. Firsthand was faster in 25 of 27 scenarios in this run.

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
| **Firsthand** | 1.76 MB | 1.93 MB | 0.26 MB | 58.60 ms |
| React | 2.21 MB | 2.80 MB | 0.60 MB | 78.60 ms |

The third column is the one to read: it is what the page still holds once
the tree has been torn down.

### Mass data: 100 000 rows

A separate, slower run (`BENCH_SCALE=heavy npm run bench`), with
7 repetitions after 1 warmups. Kept out of the aggregate
above rather than folded into it: averaging measurements taken with
different sample sizes would quietly weaken the confidence interval.

| Scenario | Firsthand median | React median | Faster |
| --- | ---: | ---: | :--- |
| `mount-100k` | 3995.20 ms | 32645.10 ms | Firsthand 8.17× |
| `clear-100k` | 592.90 ms | 1841.00 ms | Firsthand 3.11× |
| `update-every-10th-100k` | 929.00 ms | 1020.90 ms | Firsthand 1.10× |

### Bundle size

| Module | minified | gzip | brotli |
| --- | ---: | ---: | ---: |
| `@firsthandjs/core` | 6.50 kB | **2.36 kB** | 2.14 kB |
| `@firsthandjs/dom` | 10.45 kB | **4.20 kB** | 3.76 kB |
| `@firsthandjs/dom/internal` | 9.90 kB | **4.11 kB** | 3.67 kB |
| `@firsthandjs/jsx-runtime` | 1.15 kB | **0.59 kB** | 0.50 kB |
| full runtime (core + dom, everything imported) | 15.92 kB | **5.89 kB** | 5.31 kB |


Optional packages, downloaded only by an application that imports them:

| Module | minified | gzip | brotli |
| --- | ---: | ---: | ---: |
| `@firsthandjs/deep` | 1.58 kB | **0.72 kB** | 0.66 kB |
| `@firsthandjs/devtools` | 14.97 kB | **5.51 kB** | 4.82 kB |
| `@firsthandjs/i18n` | 0.63 kB | **0.37 kB** | 0.32 kB |
| `@firsthandjs/router` | 8.36 kB | **3.36 kB** | 3.06 kB |
| `@firsthandjs/query` | 7.77 kB | **3.24 kB** | 2.96 kB |
| `@firsthandjs/query (.gql loader path, parser tree-shaken)` | 5.15 kB | **2.16 kB** | 1.98 kB |
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
This repository is the demonstration: 739 tests under Vitest and 87
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
counter, args as props, the router on a memory history and the query cache
mutating and invalidating — in a real browser.

Full guide, including which Vitest environment to use and how to assert that a
DOM node survived an update: [`docs/guide/12-testing.md`](docs/guide/12-testing.md).

## Browser support

Modern evergreen browsers: Chromium, Firefox and WebKit. Firsthand relies on
`<template>`, `composedPath()`, custom elements, ES2022 and ES modules. No
polyfills are shipped and none are planned.

Cross-engine testing runs through Playwright, and the full suite — 29 tests
covering the framework, the router, the query cache and the seven example
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
