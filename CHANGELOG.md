# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `snapshot(read)` — a read that is meant to happen once, such as the starting
  value of an editable field. It untracks, like `untrack`, and says why.
- `strictReactivity` on the compiler plugin — refuses to compile a declaration
  in a component setup whose initialiser is nothing but a read, naming the
  declaration and both ways out. Narrow on purpose: anything containing a call
  is left alone, which covers `signal(props.initial)`, `peek()`, `computed` and
  every handler without special-casing them by name
  ([ADR-0019](docs/adr/0019-strict-reactivity.md)).
- `setStrictReactivity(true)` — a development-only report for the mistake the
  single-run setup invites: a signal or prop read in a component body with
  nothing subscribing, so the value is read once and then kept. Off by default,
  because reading once is often deliberate. Reported once per read rather than
  once per instance, and silent inside `snapshot()` or `peek()`.

  It costs nothing in production: the diagnostics live in the module the build
  aliases to an empty stub, so the shipped bundle contains neither the check
  nor its message. `@firsthandjs/core` goes from 2.29 kB to 2.36 kB gzip for
  the new public function and the exported no-op, and the full runtime from
  5.86 kB to 5.87 kB.

### Documentation

- The components guide has a section of its own for what happens when a value
  is read in setup and kept, what it looks like when it happens, and when
  reading once is the point. Getting started, the DOM reference and the
  comparison table lead into it.

## [0.2.0] - 2026-09-20

### Added

- `@firsthandjs/deep` — deep reactivity, the shape Vue calls `reactive()`.
  `deepSignal({ user: { name: 'Ada' } })` returns a proxy where every property,
  at any depth, behaves like a signal: reads are tracked per property, writes
  notify only what read them, arrays included, no `.value` anywhere.

  **`signal` is unchanged.** The package is built on it — each property that is
  read gets a version cell, and a write bumps it — so deep reads are ordinary
  reads to `computed`, `effect`, `untrack` and every DOM binding. 0.72 kB gzip,
  downloaded only if imported; `@firsthandjs/core` stays at 2.29 kB and the
  runtime budget is untouched.

  Only objects and arrays are accepted, and the **type** enforces it: a `Map`,
  `Set`, `Date`, `RegExp`, `Promise`, function or class instance is a compile
  error, because those reach their own internals through `this` and a proxy is
  not the object. One held inside deep state still works, simply not reactively.
  The reasoning, including what a `push` does to a `length` reader, is in
  [ADR-0018](docs/adr/0018-deep-reactivity-as-its-own-package.md).

### Changed

- The reactive core lost the `QUEUED` flag and the "already scheduled?" check in
  `enqueue`. Both callers have just established that the node was not stale, and
  an effect is queued only while it is stale, so the check guarded a case the
  graph's own invariants rule out. The custom-element host lost two conditions
  for the same reason. `@firsthandjs/core` is **2.29 kB** gzip (was 2.31) and the
  full runtime **5.86 kB** (was 5.88).

### Fixed

- `--expose-gc` reached the test workers again, so the `WeakRef` memory probes
  (ADR-0011) measure instead of skipping themselves. Vitest 4 moved
  `poolOptions.forks.execArgv` to a top-level option and ignored the old shape
  silently rather than rejecting it.
- Six code paths that no test had ever executed are now covered: a symbol on the
  left of `in` against deep state, a childless element on the runtime JSX path,
  clearing a child whose node something else already removed, `clear()` on a
  query that is still subscribed, a rest element in a setup that already has a
  block body, and a `map` callback whose block body does not return JSX. They
  were reported as covered until the coverage tool started remapping through the
  AST; the behaviour was always right, but nothing held it in place.

### Security

- No advisory affects a published package or anything an application ships —
  both were development-only dependencies.
- `qs` is lifted to `^6.16.0` through an override (GHSA-q8mj-m7cp-5q26,
  GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g). It arrives through
  `typed-rest-client` under `@stryker-mutator/core`, which pins it exactly, so an
  override is the only way to move it.
- Vitest is at 4.1.11 (GHSA-82fw-gwwq-j7x9, path traversal in `@vitest/mocker`).
  Not 5.0.1: under Vitest 5 the Stryker runner reports every mutant as survived —
  93.30 % becomes 8.80 % with no change to the tests — and a working mutation
  gate is worth more than the higher version number.

## [0.1.1] - 2026-09-19

### Changed

