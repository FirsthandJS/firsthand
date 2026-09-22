# Firsthand — Architecture

> Status: Phase 1 (design). This document is normative for the implementation
> phases that follow. Where a decision has performance or semantic consequences
> it is recorded as an ADR under [`docs/adr/`](docs/adr/).

Firsthand is a fine-grained reactive UI framework for the web platform. Its central
claim is structural, not rhetorical:

```
state / context / prop
        ↓
dependency graph (push-invalidate, pull-evaluate)
        ↓
only the DOM parts that actually read that state
```

A component function runs **once per component instance**. There is no virtual
DOM, no render snapshot, no hook slot table, and no dependency array.

---

## 1. Layering

```
packages/
  core/         reactive graph + owner/scope tree + context      (no DOM imports)
  dom/          DOM parts, templates, lists, portals, host adapter
  jsx-runtime/  jsx/jsxs/jsxDEV + Fragment (runtime fallback path)
  server/       the same components, rendered to markup           (server only)
  compiler/     TSX -> template + parts transform (build time only)
  testing/      test helpers (flush, mount harness, leak probes)
  deep/         reactivity that follows an object all the way down (optional)
  router/       nested routes, links, on-demand route code       (optional)
  data/         resources, actions, tag-based invalidation       (optional)
  data-axios/   Axios requests as loaders                        (optional)
  data-urql/    urql documents as loaders                        (optional)
  data-apollo/  Apollo documents as loaders                      (optional)
  styled/       CSS-in-JS over custom properties                 (optional)
  react/        React components inside Firsthand                   (optional)
  i18n/         a translation function, made reactive            (optional)
  devtools/     reads the graph the runtime already keeps    (development only)
```

`server` runs on a server: it depends on `core`, never imports `dom` and never
touches a `document`, so nothing about it is in any browser's download.

`deep`, `router`, `data`, `styled`, `react` and `i18n` are optional in the
sense that matters: an application that does not import them does not download
them, and the runtime budget below is measured without them. `devtools` is
development only — it reads the graph through hooks the production build
replaces with empty functions, and it is the one package an application should
import behind a dev-only guard, because it is not itself stripped. Only `react` has peer
dependencies, and `scripts/check-no-deps.mjs` fails if any other package so
much as imports React.

Dependency rule, enforced in CI by an import-boundary lint rule:

| package       | may import                                                  |
| ------------- | ----------------------------------------------------------- |
| `core`        | nothing                                                     |
| `dom`         | `core`                                                      |
| `jsx-runtime` | `core`, `dom`                                               |
| `compiler`    | nothing at runtime (emits imports into user code by string) |
| `testing`     | `core`, `dom`                                               |
| `router`      | `core`, `dom`                                               |
| `data`        | `core`, `dom`                                               |
| `data-*`      | `data` (and nothing of the client they bind)                |
| `styled`      | `core`, `dom`, `jsx-runtime` (types only)                   |
| `react`       | `core`, `dom`, and `react`/`react-dom` as peers             |
| `deep`        | `core`                                                      |
| `i18n`        | `core`                                                      |
| `devtools`    | `core` (types only; it reads the graph through hooks)       |

`core` must remain loadable in a worker or on the server with no `document`
present. `compiler` never ships to the browser.

### 1.1 The compiler/runtime protocol

The compiler does not have privileged access to runtime internals. It emits
calls against a small, versioned, documented surface (`@firsthandjs/dom/internal`,
carrying a `PROTOCOL_VERSION` constant). A hand-written module may emit the same
calls; the runtime cannot tell the difference. This is what makes "no
benchmark-only runtime" an enforceable property: the benchmark uses the same
public compiler and the same protocol as `examples/`.

Protocol v1 surface (final names fixed in Phase 4):

