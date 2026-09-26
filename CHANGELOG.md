# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`styled` forwards `prop:` and `attr:`.** Its forwarding list is an allowlist
  — a styling prop such as `weight={3}` must not land on the element — and
  neither prefix is in `name in element`, so both were dropped without a word.
  They are not a guess about what an element accepts; they are the author saying
  which of the two to write.

  It matters most for a custom element from a component library: the element
  keeps its own state, so writing the `value` _attribute_ does nothing once
  somebody has typed in it, and clearing the field from code needs
  `prop:value`. It is also the only reliable way to reach an element that has
  not upgraded yet, which has none of its own properties for `name in element`
  to find.

### Documentation

- `ARCHITECTURE.md` said the compiler **rejects** props destructuring. It has
  rewritten it into live reads since 0.3.0, which ADR-0005 records and
  `API_DESIGN.md` describes; the architecture overview never caught up.
- `API_DESIGN.md` showed a destructuring default compiling to `props.count ?? 0`,
  which 0.12.0 changed.

## [0.12.1] - 2026-09-25

### Fixed

- **A component can put a `View` prop into an element again.** The most
  ordinary prop there is holds markup, and it did not compile:

  ```tsx
  const Panel = component((props: ReadonlyProps<{ children?: View }>) => (
    <main>{props.children}</main> // TS2322
  ));
  ```

  A component receives `ReadonlyProps`, which applies `DeepReadonly` to every
  prop. That has an exception for DOM nodes — a deeply readonly `Node` is no
  longer a `Node` — but not for the other thing a `View` can be: the
  `DynamicChild` the compiler emits for `{expression}`. Descending into one
  reached its owner, whose `disposals` and `cells` are arrays the runtime
  pushes onto, and `readonly T[]` is not assignable to `T[]` — so the prop no
  longer matched the element it came from. A fragment was unaffected, which is
  what made it look like a styling problem.

  Nothing was ever wrong at runtime: `DeepReadonly` exists only in the type
  system, and the same object is passed straight through. Any `as View` cast
  written to work around this can go.

  A part's owner is now opaque in the published type, which also keeps `Owner`
  — documented as internal to `@firsthandjs/core` — out of a signature
  applications read. Reported with a minimal reproduction and a correct
  diagnosis, which is the only reason this was a short fix.

## [0.12.0] - 2026-09-25

An external review of the framework, and what verifying it found. Ten fixes,
one new prop, and two checks so that three of them cannot come back.

A minor version rather than a patch: `error` is new API, and four of the fixes
change what working code does. None of them is a change of mind — each is a
place where the framework did something other than what it says it does — but
they are visible, so they are listed under **Changed** rather than buried in
**Fixed**.

### Security

- **A spread cannot write an attribute name it was handed.** `{...props}` is the
  one place where a runtime object decides the _names_ in the markup, and the
  names were interpolated as they arrived. An application spreading a dictionary
  it did not write — a database row, a query string, a JSON body — handed its
  author the page:

  ```tsx
  <div {...{ onmouseover: 'alert(1)' }} />        // ran, in the browser and from the server
  <div {...{ 'x onmouseover': 'alert(1)' }} />    // two attributes, server-side
  ```

  The guard that existed asked for a capital letter after `on`, which is how a
  component spells a handler and not how an attacker does. The server now writes
  only names a browser would accept, both sides refuse anything beginning with
  `on` that is not a listener, and development says which name was dropped.

### Added

- **`error` on `Router` and on a route**, shown when a lazy route's chunk fails
  to load. The route's own wins over the router's; with neither, the failure is
  thrown where the route would have rendered, so a `catchError` above the router
  sees it.

### Changed

- **A destructuring default applies to `undefined` alone**, as it does in the
  language. `({ count = 0 })` compiled to `props.count ?? 0`, so a parent passing
  `null` — which is what an API returns for "known to be empty" — got the default
  back. If you relied on `null` becoming the default, write it out.
- **A spread key spelled in lower case is no longer a listener.**
  `{...{ onmouseover: handler }}` used to attach; spell it `onMouseOver`. This is
  the security fix above, and the server could never serialize the lower-case
  form anyway.
- **`{ title: null }` removes the attribute rather than writing `"null"`.** The
  browser assigned nothing as a property and it stringified; the compiled path
  and the server both wrote no attribute.
- **Cache keys changed shape** for values `JSON.stringify` could not spell.
  Keys are an in-memory detail, so this costs a cold cache and nothing else.

### Fixed

- **`stableKey` no longer gives two different requests the same key.** It
  leaned on `JSON.stringify`, which answers `null` for anything it has no
  syntax for and `undefined` for anything it refuses — so `NaN`, `Infinity` and
  `null` were one key; a `Map`, a `Set`, a `RegExp` and `{}` were another; a
  function or a symbol was a third; a BigInt threw; and a value containing
  itself blew the stack. A colliding key is worse than a missing one, because
  it serves one caller the other one's answer.

  Maps and Sets are now read through, in a stable order; a `RegExp` keys by its
  source and flags; a BigInt keys as `1n`; a function or a symbol keys by
  identity, so the same one is the same request and two are not; and a cycle
  keys as `[cycle]` rather than recursing. The same object appearing twice is
  still two ordinary occurrences — only an object inside itself is a cycle.

