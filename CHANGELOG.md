# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-09-21

### Added

- **One cache, at the transport edge — and it is one you can use without a
  server.** 0.5.0 said caching belongs to the transport and left a hole: an
  application on plain `fetch` had no transport to put one in, so every mount
  was a request.

  `createCacheClient({ ttl, max })` fills it, and the same object does both
  jobs. `createFetchClient` keeps its answers in one of these; an algorithm of
  yours uses the identical `read`:

  ```ts
  const cache = createCacheClient({ ttl: 30_000 });
  const api = createFetchClient({ baseUrl: '/api', cache });

  const report = useResource(({ request }) =>
    cache.read(`report:${month.value}`, () => buildReport(month.value))(request),
  );
  ```

  There is no second implementation hidden inside the fetch client. **With no
  `ttl` it still shares what is in flight** — ten components asking at once make
  one request — because two identical requests overlapping in time is waste
  rather than staleness, and needs no configuration. The producer runs under a
  signal of the cache's own, aborted only when _every_ waiter has gone, so one
  component leaving cannot cancel a request another is still waiting for.

- **The request is one object, and it is what reaches the transport.** A loader
  is handed `{ signal, force, tags? }` and hands it to a client:

  ```tsx
  const user = useResource(({ request, tags }) => {
    tags(tag('user', { id: props.id }));
    return api.get<User>(`/users/${props.id}`)(request);
  });
  ```

  `signal` and `force` travel together because they answer the same question —
  is this request still wanted, and may its answer come from memory. Before
  this, `force` was a flag every call site had to remember to translate into
  `cache: 'reload'` or `fetchPolicy: 'network-only'`; a forgotten translation
  made an invalidation **silently** pointless. Now every client honours it, and
  the cache drops the entry.

  `tags` is the third, optional, member: where a client reports what the answer
  turned out to be about. In a resource that is the resource's tags; in an
  action it is the store's invalidation — so a GraphQL mutation wires its own
  `@invalidates` with nothing at the call site:

  ```tsx
  const pay = useAction((id: string, { request }) => billing.mutate(PayDocument, { id })(request));
  ```

### Changed

- **Every transport is a client now, made the same way.** 0.5.0 shipped
  `json(url)` for fetch and `xLoader(instance)` for the rest, which is three
  shapes for one idea. All four are `create…Client(…)`: configured once with a
  base URL, headers and a cache, specialised with `.with(…)`, overridden per
  call, and each exposing its `.cache`.

  | Was                             | Is                                                     |
  | ------------------------------- | ------------------------------------------------------ |
  | `json(url, init)`               | `createFetchClient(options).get(url, init)`            |
  | `axiosLoader(instance)(config)` | `createAxiosClient(instance, options).request(config)` |
  | `urqlLoader(client)(doc, vars)` | `createUrqlClient(client, options).query(doc, vars)`   |
  | `apolloLoader(client, gql)(…)`  | `createApolloClient(client, gql, options).query(…)`    |
  | `apolloObservable(client, gql)` | `createApolloClient(client, gql).watch(…)`             |
  | `({ signal }) => …`             | `({ request }) => client…(request)`                    |
  | `init.cache` (ours)             | `init.cacheKey`; `cache` is the platform's again       |

  `createFetchClient` is a small REST client on the browser's own `fetch`: base
  URL, `get`/`post`/`put`/`patch`/`remove`/`request`, a failed status thrown,
  the abort signal wired through, and the cache. `json:` still labels the one
  body the platform gets wrong, and `body:` still leaves alone the ones it
  labels itself.

- **A token that changes is handled by the clients, not by documentation.**
  `headers` may be a function; it is called per request (so the current token
  is sent) and **untracked** (so no resource depends on the token). The bug
  that motivates this was measured in 0.4.1: writing a token on sign-out
  re-sent every request that had built a header from it — without one.

- **`@firsthandjs/query` is deprecated on npm**, pointing at
  `@firsthandjs/data`. It was replaced in 0.5.0 and has not been published
  since 0.4.1.

### Documentation

- The [data guide](docs/guide/09-data.md) opens with what the chapter is
  actually about — data that comes from outside the reactive graph, of which a
  server is the commonest example and not the only one — names the two ways it
  arrives (you ask; it tells you) with links to both, and replaces the old
  "what it is not" section with the one distinction that matters: the
  reactivity layer, the transport layer, and where caching sits between them.
  The `fetch` section now says what it _is_ before justifying any of it.
- Each transport section links its package README, and the reference page has
  the cache, the request and all four clients.
- [ADR-0023](docs/adr/0023-one-cache-at-the-transport-edge.md) records the
  decision, the rejected alternatives (including `force` as a function) and the
  measured cost: 0.84 kB gzip for the cache and the fetch client together.

## [0.5.0] - 2026-09-21