```
PROTOCOL_VERSION                  -> bumped when this surface changes
template(html, isFragment?)       -> lazily parsed <template>, cloned per instance
path(root, ...indices)            -> descend by a child-index chain
insert(parent, thunk, marker?)    -> child part (text | node | array | thunk)
applyChild / reconcile            -> the child-slot primitives insert is built on
setAttribute / setAttributeNS / setProperty / setBoolean
setClass / setClassList / setStyle / setStyleObject
applyProp / spread / mergeProps   -> the generic path, for class/style and spreads
on(node, type, handler, opts?)    -> delegated or direct listener
bind(thunk)                       -> keeps an effect only if the thunk read something
list(itemsThunk, keyFn, renderFn) -> keyed list part, returns a node thunk
createComponent(Component, props) -> instantiate; isComponent / COMPONENT
first(node) / next(node)          -> template navigation for a hydratable build
```

There is a second surface, `@firsthandjs/server/internal`, carrying its own
`PROTOCOL_VERSION`. The compiler emits against it when asked for server output
(ADR-0027): the same traversal and the same attribute rules, landing in a
runtime that builds a string rather than a tree.

```
ssr(parts, ...values)             -> the static chunks and the values between
child(value)                      -> one child position, escaped unless it is markup
createComponent(Component, props) -> instantiate, with the scope deferred
spread(values)                    -> the generic attribute path
setAttribute / setBoolean / setProperty / setClass / setStyle
escapeText / escapeAttribute      -> what the compiler inlines at build time
```

Two surfaces, one set of semantics. That is a promise, and promises rot, so it
is kept by measurement rather than by care: `packages/server/test/parity.test.ts`
renders every shape the compiler can emit both ways and compares the resulting
trees.

---

## 2. Reactive core

### 2.1 Node model

Three node kinds share one structure so the graph code stays monomorphic:

- **Signal** — a mutable cell. Has subscribers, no dependencies.
- **Computed** — lazy, memoised. Has both.
- **Effect** — eager, scheduled. Has dependencies, no subscribers.

Edges are **reusable doubly-linked `Link` objects**, not arrays or `Set`s:

```ts
interface Link {
  dep: Node;
  sub: Node;
  prevSub: Link | undefined;
  nextSub: Link | undefined; // dep's subscriber list
  prevDep: Link | undefined;
  nextDep: Link | undefined; // sub's dependency list
}
```

Rationale (ADR-0002): re-running a computed or effect re-walks its existing
dependency list in order. In the overwhelmingly common case the dependency
sequence is unchanged, so every link is _reused in place_ and the hot path
allocates **zero** objects — no `Set` rehash, no array churn, no garbage. Only
genuinely new edges allocate. Removal is O(1) through the four pointers.

### 2.2 Propagation: push invalidation, pull evaluation

A write does **not** recompute anything. It walks the subscriber graph and marks:

- computed subscribers `PENDING` ("maybe dirty") and continues through them,
- effect subscribers `DIRTY` and pushes them onto the flush queue.

A `PENDING` computed recomputes only when read, and only if one of its own
dependencies actually changed value. Equal-value writes stop propagation at the
first `Object.is` comparison. This is what makes the diamond case glitch-free
without a topological sort: the effect at the bottom runs once, and when it
pulls, every computed above it resolves to a settled value.

Update order is deterministic: effects run in the order they were queued, which
is the order in which invalidation reached them, which is the subscription order
of the graph. Writes performed during a flush append to the same queue and are
processed in the same pass, with a re-entrancy depth limit that throws
`FirsthandCycleError` instead of hanging the tab.

### 2.3 Scheduling (ADR-0006)

```ts
count.value = 1; // synchronous: dependent DOM parts update now
batch(() => {
  a.value = 1;
  b.value = 2;
}); // exactly one flush, at the end
```

Writes flush **synchronously** at the end of the outermost write or `batch()`.
A signal write never schedules a microtask.

Consequences, stated honestly:

- an event handler that writes and then reads `el.offsetHeight` sees the new
  layout — no `await tick()` ceremony;
