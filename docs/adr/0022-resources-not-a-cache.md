# ADR-0022: Resources and invalidation, with the cache one layer down

**Status:** accepted · 2026-09-21 · supersedes the transport half of
[ADR-0014](0014-tag-based-cache-invalidation.md)

## Problem

`@firsthandjs/query` grew into something it was never meant to be. Alongside a
store of loaded data it ships a REST fetcher, a GraphQL transport and the
hooks that bind them — and although that is 78 lines out of 1524, it reads as
"a framework with its own HTTP and GraphQL clients". Two questions follow,
and they were asked:

1. **Is transport our job at all?** Axios and Apollo exist, they are good, and
   competing with them means opening a drawer we cannot keep closed —
   interceptors, retries, token refresh, progress, one request at a time.
2. **Whose cache is it?** An application bringing Apollo brings a normalised
   cache. Two caches over the same data is not merely wasteful; they disagree,
   and the disagreement surfaces as a bug nobody can reproduce.

While answering them, a third problem turned up that settles the first two.
**Identity was derived from tags, and that silently serves the wrong data.**
Measured on 0.4.0:

```tsx
const users = useQuery(() => ({ tags: [tag('directory')], fetch: loadUsers }));
const teams = useQuery(() => ({ tags: [tag('directory')], fetch: loadTeams }));
```

```
sources called: ["users"]      ← loadTeams never ran
users sees: ["Ada","Grace"]
teams sees: ["Ada","Grace"]    ← the other query's data
entries in the store: 1
```

Coarse tags are not a misuse: a tag exists so that one invalidation can reach
a whole category across different sources. The design made the reasonable use
of the feature corrupt the data, without an error.

## Constraints

- **Nothing may be required of the caller for identity.** A key, a name or a
  variables object is a thing to forget, to mistype, and to collide on in a
  codebase nobody can hold in their head.
- **Dependencies must be found the way `effect` finds them.** Reading a signal
  or a prop inside the loader is what makes it reactive. Passing values through
  a `variables` bag is ceremony and drifts from what is actually read.
- **Tags are for invalidation only.** They may be coarse, they may overlap, and
  two unrelated sources may share one. That is the feature.
- **A loader is arbitrary code.** A `fetch`, an Apollo call, a worker, an
  algorithm that never leaves the browser. The store may assume nothing.
- **A developer must not be made to build a state model.** "Bring your own
  client and wire it up" is Redux by another name, which is what the industry
  spent a decade escaping.

## Options

1. **Keep everything: store, transport, cache, in one package.** What React
   Query does, and it works — at the price of owning identity, which is what
   produced the bug above, and of a second cache beside whichever one the
   application already has.
2. **Ship only a bridge** — `fromObservable`, and nothing else. Beautifully
   small, and it fails the last constraint: every project would build its own
   model of what is loaded, when, and how it is invalidated.
3. **Resources and invalidation here, caching one layer down.** The store holds
   reactive state per call site and knows when to reload. Deduplication,
   response caching and normalisation belong to the transport, where the
   knowledge of what is _the same thing_ actually lives.

## Chosen design

Option 3, in three layers with one touching point.

| Layer         | Owns                                     | Who                           |
| ------------- | ---------------------------------------- | ----------------------------- |
| Normalisation | one entity, one truth, everywhere        | Apollo, urql-graphcache       |
| Request cache | not asking twice                         | those clients, the HTTP cache |
| **Resources** | **reactive state, status, invalidation** | **us**                        |

### A resource is one loader, tracked like an effect

```tsx
const user = useResource(async ({ signal, tags, force }) => {
  tags(tag('user', { id: props.id }));
  const response = await fetch(`/users/${props.id}`, {
    signal,
    cache: force ? 'reload' : 'default',
  });
  return (await response.json()) as User;
});
```

No key, no name, no variables object, no options bag. `props.id` is read
directly, and because the synchronous part before the first `await` runs
tracked, changing it re-runs the loader — exactly as `effect` behaves.

**Identity is the call site.** A component runs once, so every `useResource`
call is one stable instance. Two call sites are two resources whatever their
tags say, which makes the collision above impossible by construction rather
than by discipline.

**Tags are declared where they are known, and the last word wins.** `tags()`
**replaces**; it may be called before the `await` when the caller knows what it
is asking for, and again after it when only the server does — loading a user by
name and learning the id from the answer is the case that motivated it. A run
replaces the tags of the run before it, and within a run the last call replaces
the earlier ones. Whoever wants both the coarse and the precise tag names both:

```ts
tags(tag('user')); // before: a category
const user = await load();
tags(tag('user'), tag('user', { id: user.id })); // after: both, on purpose
```

Replacement rather than accumulation, because a set that only grows describes
what a resource _used to_ be about, and is then invalidated by things that no
longer concern it.

**`force` is the one place the layers touch.** An invalidation re-runs the
loader; without telling it why, a transport cache would hand back the stale
answer it was invalidated over, and the invalidation would be silently
pointless. `force` is a boolean, not a mechanism: `cache: 'reload'` for fetch,
`fetchPolicy: 'network-only'` for Apollo, `requestPolicy` for urql.

### The bridge is first-class, not an escape hatch

```tsx
const user = fromObservable(apollo.watchQuery({ query: UserDocument, variables: { id } }));
```