### Changed

- **`@firsthandjs/query` is now `@firsthandjs/data`, and it is not a cache.**
  The package kept a store of loaded data _and_ a REST fetcher, a GraphQL
  transport and the hooks binding them. Two problems followed, one measured and
  one structural:

  - **Identity.** An entry was identified by its tags and variables, so two
    unrelated call sites that happened to carry the same tags shared one entry
    — and one silently served the other's data. A key would have fixed it by
    asking everybody to invent one and never collide. Removing the concept
    removed the class of bug instead: a resource belongs to its **call site**.
  - **Layers.** An application that brings Apollo or urql brings a normalising
    cache. Two caches over the same data do not merely waste memory; they
    disagree, and the disagreement is a bug nobody can reproduce. Caching now
    belongs to the transport, where the knowledge of what is _the same thing_
    actually lives.

  Tags survived, and are now for invalidation only — so they may be coarse,
  overlap, and be shared, none of which is dangerous once nothing is looked up
  by them. [ADR-0022](docs/adr/0022-resources-not-a-cache.md) has the
  measurement and the rejected alternatives; [ADR-0014](docs/adr/0014-tag-based-cache-invalidation.md)
  is superseded.

  | Was                                            | Is                                                       |
  | ---------------------------------------------- | -------------------------------------------------------- |
  | `@firsthandjs/query`                           | `@firsthandjs/data`                                      |
  | `createQueryClient({ staleTime, cacheTime })`  | `createData({ storage })`                                |
  | `QueryClientContext` / `useQueryClient()`      | `DataContext` / `useData()`                              |
  | `useQuery(() => ({ tags, variables, fetch }))` | `useResource(({ signal, tags, force }) => …)`            |
  | `useMutation({ mutate, invalidates })`         | `useAction(async (input, { signal, invalidates }) => …)` |
  | `variables: { page }`                          | read `page.value` inside the loader                      |
  | `query.fetching` / `mutation.fetching`         | `resource.loading` / `action.running`                    |
  | `query.refetch()` / `mutation.mutate()`        | `resource.reload()` / `action.run()`                     |
  | `status === 'pending'`                         | `status === 'loading'`                                   |
  | `useGraphQL(Document, vars)`                   | `useResource((c) => client(Document, vars)(c))`          |
  | `createGraphQLTransport({ url })`              | your urql or Apollo client, or `json()`                  |
  | `createGraphQLApi(transport)`                  | a second loader                                          |
  | `tagKey`, `tagsKey`, `variablesKey`            | gone — they existed to build an identity                 |
  | `FirsthandGraphQLError`                        | gone — your client's own error reaches `error`           |

  What a migration actually costs: a loader is an ordinary function, so
  `fetch:` bodies move across unchanged, and `variables` become reads. What
  changes behaviour is that **a second component asking for the same thing asks
  the server** — `staleTime` and deduplication are gone. If that matters, put a
  cache in the transport, where it can be the only one.

- **Dependencies are tracked, not declared.** A resource's loader runs inside an
  effect, so everything it reads before its first `await` is a dependency —
  exactly as in `effect`. There is no `variables` object to keep in step with
  the fetcher, which was the one mistake the old API could still let you make.
  A token read to build a header is a dependency too, which `peek()` answers
  and every helper package does for you.

### Added

- **`@firsthandjs/data-axios`, `-urql` and `-apollo`** — 0.11, 0.29 and 0.37 kB
  gzip. Each binds an instance **you** built and declares the two or three
  methods it uses _structurally_: no dependency on the client, not even a peer
  one, so there is no version to follow and nothing to break when yours changes.
  `apolloObservable` is the other shape: Apollo's cache as the source of truth,
  bridged with `fromObservable`, for an entity shown in twenty places at once.

- **Variables are checked against the operation.** `DocumentArguments<V>` is a
  tuple, so `urqlLoader` and `apolloLoader` require variables for an operation
  that has them and accept the document alone for one that does not — the
  guarantee `useGraphQL` used to give, kept while the transport moved out. The
  helper packages' tests were not being typechecked at all, which is how the
  weaker signature survived; `tsconfig.typecheck.json` now covers them.

- **`fromObservable` and `fromPromise`** — a pushing source or a bare promise as
  a resource, for the cases a per-call-site loader is the wrong shape.

- **Persistence, by name.** `useResource(load, { persist: 'boards' })` with a
  `storage` on the store keeps the last value between visits — IndexedDB,
  `localStorage`, anything with `read`/`write`/`clear`. It is opt-in because a
  name is the one thing a call site cannot supply, and a storage that throws is
  a storage that has nothing.

- **Tags may be declared after the answer.** `tags()` replaces rather than
  accumulates, so a loader names what it is about before the `await` when the
  client knows and after it when only the server does. An invalidation arriving
  while a run is in flight is remembered and matched again when the tags appear,
  so the run that was overtaken goes again instead of leaving a stale value on
  screen.