- `n` unbatched writes in a loop perform `n` DOM passes; that is why `batch()`
  exists and why all framework-internal multi-writes (list reconcile, props
  update, context swap) are batched;
- there is no cross-frame coalescing by default. `raf(fn)` is an opt-in wrapper
  for code that genuinely wants frame alignment.

Rejected: microtask-batched-by-default (Preact/Vue style). It adds latency to
the input-to-paint path, makes "has my DOM updated yet" unanswerable without an
await, and costs measurable time in the `input event latency` benchmark.

### 2.4 Ownership and disposal

`Owner` is a plain object forming a tree **independent of the DOM**:

```ts
interface Owner {
  parent: Owner | null;
  disposals: (() => void)[] | null; // lazily allocated
  ctx: ContextRecord | null; // lazily allocated, prototype-chained
  head: Owner | null;
  next: Owner | null;
  prev: Owner | null; // intrusive child list
}
```

Components, branches, list rows and portals create owners. Disposal is one
post-order walk: run cleanups, dispose effects (unlinking every `Link` in both
directions), drop the context record, remove DOM. After disposal a component's
signals are unreachable from the graph, so they are ordinary GC garbage. Memory
tests assert this with `WeakRef` plus forced GC (ADR-0011).

---

## 3. Components

```tsx
export const Counter = component((props: ReadonlyProps<{ initial: number }>) => {
  const count = signal(props.initial);
  return <button onClick={() => count.value++}>{count.value}</button>;
});
```

`component(fn)` returns a **marker object** carrying:

- `fn` — the setup function,
- a stable build id injected by the compiler (`id`) — _not_ `Function.name`,
  which minifiers rewrite (ADR-0004),
- options (`shadow`, `tag`, attribute codec schema),
- a lazily created custom-element constructor, only if the component is ever
  used as an element host.

The identity of a component is the module-level binding itself. TSX uses real JS
symbols: `<Counter initial={10} />` compiles to `createComponent(Counter, ...)`.
No name strings anywhere in user code.

### 3.0 Element types this framework does not own (ADR-0017)

`createComponent` reads one property to decide whether the target is ours. A
function with no `setup` is not, and it is handed to an adapter installed by
`setComponentAdapter` — once per component type, cached in a `WeakMap`. With no
adapter installed, it throws `FirsthandComponentError`.

Nothing in `core` or `dom` knows what a React component is. `@firsthandjs/react/auto`
installs the adapter, and `JSX.ForeignElementTypes` — an empty interface in
`@firsthandjs/jsx-runtime` — is what lets it teach TSX about React's component
type without `jsx-runtime` naming React either.

### 3.1 Components are hostless by default (ADR-0003)

This is the most consequential deviation from "every component is a custom
element", and it exists because of a measured cost, not taste.
`document.createElement` of an upgraded custom element runs the constructor, the
custom element reaction queue and `connectedCallback`; a cloned template subtree
does none of that. Phase 10 publishes the measured per-instance delta; the
design assumes it is large enough to dominate a 100 000-row mount.

Therefore:

- **default**: a component contributes no host element. It is an owner scope
  plus the DOM its template produces. Zero platform overhead.
- **opt-in**: `component(fn, { tag: true })` or `defineElement(Counter)` gives
  the component a real custom element host, registers `firsthand-counter` (prefix
  configured once per package), exposes props as JS properties, and optionally
  maps attributes through an explicit codec schema for vanilla HTML consumers.

Both paths use the same setup function, the same reactivity, the same disposal.
The requirement "framework components can use real custom elements as a host" is
satisfied by the opt-in path; making it the default would silently tax every
application. The number is published in `PERFORMANCE_PLAN.md` and re-measured in
CI.

### 3.2 Reactive props (ADR-0005)

`<UserCard user={currentUser.value} />` compiles to a props object whose dynamic
keys are **accessor properties**:

