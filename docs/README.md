# Firsthand documentation

Start with the [guide](guide/) if you are learning the framework, the
[reference](reference/) if you are looking something up, and the
[ADRs](adr/) if you want to know why something is the way it is.

## Guide

Read in order the first time; each page assumes the ones before it.

| #   | Page                                                       | What it covers                                                    |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | [Getting started](guide/01-getting-started.md)             | Install, configure, first component, how the pieces fit           |
| 2   | [Reactivity](guide/02-reactivity.md)                       | Signals, computeds, effects, batching, when the DOM updates       |
| 3   | [Components](guide/03-components.md)                       | Running once, props, children, what replaces re-rendering         |
| 4   | [Rendering](guide/04-rendering.md)                         | Conditionals, lists and keys, fragments, portals, refs            |
| 5   | [Context and lifecycle](guide/05-context-and-lifecycle.md) | Sharing values, cleanup, error boundaries, the owner tree         |
| 6   | [Events and forms](guide/06-events-and-forms.md)           | Delegation, custom events, controlled inputs, validation          |
| 7   | [Styling](guide/07-styling.md)                             | Plain CSS, `class`, and `@firsthandjs/styled`                     |
| 8   | [Routing](guide/08-routing.md)                             | Nested routes, params, links, code loaded on demand               |
| 9   | [Data](guide/09-data.md)                                   | The tag-based cache, REST, GraphQL, `.gql` files and codegen      |
| 10  | [Web components](guide/10-web-components.md)               | Using them, and publishing your own components as custom elements |
| 11  | [React interop](guide/11-react-interop.md)                 | MUI and friends, and what the bridge costs                        |
| 12  | [Testing](guide/12-testing.md)                             | Vitest, Playwright, Storybook, and what is worth asserting        |
| 13  | [Performance](guide/13-performance.md)                     | What is fast by construction, what is not, and how to measure     |
| 14  | [Building and deploying](guide/14-building.md)             | The compiler, bundlers, chunking, hosting                         |

## Reference

One page per package, listing every export with its signature.

| Package                                                | Size (gzip) | What it is                                         |
| ------------------------------------------------------ | ----------- | -------------------------------------------------- |
| [`@firsthandjs/core`](reference/core.md)               | 2.36 kB     | Signals, computeds, effects, context, owners       |
| [`@firsthandjs/dom`](reference/dom.md)                 | 4.15 kB     | Components, rendering, elements, lists, portals    |
| [`@firsthandjs/jsx-runtime`](reference/jsx-runtime.md) | 0.59 kB     | JSX types, and the runtime fallback                |
| [`@firsthandjs/compiler`](reference/compiler.md)       | build only  | The TSX transform and the bundler plugin           |
| [`@firsthandjs/deep`](reference/deep.md)               | 0.72 kB     | Deep reactivity: every property is a signal        |
| [`@firsthandjs/devtools`](reference/devtools.md)       | 1.12 kB     | Read the graph: what updates what, and why         |
| [`@firsthandjs/router`](reference/router.md)           | 3.36 kB     | Typed routes, links, history, lazy routes          |
| [`@firsthandjs/query`](reference/query.md)             | 3.23 kB     | The cache, tags, REST, GraphQL, codegen            |
| [`@firsthandjs/styled`](reference/styled.md)           | 1.97 kB     | CSS-in-JS with custom properties                   |
| [`@firsthandjs/react`](reference/react.md)             | 0.66 kB     | React components inside Firsthand, directly or not |
| [`@firsthandjs/testing`](reference/testing.md)         | dev only    | `mount`, `cleanup`, leak probes                    |

Sizes are measured by `npm run build` and published in the
[README](../README.md#performance) with everything else.

## Everything else

- [API conventions](api-conventions.md) — the naming and behaviour rules every
  package follows, so you can guess an API before reading it.
- [Architecture](../ARCHITECTURE.md) — how the packages fit together, and the
  compiler/runtime protocol.
- [ADRs](adr/) — every decision with performance or semantic consequences,
  including the ones measurement proved wrong.
- [Performance plan](../PERFORMANCE_PLAN.md) and
  [risk register](architecture/risks.md) — what was predicted, and what
  actually happened.

## Example applications

- [`examples/`](../examples/) — one idea each: counter, todo, context, portal,
  query, router, and a 100 000-row table.
- [`integrations/interop/`](../integrations/interop/) — MUI, Shoelace and
  styled components on one page.
- [`integrations/storybook/`](../integrations/storybook/) — a working
  Storybook.