- **`@invalidates` reaches the store through a helper package.** A mutation
  document's directives are what it is about, so `{ tags: invalidates }` inside
  an action wires the document's own declaration straight through. The
  directives were parsed and typed before this release, but nothing consumed
  them.

- **`json({ json: … })`** — a JSON body with the content type the platform will
  not set for you, beside `body:` for the ones it labels itself (`FormData`,
  `URLSearchParams`, `Blob`). Every other `RequestInit` option passes through,
  including `headers` and `cache`.

### Documentation

- The [data guide](docs/guide/09-data.md) is rewritten resources-first: what
  the layer is and is not, dependencies, tags and where to declare them, `force`
  past a transport cache, persistence, one section per client including
  authentication and two APIs at once, GraphQL documents, mocking at three
  levels, and a migration table.
- A [reference page](docs/reference/data.md) for `@firsthandjs/data` and the
  three helper packages, and a README for each of the four.
- Package sizes in the tables were reconciled with the measurement: `devtools`
  had been published as 1.96 kB against a measured 6.30 kB, from before source
  maps and the panel.

## [0.4.1] - 2026-09-20

### Fixed

- **A signal a fetcher reads is no longer a dependency of the query.**
  `useQuery` calls `client.load` from inside its effect, so anything a fetcher
  read before its first `await` was being tracked. The one everybody hits is
  an auth token read to build a header: writing it re-fetched **every** watched
  query, including on the way out of a sign-out, where they all went again
  without a token.

  The fetcher now runs untracked. What a query depends on is what its `define`
  thunk reads, which is evaluated inside a computed for exactly that purpose;
  a fetcher is imperative I/O and its reads are incidental. Measured before
  fixing: with an `authorization` header built from a token signal, changing
  that token produced a second request. It now produces none, and the next
  request carries the new token.

### Added

- **`createGraphQLApi(transport)`** — the same two GraphQL hooks bound to a
  transport instead of to `GraphQLContext`. A context holds one value per
  subtree, which cannot serve the case that turns up in real applications: one
  component reading from two servers.

  ```ts
  export const billing = createGraphQLApi(createGraphQLTransport({ url: '/billing/graphql' }));
  export const catalog = createGraphQLApi(createGraphQLTransport({ url: '/catalog/graphql' }));
  ```

  One cache still serves both, so tags share a namespace — two servers that
  both have a `user` want distinct tag names.

### Documentation

- **Authentication has a section**, which it did not. What existed was a
  five-line snippet at the end of the GraphQL chapter, findable by nobody
  searching for "auth" and showing the call that caused the bug above. The
  chapter now covers the transport URL, per-request headers, the `fetch` seam,
  the 401 a server has to answer for a rejected token to end a session, and
  clearing the cache when it does. Linked from the reference and the package
  README.

## [0.4.0] - 2026-09-20

### Changed

- **`strictReactivity` is on by default in the compiler.** A declaration whose
  initialiser is nothing but a read — `const x = v.value`, `const id = props.id`
  — is now a build error rather than a silently frozen value. `firsthand({
strictReactivity: false })` restores the previous behaviour.

  It shipped off in 0.3.0, on the reasoning that a check people have to opt into
  is a check they trust. What that missed is that the person most likely to make
  this mistake is the one who has just started and has not read the option list.
  The rule only sees declarations that are _nothing but_ a read — anything
  containing a call, including `signal(props.initial)`, is left alone — so it is
  right almost every time it fires, and that is what a default has to earn.

  `setStrictReactivity` stays opt-in. It reports a read with nothing
  subscribing, which a deliberate one also is.

### Added