- The documentation describes the re-render model without arguing with it.
  Several passages used React as a foil — "solves a problem created by
  re-rendering", "a worse one than React at being React", an ADR titled
  "escape hatch" — where the subject is really two designs making different
  trades. Rewritten across ADR-0001, ADR-0006, ADR-0016, the interop guide, the
  performance guide, the README and the package READMEs: what each model buys,
  what it costs, and why this project chose as it did. The measurements are
  unchanged, losses included, and the README now says why React 19 is the
  comparison at all.
- The README opens with the question every framework answers rather than with
  somebody else's answer to it.

### Added

- Re-creating a component on purpose is documented and tested: a changing `key`,
  or a version signal read in the child position, replaces the instance —
  cleanups run, state starts fresh — while a prop change still updates in place.
- The documentation is published as a GitHub wiki, generated from `docs/` by
  `scripts/build-wiki.mjs` and republished by a workflow on every change, with a
  sidebar carrying the reading order.

### Fixed

- A signal rendered without reading it — `<p>{count}</p>` — compiled and showed
  `[object Object]`. JSX children were typed `unknown` while attributes already
  rejected it; children are typed now, and development warns when any object
  reaches the branch that stringifies it, naming the fix when it looks like a
  cell. Production is unchanged in size and behaviour.
- CodeQL could not run: Dependabot bumps one action path per pull request, so
  `codeql-action/analyze` reached 4.38.0 while `codeql-action/init` stayed on
  4.30.8. Every pinned action moves together now, and `dependabot.yml` groups
  them into one pull request so they cannot drift again.

## [0.1.0] - 2026-09-19

### Added

- `@firsthandjs/core`: signals, computeds, effects, `batch`, `untrack`, the owner
  tree, lifecycle (`onCleanup`, `createRoot`, `catchError`, `runWithOwner`) and
  reactive context.
- `@firsthandjs/dom`: templates, specialised DOM parts, native event delegation,
  keyed lists, portals, `render`, and the opt-in custom element host.
- `@firsthandjs/compiler`: the TSX transform — static markup into templates,
  dynamic expressions into parts, keyed `.map()` into list parts, stable
  component ids, and a bundler plugin.
- `@firsthandjs/jsx-runtime`: the runtime JSX fallback for environments without
  the compiler.
- `@firsthandjs/testing`: `mount`, `cleanup`, `autoCleanup`, `withRoot`,
  `subscriberCount` and `tick`, for Vitest, Jest, Mocha or Playwright.
- `@firsthandjs/query`: a cache in front of the network for REST and GraphQL,
  invalidated by tags rather than by cache keys — tags carry variables, a query
  carries several, and a mutation invalidates every query carrying a matching
  tag (ADR-0014). GraphQL documents declare their own tags as directives —
  `@tag(name: "user", id: $id)`, `@invalidates(name: "users")` — on the
  operation or on a field, stripped from the document before it is sent and
  read at build time by `@firsthandjs/query/vite`. 3.23 kB gzip, or 2.14 kB when
  the loader makes the document parser unreachable.
- `@firsthandjs/styled`: styled-components' API — `styled.tag`,
  `styled(Component)`, `css`, `keyframes`, `createGlobalStyle`, a theme and
  transient props — where an interpolation in a declaration's value becomes a
  CSS custom property rather than a new class (ADR-0015). A thousand rows with
  a thousand colours produce one rule and one `setProperty` per change.
  Nesting is the browser's; there is no preprocessor. 1.97 kB gzip, against
  styled-components v6's 13.03 kB measured the same way.
- `@firsthandjs/react`: React components inside Firsthand, for libraries that exist
  only for React (ADR-0016). 0.66 kB, with react and react-dom as peers — and
  a README that says plainly that they are another ~45 kB, eight times this
  framework's runtime, and that a web-component library costs nothing.
- `on:` event names, taken verbatim: `on:sl-change`, `on:value-changed`. No
  casing of an identifier produces a hyphen, which is what every
  web-component library dispatches. Compiler and runtime both.
- `@firsthandjs/router`: nested routes, ranked matching, `Outlet`, `Link`,
  `NavLink`, `Navigate`, the hooks, three history adapters, and `lazy` routes
  whose code is fetched when the route is entered — or on hover, through
  `<Link preload>` (ADR-0013). 3.36 kB gzip, outside the runtime budget.
- Architecture documentation and ADRs for every decision with performance or
  semantic consequences.
- Typed GraphQL documents. A `.gql` import is a
  `GraphQLDocument<TData, TVariables>`, and `@firsthandjs/query/codegen` — a
  `graphql-codegen` plugin — emits one `declare module '*/notes.gql'` per
  operation from the generated operation types. `useGraphQL(NotesDocument, …)`
  and `useGraphQLMutation(UpdateNoteDocument)` then need no type argument at
  any call site, required variables cannot be omitted, and renaming a schema
  field breaks compilation everywhere it was used.