- **A spread means the same thing on both sides.** Every shape a spread accepts
  is decided by a runtime object, and the server answered four of them
  differently from the browser — so the markup arrived wrong and the client
  corrected it after the page had been painted:

  | spread                        | server, before        | browser                     |
  | ----------------------------- | --------------------- | --------------------------- |
  | `{ class: { open: 1 } }`      | no class (`=== true`) | `class="open"` (truthiness) |
  | `{ style: { color: 'red' } }` | nothing at all        | the style applied           |
  | `{ 'prop:value': 'x' }`       | `prop:value="x"`      | the `value` property        |
  | `{ 'attr:data-x': 'y' }`      | `attr:data-x="y"`     | `data-x="y"`                |

  The server now uses the same `classValue`, `styleValue` and `property` its
  compiled path already used; the spread was the one path that disagreed with
  the rest of the server.

  The browser was wrong about one of them: `{ title: null }` was assigned as a
  property and stringified into `title="null"`, where both the compiled path
  and the server write no attribute. Nothing is now an attribute that is not
  there, on both sides.

- **A spread cannot write an event handler any more.** `{...props}` is the one
  place where a runtime object decides the attribute _names_ in the markup, and
  the names were passed through as they arrived. An application that spread a
  dictionary it did not write — a database row, a query string, a JSON body —
  handed whoever wrote that dictionary the ability to run script on the page:

  ```tsx
  <div {...{ onmouseover: 'alert(1)' }} />
  ```

  The browser ran that, and the server serialised it. Worse, on the server a
  key containing a space (`'x onmouseover'`) became two attributes, so a name
  could open one the markup never had — where the browser had thrown on the
  same name, which meant the two sides also disagreed about what the markup
  was. The old guard asked for a capital letter after `on`, which is how a
  component spells a handler and not how an attacker does.

  Now: the server writes only names that look like attribute names, both sides
  refuse anything beginning with `on` that is not a listener, and development
  says which name was dropped. `onClick={handler}` and `on:sl-change` are
  unaffected — they never became attributes. A spread key spelled in lower case
  (`onmouseover={handler}`) no longer attaches a listener; spell it `onMouseOver`.

- **A destructuring default no longer swallows `null`.** The compiler rewrote
  `({ count = 0 })` into `props.count ?? 0`, and `??` answers for `null` as
  well as `undefined`. The language defaults on `undefined` alone, so a parent
  passing `null` — which is what an API returns for "known to be empty" — got
  the default back instead of the null it asked for. The emitted read is now
  `props.count === undefined ? 0 : props.count`. Per-read re-application is
  unchanged.

- **Concurrent actions no longer share one invalidation list.** What a run
  declared through `invalidates()` was recorded on the action rather than on
  the run, and starting a run cleared it. Under `concurrency: 'all'` that meant
  a run which declared its tags and then kept working lost them to whichever
  run started next: the tag it named was never invalidated, and the other run's
  tag was invalidated twice. Renaming two things at once is enough to hit it.

- **`running` stays true across a queue.** Under the default `queue`, a second
  run waiting behind the first was not counted as running, and the run that
  finished cleared the flag before the next one set it again — so anything
  watching `running` saw `false` in between and a spinner blinked between two
  runs the person made as one gesture. A queued run now counts from the moment
  `run()` is called, and settling a run reports its own departure in the same
  batch.

### Added

- **`error` on the router and on a route**, shown when a lazy route's chunk
  fails to load. The route's own wins over the router's; with neither, the
  failure is thrown where the route would have rendered, so a `catchError`
  above the router sees it.

### Fixed

- **A failed lazy route no longer pends for ever.** `lazy()` rejecting went
  into an unhandled rejection: the pending view stayed on screen with no reason
  given and nothing behind it, and because the failed attempt was remembered,
  navigating there again never asked a second time. A failure is now reported
  and forgotten, so the next navigation retries — which matters because the
  usual cause is a deploy replacing the build under an open document.

- **A hash navigation is reported once.** `push` wrote `window.location.hash`
  and set the location itself; the browser then fired `hashchange` for that
  write and the handler set it again, with a second key. Everything watching
  ran twice for one navigation — the route matched twice, an effect on
  `location.key` fired twice, a page view was counted twice. A hashchange that
  lands where the location already is is no longer news. (jsdom does not fire
  `hashchange` by itself, which is why the tests never saw it.)

- **`basename` is a path segment, not a string prefix.** With
  `basename="/app"`, the URL `/apple/pie` was stripped by length to `le/pie` —
  a path no route matches, from a URL that has nothing to do with the
  application. Only `/app` itself and what follows `/app/` are stripped now.

## [0.11.1] - 2026-09-23

### Fixed