- `@firsthandjs/devtools` (**experimental**) — see which signal updates which
  DOM node, what depends on what, why an effect ran, and what has been
  happening.

  ```
  status (order.ts:12)
     ↓
  computed(isEditable)
     ↓
  button.disabled
  ```

  It instruments nothing. The reactive graph is already there, because
  propagation and disposal need it — every cell carries its dependencies and
  its subscribers, every owner its children — so the package attaches names to
  those nodes and reads the structure when asked. `chain(node)` draws the path,
  `inspect(node)` returns it as data, `cells()` lists what is alive, and
  `causeOf(node)` names what changed.

  The query cache and deep state are covered too. `queries()` returns what the
  cache did — created, invalidated, dropped, with readable tags — because that
  is the one part of the framework whose behaviour is not in the graph: a tag
  match is a decision rather than an edge, and an invalidation that matched
  nothing looks exactly like one that was never sent. Deep properties are named
  by their path, `user.address.city`, recorded at the only moment it is
  knowable — when a nested object is first reached through its parent.

  Off until `attach()` is called, and the framework's side of it **ships
  nothing**: the hooks live in the modules the production build replaces with
  empty functions, so a shipped bundle contains neither that code nor its
  strings. The package itself is an ordinary module and is not stripped —
  import it behind `import.meta.env.DEV` if you do not want it in your bundle.
  Measured rather than assumed: `bench:ic` still reports 1.02x for mixed cell shapes, and the calls
  to those empty functions cost 14 bytes minified and 5 gzip across the whole
  runtime — reported rather than rounded away
  ([ADR-0020](docs/adr/0020-devtools-without-a-runtime-cost.md)).

  There is a panel as well as an API, because the common case is "that element
  is wrong" and pointing at it should be the whole interaction. **Ctrl+Shift+F**
  opens it: pick an element and it draws the path from the signals down to the
  DOM write as boxes, marks the one that caused the last run, names the
  components the node sits in, and lists the recent updates with a bar for how
  far each one reached. A Timeline tab shows every update in the page, filtered
  by source, with the call stack of the write behind each entry. The panel's
  code is behind a dynamic import, so a session that never opens it never
  downloads it. The package itself is **not** replaced in a production build —
  import it behind a dev-only guard if you do not want it in your bundle.

  Every position it shows is read back through the source map. Browsers do not
  apply source maps to `error.stack`, so a frame names a line in the compiled
  module — which in a framework that turns JSX into templates and thunks is a
  line nobody wrote, and a call stack that looks authoritative while being
  wrong is worse than none. The panel fetches the module, decodes the map it
  already carries, and shows the written position; anything it cannot resolve
  it hands back untouched rather than guessing.

- **`@firsthandjs/i18n`** — `translator()` adapts any store-shaped translator,
  and `fromI18next()` wires up i18next in one line. A language change, a
  namespace that finishes loading and a resource added at runtime all invalidate
  the same cell, batched, so every translated part on the page updates once.
  Nothing is wrapped: `t` keeps its own types, including the ones a typed
  i18next resource table gives it.

- **Source maps from the compiler.** The Vite plugin emits them, so a debugger
  shows the TSX that was written rather than the templates and protocol calls
  it became — and a breakpoint can be set on a JSX expression itself.

### Performance

- **Re-measured on this release, and nothing moved.** The render/update set is
  1.542x React 19.2.0 (geometric mean of 27 scenarios, 95 % CI 1.230–2.088),
  against 1.563x (1.246–2.102) at 0.2.0. The intervals almost coincide; the
  same machine measures 4–6 % differently from one day to the next and both
  implementations move together when it does, which is why the ratio is what
  gets published. At 100 000 rows: 4.1 s against React's 30.9 s.

- **The profiler was measuring the wrong build.** `npm run bench:profile`
  resolves `@firsthandjs/*` to the package sources, so that hotspots have names
  — and the diagnostics seam is its own module, so that pulled in `dev.ts`
  rather than the stub the published build swaps in. `hook` and
  `devCheckSetupRead` sat near the top of the rapid-write profile, ahead of
  frames that are in a shipped bundle. The profiling build now performs the
  same swap, and marks the same hooks pure, as the release build does. Nothing
  about the shipped code changes; what changes is that the profile now points
  at it.

  The size of what was being mistaken for production cost, since it is worth
  knowing: about 73 ms of self time against `applyChild`'s 84 ms in
  `rapid-signal-writes`. That is the price of the build you develop against,
  and none of it ships.

### Fixed

- **A breakpoint on `{v}` is hit, once per update.** A JSX expression compiles
  to two things on one generated line: the call that creates the part, which
  runs once while the part is being built, and the thunk that re-reads the
  value on every update. Both carried the expression's position and a debugger
  takes the first location on a line, so the breakpoint landed on the call —
  set it and nothing stopped, step into the file and you arrived at exactly
  that line. The thunk keeps the position now and the call has none, and a
  thunk spans a point rather than a range, so one marker is drawn rather than
  two.

## [0.3.0] - 2026-09-20

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

### Security

- The Storybook integration's own lockfile still carried the vulnerable
  `@vitest/mocker` (GHSA-82fw-gwwq-j7x9): it installs outside the workspace on
  purpose, so the root upgrade never reached it. An override to `^4.1.11`
  closes it and leaves Storybook where it is — Dependabot's alternatives were
  deleting the package, which takes Storybook's test infrastructure with it, or
  a major upgrade of a development-only integration.

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

[0.6.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.6.0
[0.5.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.5.0
[0.4.1]: https://github.com/firsthandjs/firsthand/releases/tag/v0.4.1
[0.4.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.4.0
[0.3.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.3.0
[0.2.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.2.0
[0.1.1]: https://github.com/firsthandjs/firsthand/releases/tag/v0.1.1
[0.1.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.1.0