- `#import "./fragments.gql"` in `.gql` files: fragments are inlined at build
  time by `@firsthandjs/query/vite`, once per file however often it is imported.
  `inlineImports` is exported so another bundler's plugin can reuse it.
- React components as ordinary TSX elements: `import '@firsthandjs/react/auto'`
  once, and `<Button variant="contained">Save</Button>` works. The runtime
  gained one framework-agnostic seam for it — `setComponentAdapter` in
  `@firsthandjs/dom`, plus an empty `JSX.ForeignElementTypes` interface to merge
  into — and nothing outside `@firsthandjs/react` names React (ADR-0017). It is
  the same bridge underneath, cached per component type, and `fromReact` is
  still what a React component with **Firsthand** children needs.
- `setReactWrapper(wrapper)`: React elements wrapped around every bridged root.
  Each bridge is its own React root, so React context does not flow from one to
  another — a MUI `ThemeProvider` rendered through one bridge could not reach a
  button rendered through another. Reading a signal in the wrapper makes one
  theme switch re-render every bridged component and nothing else.
- Typed routes. `route({ path: 'users/:id', … })` keeps the path as a literal
  type and hands the component `props.params` typed as `{ id: string }`;
  `children` written as a function carries a parent's parameters into its
  children. Nothing is declared twice, and a parameter the path does not
  capture does not compile. Route components may still be plain
  `RouteDefinition` objects, and `useRouteParams()` still exists.
- A typed theme for `@firsthandjs/styled`: declare `FirsthandTheme` by module
  augmentation and every interpolation reads `props.theme.background` with a
  type. Declaring nothing keeps the indexed form.
- A guide and an API reference in [`docs/`](docs/README.md): fourteen guide
  pages in reading order and one reference page per package listing every
  export with its signature. The README is now an overview and the evidence
  for the performance claims, and links there for everything else.

### Measured

- Bundle size: full runtime 5.88 kB gzip (5.29 kB brotli), within the 6 kB
  budget, enforced by `npm run build`. Routing adds 3.36 kB gzip, the query
  cache 3.23 kB (2.14 kB on the `.gql` loader path) and styling 1.97 kB, each
  only if imported.
- Against React 19.2.0 in the same browser session with verified-identical
  DOM across six application shapes: faster in 25 of 27 scenarios, geometric
  mean 1.563x (95 % CI 1.246-2.102). Every scenario React wins is
  published in the same table, and rows whose samples are too widely spread for
  the median to be a reliable point estimate are marked as such.
- At 100 000 rows: mount 4.0 s against React's 32.6 s (geometric mean 3.03x over
  the three heavy scenarios, 95 % CI 1.10-8.17).
- Keyed reconciliation: three candidates compared over ten operations at two
  sizes; longest-increasing-subsequence chosen on the data (ADR-0010).
- Allocation: 41 bytes across a thousand re-evaluated bindings, 0.10 bytes per
  signal write (`npm run bench:profile`; sampled, so a few bytes either way).
- `.value` reads do not go megamorphic (R2, `npm run bench:ic`): a site reading
  signals, computeds and effect-subscribed cells costs 1.01x a site reading
  signals alone, against 28.7x for a control site reading eight unrelated
  object shapes.
- Memory: 1.76 MB retained after mounting 1 000 rows against React's
  2.21 MB, and 0.26 MB against 0.60 MB after disposal. Disposal also
  returns the reactive graph to zero subscriptions, confirmed structurally and
  with `WeakRef` probes under forced GC.
- Cold start, fresh page, first mount of 1 000 rows: 58.6 ms against 78.6 ms.
- Mutation score 93.95 % over the reactive core (was 90.5-91.3 % before the
  pull-order regression tests), gated at 88 % in CI — timeout classification
  moves it by about a point on the same code.
- Element host cost (ADR-0003): 1.5x-1.7x mount time and twice the DOM nodes
  against hostless components. Real, but smaller than the ADR originally implied, which
  has been corrected.
- Delegated events (ADR-0012): cheaper to register (0.10 ms against 0.30 ms
  for 2 000 handlers) and faster to dispatch at depths 1, 5 and 20.

### Demonstrated

- Vitest and Playwright: this repository's own suite is the demonstration —
  561 unit tests and 29 cross-engine browser tests (87 runs), the latter covering the
  framework, the router, the query cache and all seven examples.
- MUI, Shoelace and styled components on one page:
  `integrations/interop/` builds it and drives all three in Chromium — a
  custom element upgrading and dispatching a hyphenated event into a Firsthand
  handler, MUI rendering through the bridge with events flowing both ways, and
  five styled instances with five different values sharing one CSS rule. That
  page is 145 kB gzip, of which the framework is 5.6 kB; the number is
  published because it is the honest headline for interop.