```ts
createComponent(UserCard, {
  get user() {
    return currentUser.value;
  },
});
```

Consequences:

- `props.user` is a live read; reading it inside an effect subscribes to it,
- the exact object reference the parent passed arrives at the child — no copy,
  no `JSON.stringify`, no proxy in the production path,
- a prop change updates only the parts that read that prop; the child's setup
  function is not re-run,
- static props compile to plain data properties, so they cost no getter call,
- props are non-writable at the top level (no setter is defined), so
  `props.x = 1` throws in module/strict code.

Destructuring (`const { user } = props`) would snapshot, so the compiler
**rejects it** with an error naming the property and the live read to use
instead. Rewriting it into accessors was considered and not implemented: the
cases where it is provably safe are narrow, and a rewrite that silently stops
applying at the edge of what it can prove is exactly the failure mode this
design exists to remove (ADR-0005).

### 3.3 Immutability, honestly

Runtime JavaScript cannot simultaneously provide: identical object identity, no
proxy, no copy, no freeze, **and** enforced deep immutability. Firsthand chooses
identity and speed, and enforces immutability at the type level.
`ReadonlyProps<T>` is a deep-readonly mapped type, props objects have no
setters, and an ESLint rule flags mutation of values reached through `props`.
`Object.freeze` is never applied to user objects: freezing an object the
application also uses elsewhere is an observable, hostile side effect.

---

## 4. DOM layer

### 4.1 Templates and parts

```tsx
<div class="row">Hello {name.value}</div>
```

compiles to (shape, not literal output):

```ts
const _t = template('<div class="row">Hello <!>');
// per instance:
const _r = _t(),
  _n = _r.firstChild.lastChild;
insertText(_n, () => name.value);
```

Static markup is parsed **once** into a `<template>` and cloned per instance.
Dynamic positions are located by a compile-time-known child-index path — no
`querySelector`, no marker attributes, no runtime scanning.

Every dynamic expression compiles to a thunk. On first evaluation the runtime
observes whether the thunk read any reactive source:

- it read none: the value is written once and **no effect is retained**
  (`class={"row"}` computed from constants costs nothing afterwards);
- it read sources: a minimal effect is kept, bound to the specific setter for
  that part kind.

Part kinds are specialised at compile time and never dispatched generically at
runtime: static text, dynamic text, attribute, DOM property, boolean property,
`class` (string/object/toggle), `style` (string/object with per-property diff),
event handler, single child node, dynamic child, branch, list, component.

### 4.2 Events

Handlers are attached once, at mount, and are never re-created by a state change
(they close over signals, not over values). For the high-frequency bubbling set
(`click`, `input`, `change`, `keydown`, ...) Firsthand uses **native event
delegation** at the mount root with a per-node handler map: one real listener per
event type per root, not one per row. There is no synthetic event object —
handlers receive the native `Event`. Non-bubbling events and opt-outs
(`onClick:native`, capture, `once`, `passive`) attach directly.

### 4.3 Conditional branches

`{show.value ? <A/> : <B/>}` compiles to an ordinary dynamic child part — there
is deliberately **no** branch primitive in the protocol. The part's effect has
its own owner scope, which is cleared and rebuilt on each run, so switching
disposes the old branch with everything it created and mounts the new one.
Untaken branches hold no subscriptions and no DOM.

Two properties make that sufficient, and both are load-bearing: component setup
runs untracked, so a component created inside a branch does not subscribe the
branch to whatever its setup happened to read; and nested parts create their own
effects, so only the condition itself keeps the branch subscribed.

### 4.4 Keyed lists