When the same entity appears in twenty places and must stay consistent, twenty
independent resources are the wrong shape: they hold twenty copies and update
at twenty different moments, which is visible as tearing. A normalising client
already solves this, and `fromObservable` makes its observable a cell. The
contract is `subscribe(next, error) => unsubscribe`, which Apollo, urql, RxJS
and TanStack's `QueryObserver` all satisfy.

`useResource` is built on the same primitive, so the two are one mechanism
with two front doors — and the opinionated door can be removed one day without
touching the foundation.

### The package is `@firsthandjs/data`

`query` promises a cache — the word belongs to React Query and urql — and this
is not one. What it holds is resources, actions and observables, which is what
the documentation has been calling data all along.

### What leaves

`createGraphQLTransport`, `GraphQLContext`, `useGraphQL`, `useGraphQLMutation`
and `createGraphQLApi`. Connecting a GraphQL server is eight documented lines
in the application, shown for urql and Apollo, each with authentication and two
base URLs.

**One exception, and it is deliberate: a `fetch` helper stays in the package.**
`fetch` is the platform, not a vendor — it needs no version tracking, it has no
competing cache, and an application that only talks to one JSON endpoint should
not have to install anything to do it. What stays is the abort signal wired up,
a failed status thrown, and the one content type the platform will not set
itself. What does not follow it in: base URLs, interceptors, instances, retry.
Everything under **Non-goals** applies to it too.

`staleTime` and `cacheTime` leave with them. Both exist only because an entry
outlives its component; a resource does not, so there is nobody to come back
to it. What replaces them for navigation is the storage adapter: restore
instantly, revalidate behind it.

### What stays

The tags, the invalidation, the `@tag` / `@invalidates` directives read out of
`.gql` files at build time, the codegen that types them, the abort of
superseded requests, keeping the previous value visible while reloading, and
the storage adapter.

Extracting those directives is not GraphQL parsing and never was: it is a
hand-written scanner for **our own annotations**, run by the bundler plugin,
producing a plain object — `{ source, operation, kind, tags, invalidates }` —
that any client can consume. Nothing about a transport enters it.

## Non-goals

Held against every future request, and cited rather than re-argued:

- interceptors, retries, backoff, token refresh, request de-duplication
- progress events, XSRF handling, a Node adapter, client instances
- normalisation, entity merging, optimistic cache surgery
- pagination helpers, Suspense integration

Each belongs to a transport or to an application's own policy. Where one is
genuinely wanted, the answer is a client — and the loader takes any client,
because it takes any function.

## Performance

Twenty views of one entity are twenty loader calls. Whether that is twenty
requests depends on the layer below: Apollo and urql coalesce identical
in-flight queries, the browser's HTTP cache serves repeated GETs, and a
hand-written wrapper does neither until three lines say so. This is stated
plainly rather than hidden, because it is the cost of the split — and the
remedy is a cache in the place a cache belongs.

Twenty copies of the data are held rather than one. For the applications where
that matters, `fromObservable` over a normalising client holds one.

## Memory

A resource dies with its call site: no collection timer, no entry outliving
the component that asked. The storage adapter is what survives, and it is
explicit.

## DX

The measure of this design is what a developer writes, and the answer is: a
loader. Reading props and signals inside it is what makes it reactive; naming
what it is about is one call to `tags`. Nothing identifies anything, so
nothing can be identified wrongly.

**Testing needs nothing from us, and that is the point.** A component must not
have to be written for testability — a `load` prop taken only so a test can
pass a stub is a testing dependency in a production signature. It does not have
to be: a loader that calls `fetch` is mocked at the network (MSW, or a stubbed
global), and a loader that calls an application module is mocked at the module
boundary (`vi.mock`). Both work on an untouched component, and both are mature
tools we could neither replace nor improve.

So this package ships no test utilities. An earlier draft had `seed(tags, …)`
for filling a resource directly; it was dropped when tags stopped being
identity, because it would have addressed resources by something that no longer
identifies them.

## Helper packages

One per client — `@firsthandjs/data-axios`, `-urql`, `-apollo` — under two
conditions that are really one:

**They take a configured instance and touch only its call methods.** The client
is built by the application, with its own links, exchanges, interceptors and
authentication; a helper that owned the configuration would take control, and
would then have to follow every option a vendor adds. Touching
`query` / `mutate` / `watchQuery`, or `request`, keeps the surface at three of
the most stable names in each library, and `peerDependencies` keeps the
version the application's.

**They start as documented snippets.** A snippet is the measurement: one that
stays under twenty lines has not earned a package, and one that grows
version-conditional branches has. The Apollo snippet is currently nineteen.

## Rejected alternatives

- **Identity from tags** (0.4.0). Measured to serve one query's data to
  another. The cause of this ADR.
- **A required key, as React Query has.** Safer than an implicit derived one —
  an explicit key is visible in review — and rejected only because it must
  then be correct in every call site of a large codebase, and because it
  merges caching into a layer that should not own it.
- **An optional `name` for sharing.** The same object in a smaller size, and
  the same failure: a name that must be unique across a codebase nobody sees
  in full.
- **Shipping only the bridge.** Fails the constraint that a developer must not
  be made to build a state model; see option 2.
- **A `@firsthandjs/http` package with `restApi` and `httpSend`.** Drafted,
  and dropped: if transport is not our job, a package of ours that does it is
  a contradiction with a nicer import path.