- Storybook: `integrations/storybook/` is a working Storybook over the stock
  HTML renderer plus fifteen lines of disposal glue. Its `npm test` builds the
  static Storybook and drives five stories in headless Chromium, including the
  router on a memory history, a query invalidated by a mutation, and a
  `.graphql` file loaded by `@firsthandjs/query/vite` whose stub transport rejects
  any document still carrying a cache directive. Kept out of the root workspace
  so the framework can be worked on without installing it; a CI job installs
  and runs it.

### Changed

- `useParams` is now `useRouteParams`. It reads the _route's_ parameters, and
  `useSearchParams` sits next to it — one of the two had to say which.
- A route component is handed `props.params`. Components that took no props are
  unaffected.

- Public names and behaviour were made consistent across every package, to the
  rules now written down in [`docs/api-conventions.md`](docs/api-conventions.md).
  Nothing is released yet, so these are renames rather than breaking changes:
  `configure({ prefix })` became `setElementPrefix(prefix)`; the router's
  `normalise` became `normalizePath` and `componentFor` became `routeComponent`;
  the query cache's `HttpError`, `GraphQLError` and `GraphQLTagError` became
  `FirsthandHttpError`, `FirsthandGraphQLError` and `FirsthandDirectiveError`, so that
  every error this project throws is prefixed and `instanceof` is never
  ambiguous with `graphql-js`'s own `GraphQLError`. `off` is exported beside
  `on`; `useRouter()` mirrors `useQueryClient()`; `createEffect` and `bind`
  moved into the core's declared internal surface.
- `refetch({})` now does what `refetch()` does. It used to respect the cache
  while `refetch()` went to the network, so passing an empty options object
  silently changed the behaviour; `refetch({ force: false })` is how you ask
  for the cache.

### Fixed

- `styled(styled(X))` threw `Cannot redefine property: class`. A styled
  component can now be restyled to any depth, and **the outer declaration
  wins**: each wrapping level repeats its class in the selector, so specificity
  decides rather than the order rules happened to reach the sheet in.
- A route component written as a plain function ran inside the part that
  rendered it, so reading a parameter subscribed that part and the next
  navigation rebuilt the page instead of updating it. Such a component is now
  declared once, with its own owner and an untracked setup.
- An application's `declare module '@firsthandjs/styled'` had no effect: the
  declaration file resolved `ThemeContext`'s type eagerly, freezing the theme
  as the empty one. It is annotated now, so the augmentation reaches it.

- A query whose variables were not in its tags never re-fetched. The entry's
  identity is now its tags **and** its `variables`, which are also handed to
  the fetcher, so a page number or a filter moves the query to another entry
  and fetches it — and moving back answers from the cache. GraphQL queries
  already keyed on their variables; REST ones silently did not.
- A missed update in the reactive graph. When two subscribers depended on the
  same computed and one of them reached it through a second computed, the
  subscriber resolved _after_ the shared computed had already been refreshed
  saw a dependency that was no longer marked stale and concluded it was up to
  date. Refreshing a computed now tells its other subscribers that the value
  really changed, which makes the pull phase independent of the order the
  queue happens to have. Found while building the router; six regression tests
  in `packages/core/test/pull-order.test.ts`, five of which fail without the
  fix.
- `@firsthandjs/jsx-runtime` published no JSX types. `jsx.d.ts` was an input
  declaration file, which tsc neither emits nor copies, so an installed
  package left consumers with `JSX element implicitly has type 'any'` on every
  tag — invisible in this repository, where every tsconfig included the file
  from `src` by hand. The declarations now live in the entry module itself, so
  tsc emits them and no build step can lose them; `npm run test:exports` fails
  if they ever stop being published. Found by building the Storybook
  integration, which resolves the packages the way a consumer does.
- `exactOptionalPropertyTypes` rejected `<Badge count={maybeUndefined} />` for
  a component declaring `count?: number`, although absence and `undefined`
  mean the same thing to the component. Optional props now accept an explicit
  `undefined`; required props are unchanged.

### Not yet measured

- Benchmarks on Firefox and WebKit; those engines run the correctness suite
  only.
- JS execution time as a figure separate from layout; every timing here
  deliberately includes the layout it causes.
- Whether `.value` access sites stay monomorphic in practice (R2, the one risk
  still open).

[0.2.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.2.0
[0.1.1]: https://github.com/firsthandjs/firsthand/releases/tag/v0.1.1
[0.1.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.1.0