- **A run that returns a fragment leaves nothing behind.** Since 0.10.1, a run
  returning one fragment and then another kept both on screen: the branch it
  left was never disposed, its cleanups never ran, and its nodes stayed in the
  page beside the new ones. A run returning a single element was unaffected,
  which is what named the cause.

  It was the #47 fix, one wrapper too deep. A kept child is already a part, and
  `compileChildren` wraps every dynamic child in `part(() => …)` — so the site
  was looked up when that thunk ran, which is _after_ `ran` has ended the run
  that made it. The site was stamped with the next run's generation, and the
  next `ran` read a branch the run had left as one it had just reached. The
  wrapper is taken off now, so the site is looked up while the run is running,
  and there is one less part per kept child.

### Changed

- **The packages no longer claim provenance they do not have.**
  `publishConfig.provenance: true` is published in the manifest, where anyone
  can read it, and no version has ever carried an attestation — every release
  has gone out by hand, where npm refuses to publish at all unless provenance
  is explicitly switched off. The flag is gone: the release workflow asks for
  provenance with `npm publish --provenance` and `npm run check:provenance`
  reads it back off the registry afterwards, so it is something a release
  earns rather than something a package asserts about itself (#50).

  Nothing about the code changed, and nothing an application imports moved.
  What changed is that the metadata is true.

## [0.11.0] - 2026-09-23

### Added

- **`@firsthandjs/compiler/plugin`**, the Babel plugin with nothing around it.
  The main entry imports `@babel/core` and is for Node; this one imports
  `@babel/types` and is for anywhere else — `@babel/standalone` in a browser
  tab, which is what the playground compiles with.

- **A styled component hands its element to a `ref`.** `ref` is in no
  element's prototype, and the rule deciding which props reach the DOM asks
  exactly that — so `<Host ref={…} />` on a styled component was dropped in
  silence, and a styled wrapper was the one element you could not reach. Which
  is the first thing an editor, a canvas or a `<video>` needs. Found while
  mounting Monaco in the playground.

### Changed

- **The compiler runs in a browser.** Module ids were hashed with
  `node:crypto`, the one thing in the package a browser does not have. They are
  hashed with FNV-1a now: the same eight hex characters, the same collision
  space, the same value every time for one input, and an identity rather than a
  checksum — which is all the id ever was. A test asserts that no module in the
  package reaches for a Node built-in, because one import would quietly undo it.

  **The ids themselves change**, which is what an id derived from a different
  hash does. They are internal — devtools names and the compiler's own
  bookkeeping — but a server rendered by one version and hydrated by another
  would disagree, as it would across any version. Compile both sides with the
  same one.

## [0.10.1] - 2026-09-23

### Fixed

- **A component inside a fragment keeps its site.** A run keeps the children
  it makes — made once, handed back, fed through cells — except where the
  child stood inside a fragment. A dynamic child is emitted as
  `part(() => …)`, and the compiler read that arrow as a scope of its own, so
  markup inside it belonged to no run and was built again every time. Every
  card, every lane and the frame around them were replaced on a change that
  moved one card, and a run local given to such a child was read once and then
  stale for ever. The wrapper is now stepped over exactly when the code that
  creates it runs again; a list's rows are untouched, because a row sits in a
  callback the author wrote. ADR-0026 gains the other half of its rule:
  anything a run makes once should be made once (#47).

## [0.10.0] - 2026-09-23

### Changed

- **SOLID and clean-code rules, enforced rather than described.**
  `docs/architecture/code-rules.md` is the canonical page and ESLint is what
  holds the line: 300 lines a module, 50 a function, 30 statements, a
  complexity of 12, four parameters, four levels of depth — all counted with
  blank lines and comments skipped, so that explaining a decision in prose
  never costs anything. `npm run check:arch` adds what a linter cannot see:
  package layering, import cycles, module surface, and a running total of
  every `eslint-disable` in the repository. An escape hatch exists for four
  named things and each use carries its reason.

- **Imports are absolute.** `../` is refused; a package's own modules are
  reached through `@/`, which resolves to that package's `src/`. Where it does
  not reach — the compiler, which Vite must load before any plugin exists —
  the page says so and says why rather than leaving an exception to be found.

- **The code was refactored to meet the rules.** The compiler's 2576-line
  `transform.ts` became seventeen modules behind a barrel; `packages/dom`'s
  insert path became four; `Link` and `Cell` left `core.ts` for files of their
  own, as did the error classes in `dom` and `data`. Nothing an application
  imports moved: every published entry point resolves and `PROTOCOL_VERSION`
  is unchanged.

- **What the limits cost is written down.** Bringing `dom` under the function
  and complexity limits cost 0.25 kB gzip, and the class split 26 bytes more:
  the full runtime is 7.49 kB against a 7.50 kB budget, with seven bytes of
  headroom. The number is in `code-rules.md` §6 beside the budget it spends,
  because a budget nobody can see is not one.

### Fixed

- **A keyed list over a run local keeps its rows.** A list whose data comes
  from the run — `shown.map(…)` where `shown` is a local — made the list again
  on every run, so every row lost its identity and its state. The data now
  arrives through a cell the run writes while the list itself is made once,
  which is the only arrangement in which a list that reuses rows has rows to
  reuse (#40).

## [0.9.1] - 2026-09-22

### Fixed

- **A keyed row may be a view.** A component's setup may return a render
  function; as a list's row, that function was written into the page as its
  own source. `collect` walked a row's result for nodes and had no branch for
  a function. A row that is a view is now a part: anchored, bound under the
  row's own owner, and — under hydration — placed where hydration has got to,
  so it adopts the row the server sent rather than replacing it.

- **A part is mounted once, however often the run hands it back.** A run that
  keeps what it made hands back the same object every time it runs. Where that
  is a component in the run's markup, the part was mounted again on every run:
  a second copy of the whole component beside the first. It showed up in the
  starter project as a panel that appeared twice as soon as its resource
  answered.

- **A child a run gives a component follows the run.** Props fed from a run's
  locals go through a cell; children did not, so `<Box>{n}</Box>` showed
  whatever `n` was on the first run, for ever, while `<Box label={n} />`
  updated. It was silent — the page rendered and a branch simply never
  changed. ADR-0026 gains the general rule: anything a run hands to something
  built once goes through a cell.

### Changed

- **The benchmark rotates the framework order.** A measurement ends by forcing
  layout, and what that costs depends on what the previous framework left the
  page in — a systematic cost handed to whoever runs first. Measured both
  ways: fixed order with Solid first gives 1.180 (CI 1.098–1.276), rotated
  gives 1.127 (CI 1.054–1.210). Rotating produces the lower number, which is
  the point of doing it.

- **`bench:latency`**, for the two sub-millisecond scenarios that a geometric
  mean weighs as heavily as a ten-thousand-row update. Both hypotheses it was
  built to test are refuted: a portal costs nothing measurable, and a
  delegated listener is faster than a direct one, not slower. Nothing was
  optimised on the strength of them, which is what the measurement was for.

- **Published sizes are reproducible.** Brotli is compressed with parameters
  asked for by name, and the README check holds the file to minified and gzip
  — two builds of the same Node major disagree on brotli by a few bytes, and a
  README is not wrong for having been written on another platform.

## [0.9.0] - 2026-09-22

### Added

- **Server rendering, as a second compiler target.** `@firsthandjs/server`
  renders an application to markup: the same components, the same signals, the
  same context, compiled against a runtime that builds a string instead of a
  tree. Nothing in an application is written for a server — Vite already knows
  which build it is running, and the compiler plugin asks it.

  ```tsx
  const html = renderToString(() => <App />);
  ```

  Every shape the compiler can emit is supported, and that is asserted rather
  than claimed: `packages/server/test/parity.test.ts` renders thirty fixtures
  both ways and compares the resulting trees — components, view functions,
  render functions, keyed lists, context, fragments, spreads, attribute and
  property bindings, custom-element hosts and data.

- **Hydration, which adopts rather than rebuilds.** `@firsthandjs/dom/hydrate`
  takes over markup a server sent: every element is adopted, every text node
  kept, and the only writes are the listeners and the properties markup cannot
  express. `tests/browser/ssr.spec.ts` asserts it in Chromium, Firefox and
  WebKit with a `MutationObserver` installed before any script the page
  carries — **not one element the server sent is replaced**.

  It is its own entry point on purpose. Nothing in the render path imports it,
  so a bundle that never mentions it does not contain it: the runtime budget is
  the 7.00 kB gzip it was before server rendering existed, and hydration is
  2.0 kB that only an application with a server downloads.

- **Data that crosses the wire.** `renderToStringAsync` waits for what a render
  started; `createMemoryStorage` and `serialize` carry the answers into the
  page; a **named** resource finds its value during its first run in the
  browser, so the first paint is the markup rather than a spinner replacing it.
  A resource has no key to be serialised under — that is ADR-0022 — but
  `persist` is a name the application already chose.

- **An SSR example.** `examples/ssr` is its own project: an application, two
  entry points, and a server in eighty lines of `node:http`. The page shows how
  many requests the process that rendered it has answered, which is the honest
  way to demonstrate that the browser made none of its own.

### Changed

- **A scope is created when something needs one, not before.** A component that
  makes nothing — no signal, no effect, no context, no cleanup — has nothing to
  take apart, and on a server most components are exactly that. `deferOwner`
  in the core describes the scope; the first `provide`, `signal`, `onCleanup`
  or `catchError` makes it. Worth a sixth of a server render.

- **A third variant in `bench:runs`, and a number that was an estimate.** The
  performance guide said hoisting a run's site lookups was worth "about 20 %"
  on the strength of a hand-written stand-in. It now says 1.21× on the update
  path and 1.36× on the heap, because a third variant measures it in the same
  session, through the same published protocol, against the same twenty sites
  — and it says what doing it would take: only the sites a run reaches
  unconditionally can be hoisted, because the sweep that disposes what a run
  did not reach uses those very lookups to know.

- **A new benchmark, and a decision it made.** `npm run bench:deep` measures
  one label changed in ten thousand rows, with the clock stopped before and
  after the browser is made to lay the page out again. It says two things.
  The scenario is **94 % layout** — the framework's share is under two
  milliseconds either way. And `deepSignal` already does for this what a store
  does: 0.008 ms against 1.850 ms, at 1.6× the cost of mounting. So the answer
  to the one scenario Firsthand loses is a tool that already exists, not a new
  list API.

- **A keyed list reads its keys once per pass, not once per row.** Reading a
  key must not subscribe the list to whatever the key function touches, which
  is as true of ten thousand keys read together as of one read alone — but a
  closure and a save/restore per row is ten thousand of each, for a list that
  is redrawn whenever one row changes. And the array it produces is handed to
  the child slot as it stands rather than walked a second time: the list has
  already done that walk. `mount-10k` 382.8 ms to 364.3 ms, `swap-rows-10k`
  35.8 ms to 29.8 ms, `append-1k-to-10k` 74.3 ms to 63.3 ms.

- **A row that leaves a list does not take itself apart first.** The
  reconciler removes a dropped row's nodes in one go, and everything the row's
  own parts put inside them goes with them — so removing each of those first
  is work with no effect. Measured at 15 ms of the 46 ms it took to clear ten
  thousand rows, and the same whether it happened before or after the rows
  were detached. `clear-10k` 46.5 ms to 38.1 ms, `clear-1k` 4.3 ms to 3.6 ms,
  which is now faster than Solid rather than slower. Nothing else is excused:
  a part whose parent might outlive it still cleans up after itself, which is
  what `discard.test.tsx` pins down.

- **Emptying a list is one call, not ten thousand.** Clearing a table removed
  every row individually; when the slot being emptied _is_ the parent's whole
  content — no marker after it, nothing beside it — the platform has one call
  that says so. Measured on `clear-10k`: 50.8 ms to 46.5 ms, and `clear-1k`
  5.0 ms to 4.3 ms. The rest of that scenario's gap to Solid is the disposal
  order, which is the next thing to be measured rather than the next thing to
  be claimed.

- **`class={[...]}` is a list of names.** It used to be read as a record of
  flags, which toggled the classes `0` and `1`. Found by the parity suite,
  which noticed that the server and the browser disagreed about it — and they
  disagreed because the browser was wrong.

- **`ReadonlyProps` stops at a DOM node.** `readonly children?: View` followed
  by `<aside>{props.children}</aside>` did not type-check: a deeply readonly
  `Node` is not a `Node`. Recognised structurally, so the rule holds where
  there is no DOM at all.

- **The benchmark measures Solid and Vue as well as React.** React alone is the
  model most readers know, but it is not the hardest test: Solid makes the same
  bet from the other direction — fine-grained reactivity and a compiler — and
  Vue's template compiler is good enough that a hand-written `h()` version would
  have flattered us. Each implementation is written the way its own
  documentation writes it, all four are verified to render the same DOM before
  anything is timed, and the result is published as measured:

  - **React 19.2.0**: geometric mean 1.589× (95 % CI 1.240–2.164) — the interval excludes 1.0.
  - **Solid 1.9.15**: geometric mean 1.040× (95 % CI 0.925–1.162) — the interval includes 1.0, so **no advantage is claimed**.
  - **Vue 3.5.43**: geometric mean 1.336× (95 % CI 1.087–1.647) — the interval excludes 1.0.

  Firsthand was the fastest of the four, or level with whoever was, in 16 of 27
  scenarios. Memory after disposal and cold start are published for all four as
  well.

  At 100 000 rows the losses are Solid's wins: it clears the table 1.14× faster
  and updates every tenth row 1.05× faster, and the geometric mean over those
  three scenarios is 0.932× — below 1.0, with an interval that
  includes it. Firsthand mounts 100 000 rows 1.11× faster than Solid and
  3.88× faster than React across the three.

  Two things about the harness had to change, and both are in
  `benchmarks/README.md`: the measurement is **awaited**, because Vue's
  scheduler flushes on a microtask that cannot be drained synchronously and a
  synchronous clock would have credited it for work it had not done; and
  `class=""` is treated as equal to an absent `class`, which is the one
  difference in rendered markup the equality phase accepts, because Vue
  normalises an empty class binding to a string. Nothing else is normalised.

  Solid and Vue live in `benchmarks/frameworks` with their own install:
  `babel-preset-solid` wants Babel 7 and this repository is built on Babel 8,
  and giving them their own `node_modules` means neither toolchain has to be
  bent to fit the other.

## [0.8.0] - 2026-09-21

### Added

- **A setup may return a render function.** A setup runs once, so a view chosen
  in it was chosen for ever — and the only answer this framework had was a
  build error. Now there is somewhere to put an `if`:

  ```tsx
  const Guarded = component(() => () => {
    if (token.value === null) {
      return <Navigate to="/sign-in" />;
    }
    return <Page />;
  });
  ```

  It is not a second rendering model. It is the rule this framework already
  had, one level up: **every function you write is a reactive scope, and JSX
  beneath it makes the smallest scopes it can — as long as they need nothing
  from the run that made them.** A component returning markup is exactly a
  render function with an empty body, and nothing about it changed.

  What a run does to the DOM: a site is built once and written afterwards, so a
  run that keeps the same branch keeps the same nodes, along with focus, the
  caret and whatever was half typed. A branch the run stops returning is
  disposed — cleanups fire, parts stop, coming back builds it again — because
  that is what the control flow says.

  Where markup stands is what identifies it, including inside an `if`, so there
  is no ordering rule of any kind. Markup that appears many times from one
  place needs a `key`, and the compiler insists.

  [ADR-0026](docs/adr/0026-a-function-is-a-reactive-scope.md) has the design,
  the rejected alternatives and the three measurements that changed it.

- **A plain function that returns markup is a view.** No `component()`, because
  it has nothing to hold:

  ```tsx
  function Badge({ kind }: { kind: string }) {
    return <span class={kind}>{kind}</span>;
  }

  <Badge kind={status.value} />; // a scope of its own, with a place of its own
  ```

  Written as a tag it is a reactive scope; called, it is a function call and
  behaves like one. `component()` now means one thing: _this view needs a
  setup_.

  The boundary is which compiler translated the markup. A function this
  compiler compiled markup into is marked as ours, and `createComponent` reads
  that mark **before** it reaches for an adapter — so a React component in the
  same project, built with React's own transform, still goes to
  `@firsthandjs/react`. Found by the framework's own test suite, which declares
  React components in compiled files and broke the moment the rule was too
  broad.

- **`include` and `exclude` for the Vite plugin**, as regular expressions:

  ```ts
  firsthand({ packageName: 'my-app', exclude: [/\/legacy\//] });
  ```

  How a project says _these files are not mine_, which is what a migration
  needs. What this compiler does not compile, it does not claim.

- **Two diagnostics, in development only.** A run that keeps running and keeps
  writing nothing is doing work for nobody:

  ```
  <OrderTable> ran 20 times and wrote nothing.
  Something it reads in a statement changes more often than what it shows.
  ```

  And the `useCallback` problem, named rather than papered over: a handler made
  in a run is a new function every time, so a child it is passed to runs again
  whenever its parent does. Nothing is optimised behind your back — this is
  bookkeeping, said out loud.

### Changed

- **A part no longer writes text that has not changed.** `insert` remembers the
  string it last wrote and compares against that. Worth about **2x** on the
  ordinary case where an object changes and most of what is derived from it
  does not. It has to be a remembered value: comparing against the DOM instead
  — reading `text.data` back — measured _slower than not comparing at all_.

- **`on()` replaces a direct listener rather than adding one.** Delegated types
  always replaced, by assignment; the non-delegated ones (`wheel`, `scroll`,
  `focus`, the drag events) stacked. A handler re-attached on every run would
  have left one listener behind per run. Keyed by the options as well as the
  type, so `onClick:native` and `onClick:once` on one element stay two
  listeners.

- **`View` includes `Render`**, which is `() => View`. A setup that returns a
  function is now what the type says it is.

- **The bundle budget is 7 kB gzip, from 6.** The full runtime is 6.32 kB. The
  new functions are separate exports, so an application that never returns a
  render function does not pay for them; the figure that moved is the
  everything-imported one.

### Performance

`npm run bench:runs`, recorded in `benchmarks/results/render-functions.json`.
1000 components of 20 sites derived from one signal, both compiled by the real
compiler and both verified to render 20 000 nodes before timing:

|                       | mount        | update       | heap       |
| --------------------- | ------------ | ------------ | ---------- |
| a site per expression | 31.40 ms     | 11.435 ms    | 14.0 MB    |
| one render function   | **20.70 ms** | **8.355 ms** | **8.8 MB** |

1.52x, 1.36x and 1.59x, and most of it is arithmetic on effects: twenty
subscriptions and twenty reads of one signal become one of each.

The shape is the point, and it cuts both ways: twenty sites with twenty
_independent_ sources is the opposite case, and there the fine-grained form
wins. The classification means a component that mixes the two gets both
behaviours without anyone choosing.

## [0.7.1] - 2026-09-21

### Fixed

- **An invalidation is no longer lost when the tags arrive after the answer.**
  0.7.0 forces a run whose tags match an invalidation nobody was alive to
  receive, and it works because a client declares a document's tags _before_ it
  looks in its cache. A loader that cannot do that — one that only learns what
  it fetched from the reply — got the worst of both halves:

  ```ts
  useResource(async ({ request, tags }) => {
    const thing = await api.get('/things/current')(request); // served from cache
    tags(tag('thing', { id: thing.id })); // …and only now is it known what this is
    return thing;
  });
  ```

  The cache entry carried no tags, so `forgetTagged` could not find it. The
  lookup happened with `force` still false, so the stale answer was served. The
  store then raised `force` — too late, nothing was left to read it — and
  `settled` credited the run with having been to the server, which threw away
  the debt for every other resource as well.

  The store now notices that a client had already asked why it was running when
  the tags turned up, and marks the run superseded: it goes again with `force`,
  which is the same path an invalidation arriving mid-flight has always taken.
  A superseded run no longer settles anything, because it never went to the
  server.

  One extra request in that case, and only when an invalidation actually
  matches. A loader that declares its tags first — every client this project
  ships — is untouched.

## [0.7.0] - 2026-09-21

### Fixed

- **An invalidation now reaches the resource that did not exist yet.** A board
  list is on screen and loads; you open a board and move a card, which
  invalidates `boards` — and nothing is watching the list, so it reaches
  nobody; you walk back, which _creates_ a resource rather than reloading one,
  and the cache hands it the answer from before the move. Every layer did what
  it was told and the counts were wrong.

  The store now remembers what it invalidated for a minute. A run whose tags
  match an invalidation it never saw is forced, which is what makes it reach
  past a cache — once. As soon as a run with those tags succeeds, the memory
  is dropped, so one invalidation cannot force every resource created in the
  next minute.

  ```ts
  createData({ remember: 60_000 }); // the default; 0 restores 0.6.x exactly
  ```

  Nothing changes at a call site, and no client needed a new hook: they
  already declare a document's tags before they read their cache.
  [ADR-0024](docs/adr/0024-an-invalidation-outlives-its-reader.md) has the
  alternatives, including the one that would have put tags in the transport.

  `DataRequest.force` is a **getter** now rather than a field, because
  declaring tags can raise it. Anything that read it still reads it; anything
  that copied it into a variable before the loader declared its tags should
  read it later instead.

### Added

- **An invalidation can empty the cache, not just outrun it.** The half above
  makes the _next_ reader pay for a stale entry; this drops it where it stands:

  ```ts
  const cache = createCacheClient({ ttl: 30_000 });
  const store = createData({ caches: [cache] });
  ```

  A cache entry now keeps what its request said it was about, and
  `store.invalidate` calls `forgetTagged` on the caches it was handed. The tags
  are **metadata on the entry, never the key** — identity is still the scope
  and the request, which is the distinction
  [ADR-0022](docs/adr/0022-resources-not-a-cache.md) exists to protect and
  [ADR-0025](docs/adr/0025-tags-as-cache-metadata.md) spends its length
  defending.

  A cache that is not passed is not touched, which is the right default for a
  transport's own: Apollo's and urql's caches are theirs, and `force` stays the
  only contact with them.

- **The compiler refuses a view that is chosen once.** This compiled, ran, and
  looked like a broken button:

  ```tsx
  const Panel = component(() => {
    const open = signal(false);
    return open.value ? <Form /> : <Button />; // decided at setup, for ever
  });
  ```

  A setup runs one time per instance, so the branch that was true then is the
  only one that will ever appear. In a child position the same expression is a
  part:

  ```tsx
  return <>{open.value ? <Form /> : <Button />}</>;
  ```

  `strictReactivity` now reports the first form — for a **signal read**, for
  `&&` as well as `? :`, and for the short `component(() => cond ? a : b)`
  form. A branch on something that does _not_ change is left alone, as is a
  return with no markup in it. It was written after making this exact mistake
  three times in one afternoon while building the kanban showcase; the third
  one took twenty minutes to find.

  **What it does not catch**, because the check is syntactic and looks for
  `.value`:

  - **Props.** `props.open ? <A /> : <B />` in a return position is not
    reported. It was, in an earlier build, and it flagged a recursive
    component branching on `props.depth` — which is correct code, because that
    prop is fixed for the life of the instance. A false positive stops a
    build, so the rule was narrowed to the case it can be sure about.
  - **`deepSignal`.** `state.open ? <Form /> : <Button />` is every bit as
    reactive and has no `.value` in it to find.

  So the honest claim is that Firsthand now catches an important class of
  setup-time view mistakes, not that the mistake has become impossible. The
  guide says which class.

## [0.6.3] - 2026-09-21

### Fixed

- **Drag and drop, blur and focus are typeable in TSX.** `FirsthandAttributes`
  listed fourteen `on…` handlers and none of the drag ones, so the ordinary way
  to move a card between columns — `draggable` plus `onDragStart`, `onDragOver`
  and `onDrop` — was a type error, as were `onBlur`, `onFocus`,
  `onContextMenu`, `onWheel`, `onScroll`, the clipboard events and the pointer
  events beyond down and up. All of them are declared now.

  Found the same way `slot` was in 0.6.1: by building a kanban board with the
  published packages.

- **An action's answer no longer lands in the cache.** `force` kept an action
  from being _answered_ out of the cache; nothing kept its answer from being
  _written_ into one. So a `GET` that changes something — a
  `/reports/recalculate` endpoint, which is how plenty of real APIs are shaped
  — left its result under that URL, and the next resource asking for it was
  served the answer to somebody's button press. A `cacheKey` on a write did
  the same thing.

  A request now says whether it is `mutating`, and an action's is. Every
  client and the cache treat that as _run this and remember nothing_: not
  served from the cache, not written to it, and not shared with another
  identical write in flight, whatever the method and whatever key the call
  carries.

  ```ts
  // Both of these go to the server, every time, and neither is kept.
  useAction((id: string, { request }) => api.get(`/orders/${id}/recalculate`)(request));
  useAction((body: Draft, { request }) =>
    api.post('/send', { json: body, cacheKey: 'send' })(request),
  );
  ```

  A cache holds representations. What an action gets back is the answer to
  _doing_ something, and the two are not the same thing —
  [ADR-0023](docs/adr/0023-one-cache-at-the-transport-edge.md) now says so
  where it can be found.

## [0.6.2] - 2026-09-21

### Fixed

- **A cache key is an identity and a request.** `GET /api/me` is the same URL
  for every account, so a key made of method and URL alone could serve one
  account's answer to the next one in the same session — the worst failure a
  cache has, because nothing looks wrong on the way to it.

  Every client now prefixes its keys with the identity the answer belongs to,
  defaulting to the `authorization` header the request would carry. Signing in
  as somebody else changes the header, so it changes the key:

  ```ts
  const api = createFetchClient({
    headers: () => ({ authorization: `Bearer ${session.token.peek()}` }),
    cache: { ttl: 30_000 },
  });
  ```

  For a session that is not a header — a cookie, a tenant, an account picker —
  `scope` says what it is instead:

  ```ts
  createFetchClient({ init: { credentials: 'include' }, scope: () => account.value.id, … });
  ```

  `client.cache?.forget()` on sign-out is still worth doing, because it frees
  the memory. The difference is that forgetting to is no longer a correctness
  bug.

- **The Axios client keyed reads by URL alone**, and Axios keeps the query
  string in `params` rather than in the URL — so page 1 and page 2 of a list
  were one entry, and the second read was answered with the first one's rows.
  Keys now include `params`.

### Added

- **`stableKey(value)`** — a key for a value that does not depend on the order
  its properties were written in. It is what the clients build their keys with,
  and it is exported because a `cacheKey` written by hand needs the same
  property: it must carry everything that varies, the body included.

  ```ts
  api.post('/search', { json: body, cacheKey: `search:${stableKey(body)}` });
  ```

### Documentation

- The [data guide](docs/guide/09-data.md) has a section on whose answer a
  cached one is, and [ADR-0023](docs/adr/0023-one-cache-at-the-transport-edge.md)
  records the decision and the collision that prompted it.
- The risk register said props destructuring was a build error. It has been
  rewritten into live reads since ADR-0005 was reversed; R8 now says what the
  compiler actually does, and which patterns are still errors.

## [0.6.1] - 2026-09-21

### Fixed

- **`slot` is allowed in TSX.** `Element` declares `slot` as a property, so it
  was excluded from an element's own attributes along with the rest of
  `keyof Element` — and never declared as a global beside `id`, `class` and
  `role`. The result was that

  ```tsx
  <wa-button>
    <wa-icon slot="start" name="plus" />
    Add
  </wa-button>
  ```

  — the ordinary way to fill a web component's slot, and the first line anybody
  writes against Web Awesome, Shoelace or any other component library — was a
  type error. It affected every element, not only custom ones.

  Found while building the kanban showcase against 0.6.0, which is what a
  showcase is for.

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

[0.12.1]: https://github.com/firsthandjs/firsthand/releases/tag/v0.12.1
[0.12.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.12.0
[0.11.1]: https://github.com/firsthandjs/firsthand/releases/tag/v0.11.1
[0.11.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.11.0
[0.10.1]: https://github.com/firsthandjs/firsthand/releases/tag/v0.10.1
[0.10.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.10.0
[0.9.1]: https://github.com/firsthandjs/firsthand/releases/tag/v0.9.1
[0.9.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.9.0
[0.8.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.8.0
[0.7.1]: https://github.com/firsthandjs/firsthand/releases/tag/v0.7.1
[0.7.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.7.0
[0.6.3]: https://github.com/firsthandjs/firsthand/releases/tag/v0.6.3
[0.6.2]: https://github.com/firsthandjs/firsthand/releases/tag/v0.6.2
[0.6.1]: https://github.com/firsthandjs/firsthand/releases/tag/v0.6.1
[0.6.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.6.0
[0.5.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.5.0
[0.4.1]: https://github.com/firsthandjs/firsthand/releases/tag/v0.4.1
[0.4.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.4.0
[0.3.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.3.0
[0.2.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.2.0
[0.1.1]: https://github.com/firsthandjs/firsthand/releases/tag/v0.1.1
[0.1.0]: https://github.com/firsthandjs/firsthand/releases/tag/v0.1.0