`{items.value.map(i => <Row key={i.id} item={i}/>)}` compiles to a `list` part.
The algorithm is chosen by measurement, not elegance: Phase 8 implements and
benchmarks (a) longest-increasing-subsequence over a key-to-index map, (b) the
two-ended prefix/suffix scan with an LIS fallback, and (c) a naive
remove-and-reinsert baseline. The best measured profile across
append/prepend/insert/remove/swap/reverse/replace at 1k/10k/100k ships; the
others remain in the benchmark suite as references. Rows keep their DOM nodes
and their owners across reorders; only `insertBefore` calls are issued.
Duplicate keys throw in dev and are disambiguated with a warning in prod.

### 4.5 Portals

```tsx
portal(<Modal />, document.body);
```

Portal content is created under the **current owner** and then physically
appended elsewhere. Context lookup, disposal, error ownership and reactive
dependencies all follow the owner tree, so none of them notice the move. This is
exactly why context resolution must not walk the DOM.

---

## 5. Context

```ts
const ThemeContext = createContext<Theme>();
provide(ThemeContext, theme); // inside a component setup
const theme = useContext(ThemeContext); // ReadonlyCell<Theme>
```

- `createContext<T>()` returns a typed token; `useContext` returns
  `ReadonlyCell<T>`, so consumers read `theme.value` and get fine-grained
  updates.
- Lookup walks the **owner tree** once, at consumer setup time, and then holds a
  direct reference to the provider's cell. Steady-state cost of a context read
  is therefore identical to a signal read: no traversal, no DOM walk, no map
  lookup in the hot path.
- Provider records are prototype-chained objects (`Object.create(parent.ctx)`),
  so nested providers cost one property lookup at setup and nothing afterwards.
- A provider replacing its value updates the cell, so only the consuming parts
  update — whether there is 1 consumer or 10 000.
- Shadow DOM and portals are irrelevant to context by construction.
- `useContext` on a missing provider returns the token's default, or throws
  `FirsthandContextError` for a token created without one.

---

## 6. Shadow DOM (ADR-0007)

Optional via `component(fn, { shadow: true })`, and **off by default**. Reasons,
to be re-validated with numbers in Phase 10: a shadow root is an extra tree and
style scope per instance; light DOM composes with existing global CSS, with
`@container`/`:has()`, and with third-party tooling; shadow DOM forfeits
document-wide selector matching that most applications still rely on. When
enabled, styling uses constructable stylesheets (`adoptedStyleSheets`, shared per
component type rather than per instance), CSS custom properties and `::part`.

---

## 7. Error handling

`catchError(fn, handler)` installs an error boundary on the owner. Errors thrown
in setup, in an effect, or in a part evaluation propagate up the **owner** tree
(portals included), dispose the failing subtree and render the fallback.
Uncaught errors are re-thrown asynchronously so they reach `window.onerror`
instead of being swallowed.

---

## 8. Known conflicts between the requirements

Recorded now, before code, as required:

1. **"Real custom elements" vs. 100k-row performance.** Resolved by a hostless
   default plus an opt-in element host (ADR-0003). Cost published.
2. **"No classes" vs. the platform's custom element contract.** The adapter
   `class extends HTMLElement` exists, is a few dozen lines, contains no
   component logic, and is generated lazily only for components that opt into a
   tag (ADR-0004).
3. **Deep-immutable props vs. identity / no proxy / no copy.** Unsatisfiable at
   runtime; resolved at the type level (section 3.3, ADR-0005).
4. **`if (cond) { const s = signal(1) }` vs. deterministic lifecycle.** Allowed:
   primitives are values with their own identity, and their lifecycle is their
   owner's. A signal created in a dead branch is simply garbage.
5. **6 kB gzip vs. the full feature list.** Budgeted per module in
   `PERFORMANCE_PLAN.md` with tree-shaking, so an app that uses no portals,
   lists or element hosts does not pay for them. If the full bundle exceeds the
   target, the measured number is published instead of the target.
6. **100 % branch coverage vs. defensive code.** Defensive branches that cannot
   be triggered are not written. Invariants live in dev-only blocks that are
   stripped from the production build and excluded from coverage by
   construction, not by `istanbul ignore`.
