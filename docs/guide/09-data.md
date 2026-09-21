# Data

[Index](../README.md) · Previous: [Routing](08-routing.md) · Next:
[Web components](10-web-components.md)

---

```bash
npm install @firsthandjs/data
```

Signals and computeds cover everything an application can work out for itself,
now: read a value, derive another, and the screen follows. **This chapter is
about everything else** — the values that are not there yet when the component
runs, and that the reactive graph cannot produce on its own because they come
from somewhere outside it.

A server is the most common source by far, and every example here uses one. It
is not the only one: a worker, IndexedDB, a WebSocket, the Geolocation API, a
computation too expensive to repeat are all the same shape. Something out
there has a value; you want it in here, as reactive state, with a way to say
"that is out of date now".

There are two ways data comes in, and the difference is who starts:

- **You ask.** A [resource](#resources) runs a function and keeps its answer;
  an [action](#actions) changes something and says what it changed. This is
  most of it.
- **It tells you.** A [source that pushes](#sources-that-push) — a subscription,
  a socket, a normalising client's cache — becomes a resource through
  `fromObservable`, and updates arrive without anybody asking.

```tsx
import {
  DataContext,
  createData,
  createFetchClient,
  tag,
  useAction,
  useResource,
} from '@firsthandjs/data';

const api = createFetchClient({ baseUrl: '/api' });

const App = component(() => {
  provide(DataContext, createData());
  return <Profile id={7} />;
});

const Profile = component<{ id: number }>((props) => {
  const user = useResource(({ request, tags }) => {
    tags(tag('user', { id: props.id }));
    return api.get<User>(`/users/${String(props.id)}`)(request);
  });

  const rename = useAction((name: string, { request, invalidates }) => {
    invalidates(tag('user', { id: props.id }), tag('users'));
    return api.patch<User>(`/users/${String(props.id)}`, { json: { name } })(request);
  });

  return (
    <article class={user.loading.value ? 'stale' : ''}>
      <h1>{user.data.value?.name ?? '…'}</h1>
      <button disabled={rename.running.value} onClick={() => void rename.run('Ada')}>
        Rename
      </button>
    </article>
  );
});
```

## Two layers, and where caching sits

The example above has two halves, and keeping them apart is the one idea worth
taking from this chapter.

**The reactivity layer** is `useResource`, `useAction` and tags. It knows _who
is watching what_, _what state that is in_ — loading, loaded, failed — and
_when it has to run again_. It knows nothing about URLs, methods or GraphQL.

**The transport layer** is the client: `createFetchClient`, or Axios, urql,
Apollo. It knows how to send one request and come back with an answer, and
nothing about components.

Between them is one object. A loader is handed a **request** — an abort signal,
and whether this run must go past whatever is remembered — and gives back a
promise. That is the entire contract, which is why a loader can be any function
at all: a `fetch`, a worker message, an algorithm that never leaves the page.

```
useResource(…)  ─ reactivity ────  what is watched, what state, when again
      │
      │  request: { signal, force }
      ▼
api.get('/users/7')  ─ transport ─  how it is sent, and what is remembered
```

**Caching belongs to the transport**, and that is a deliberate choice rather
than an accident of layering. A cache answers "have I got this already?", which
needs to know when two things are _the same thing_ — a URL, an operation, a
key. In the reactivity layer that knowledge does not exist: a resource belongs
to its call site, and two call sites are two resources even when they ask for
exactly the same thing. Down at the transport, identity is right there in the
request.

So: the client caches, and `force` is how an invalidation reaches through it.
If you bring Apollo or urql you already have a cache and should use theirs; if
you bring nothing, [`createCacheClient`](#the-cache) is ours. What you should
not have is two, because two caches over one piece of data disagree, and the
disagreement is a bug nobody can reproduce.

[ADR-0022](../adr/0022-resources-not-a-cache.md) and
[ADR-0023](../adr/0023-one-cache-at-the-transport-edge.md) have the full
reasoning and the alternatives that were rejected.

## Resources

A loader is **any function returning a promise**, and it is given the request:

```tsx
const rows = useResource(({ request }) =>
  api.get<Row[]>(`/rows?page=${String(page.value)}`)(request),
);
```

### Dependencies are what the loader reads

The loader runs inside an effect, so **everything it reads before its first
`await` is a dependency** — a prop, a signal, a computed. Changing one runs it
again and aborts what was in flight. That is the same rule as `effect`, and for
the same reason: nothing is declared, so nothing can be forgotten.

```tsx
const rows = useResource(({ request }) => {
  const query = search.value; // read here → a dependency
  const size = pageSize.peek(); // read with peek() → not a dependency
  return api.get<Row[]>(`/rows?q=${query}&n=${String(size)}`)(request);
});
```

A token read to build a header would be a dependency too — and writing it on a
sign-out would re-send every request without one. Every client in this chapter
reads its headers for you, untracked, so this is a mistake you have to go out
of your way to make.

### What it exposes

| Cell      | Values                                                                    |
| --------- | ------------------------------------------------------------------------- |
| `status`  | `idle`, `loading` (nothing to show yet), `success`, `error`               |
| `loading` | `true` while a run is in flight, **including** one behind a visible value |
| `data`    | The last successful value; stays visible during a reload                  |
| `error`   | What the last failed run threw                                            |

`status` and `loading` are separate on purpose: "I have nothing to show" and "I
am asking again" are different questions, and conflating them is what puts a
spinner over data that is already correct.

```ts
await user.reload(); // run again, with `force`
user.dispose(); // stop early; otherwise the component's scope does this
```

`reload()` never rejects — a failure lands in `error`, and it resolves with
`undefined`.

## Actions

An action takes an input, does something, and says what it changed:

```tsx
const publish = useAction((id: string, { request, invalidates }) => {
  invalidates(tag('post', { id }), tag('posts'));
  return api.post<Post>(`/posts/${id}/publish`)(request);
});

<button disabled={publish.running.value} onClick={() => void publish.run(id)}>
  Publish
</button>;
```

`run()` never rejects: a failure lands in `error` and `status`, and the promise
resolves with `undefined`. An `onClick` that forgets to `await` cannot produce
an unhandled rejection.

An action's body is **untracked** — it runs from an event handler, and what it
reads on the way is nobody's dependency. It exposes `data`, `error`, `status`
and `running`.

**Nothing an action sends touches the cache.** Its request carries `force`, so
it is never answered from memory, and `mutating`, so its answer is never _put_
there — not even when the call has a `cacheKey`, and not even when it is a
`GET`. A cache holds representations; what an action gets back is the answer to
_doing_ something. Two identical writes are two writes, as well: an action is
never shared with another in flight.

## Tags

A tag says what something is about. `tag('user', { id: 7 })` is a name and some
variables, and matching is exactly one rule:

> A pattern matches when the names are equal and **every variable the pattern
> names** is equal.

So **fewer variables match more**. `tag('user')` means every user — the right
answer for "I changed something and I do not know which one".
`tag('user', { id: 7 })` means that one.

Tags are for invalidation only. Nothing is ever looked up by them, so they may
be coarse, they may overlap, and two unrelated resources may share one; the
worst case is a reload you did not need.

### Declare them where you know them

`tags()` **replaces**. A run says what it is about; it does not accumulate what
it used to be about. So call it before the `await` when the client knows, and
after it when only the server does:

```tsx
const user = useResource(async ({ request, tags }) => {
  tags(tag('user', { id: props.id })); // known now
  const loaded = await api.get<User>(`/users/${String(props.id)}`)(request);
  tags(tag('user', { id: loaded.id }), tag('org', { id: loaded.orgId })); // known now
  return loaded;
});
```

The late case is real: you ask for `/users/me`, and only the answer says which
user that was. An invalidation arriving while the request is still out is
remembered and matched again when the tags appear, so a run that was overtaken
goes again rather than leaving a stale answer on the screen.

With GraphQL you usually declare nothing at all: the document carries its own
`@tag` and `@invalidates` directives, and the client reports them for you.
[Documents](#graphql-documents) has the detail.

### Invalidating by hand

```tsx
const invalidate = useInvalidate();
await invalidate(tag('users'));
```

Everything carrying a matching tag runs again, with `force`. A component that
has never heard of the action shows the new value, because the only thing
connecting the two is the tag.

## The cache

One cache, at the transport edge, for two jobs: what a client fetched, and what
an algorithm of yours computed.

```ts
import { createCacheClient } from '@firsthandjs/data';

export const cache = createCacheClient({ ttl: 30_000, max: 200 });
```

| Option | Means                                                              | Default |
| ------ | ------------------------------------------------------------------ | ------- |
| `ttl`  | How long an answer is served again without asking, in ms           | `0`     |
| `max`  | How many entries to keep; the least recently read is evicted first | `100`   |

**With no `ttl` it still shares what is in flight.** Ten components asking for
the same thing at the same moment make one request and all get its answer —
that is waste removed, not staleness introduced, which is why it needs no
configuration. Serving an _older_ answer is the separate decision, and that is
what `ttl` buys.

Hand it to a client, and it caches reads:

```ts
const api = createFetchClient({ baseUrl: '/api', cache });
```

Or use it directly, with no client anywhere — the case where the slow thing is
yours:

```tsx
const report = useResource(({ request }) =>
  cache.read(`report:${month.value}`, () => buildReport(month.value))(request),
);
```

`read(key, produce)` runs `produce` only when there is nothing fresh under that
key, shares one run between callers that overlap, and — the part that matters —
**drops the entry when the request says `force`**. So an invalidated resource
asks again for real, rather than being answered out of the memory the
invalidation was meant to defeat.

The rest of it: `write(key, value)` to put something in by hand (a value pushed
from a socket, a first page rendered on the server), `peek(key)` to look
without running anything, `forget(key)` and `forget()` — which is what a
sign-out calls, along with `store.clear()`.

### Whose answer is it?

A cache keyed by URL alone can serve one account's answer to the next one:
`GET /api/me` is the same URL for everybody. So the key carries an **identity**
as well as a request, and by default that identity is the `authorization`
header the request would be sent with.

```ts
const api = createFetchClient({
  headers: () => ({ authorization: `Bearer ${session.token.peek()}` }),
  cache: { ttl: 30_000 },
});
// Sign in as somebody else and the key changes with the header. The previous
// account's answers are still in memory, but unreachable.
```

When the identity is somewhere else — a cookie session, a tenant header, an
account picker — say so:

```ts
const api = createFetchClient({
  init: { credentials: 'include' },
  scope: () => session.account.value?.id ?? 'anonymous',
  cache: { ttl: 30_000 },
});
```

Clearing on sign-out is still worth doing, because it frees the memory:

```ts
function signOut(): void {
  session.end();
  api.cache?.forget(); // and `store.clear()` for anything persisted
}
```

The difference is that forgetting to is now a memory question rather than a
correctness one.

Actions are outside all of this: they neither read from the cache nor write to
it, whatever key they carry.

> **A key you write yourself must carry everything that varies.** `cacheKey:
'search'` for a POST whose body is the query means every search shares one
> answer. `` cacheKey: `search:${stableKey(body)}` `` is the version that does
> not — `stableKey` is exported for exactly this, and gives the same string
> whatever order an object was written in.

## Keeping a value between visits

The cache is memory for this page view. A value that should survive a reload is
a different thing, and it is the one thing that needs a name, because a call
site does not survive a reload and a name does:

```tsx
provide(
  DataContext,
  createData({
    storage: {
      read: (name) => idb.get(name),
      write: (name, data) => void idb.set(name, data),
      clear: () => void idb.clear(),
    },
  }),
);

const boards = useResource(loadBoards, { persist: 'boards' });
```

The stored value appears immediately with `loading` still `true`, and is
replaced when the loader answers. A storage that throws is a storage that has
nothing — it can never break a resource.

## The transport: pick a client

Every client here is made the same way — `create…Client(…)` — configured once
with a base URL, headers and a cache, specialised with `.with(…)`, and
overridable per call.

### fetch

**`createFetchClient` is a small REST client built on the browser's own
`fetch`.** It is what you use when the answer to "which HTTP client?" is "none,
the platform is fine" — and it gives you the five things you would otherwise
write by hand in every project:

- a **base URL**, so call sites carry paths;
- **headers per request**, so a token that changes is the current one;
- a **failed status thrown** as `FirsthandHttpError`, so nothing checks
  `response.ok`;
- the **abort signal** wired through, so a superseded request stops;
- the shared **cache**, which `force` reaches through.

```ts
import { createFetchClient } from '@firsthandjs/data';

export const api = createFetchClient({
  baseUrl: '/api',
  headers: () => ({ authorization: `Bearer ${session.token.value}` }),
  cache: { ttl: 30_000 },
});
```

```ts
api.get<User>('/users/7');
api.post<Note>('/notes', { json: { title } });
api.put<Note>('/notes/7', { json: note });
api.patch<Note>('/notes/7', { json: { title } });
api.remove<void>('/notes/7');
api.request<Row[]>('/rows', { method: 'REPORT' }); // the general form
```

Each returns a loader — a function waiting for the request — so a call site is
`api.get<User>('/users/7')(request)`.

Bodies: `json:` takes an object and sends it as JSON _with the content type the
platform will not set for you_ (a stringified object is a string, so `fetch`
labels it `text/plain`). Everything the platform does label itself —
`FormData`, `URLSearchParams`, `Blob` — goes in `body:` untouched, boundary and
all.

```ts
api.post('/files', { body: formData });
api.post('/session', { body: new URLSearchParams(form) });
```

Every other `RequestInit` option passes straight through: `headers`,
`credentials`, `mode`, `cache`, `keepalive`, `signal` excepted — that one comes
from the request.

> `fetch` **forbids a body on GET**: it throws a `TypeError` rather than
> sending one. An endpoint that wants a body wants `POST`.

Per call you can override the caching — `cacheKey: 'search:ada'` for a POST
that reads, `cacheKey: false` for the read that must never be remembered — and
`api.with({ baseUrl: '/admin' })` makes a variation that keeps everything else,
cache included.

The seam for everything a client library would do with plugins is `fetch`
itself:

```ts
export const api = createFetchClient({
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 401) {
      session.end(); // one place, visible, yours
    }
    return response;
  },
});
```

There are deliberately no interceptors, no retry and no token refresh: at three
of those a pipeline starts to earn its keep, and at that point you want Axios,
which is the next section.

### Axios

📦 [`@firsthandjs/data-axios`](../../packages/data-axios/README.md)

```bash
npm install @firsthandjs/data-axios
```

```ts
import axios from 'axios';
import { createAxiosClient } from '@firsthandjs/data-axios';

const instance = axios.create({ baseURL: '/api' });
instance.interceptors.response.use(undefined, retryOnce);

export const api = createAxiosClient(instance, {
  headers: () => ({ authorization: `Bearer ${session.token.peek()}` }),
  cache: { ttl: 30_000 },
});
```

```tsx
const profile = useResource(({ request, tags }) => {
  tags(tag('profile', { id: props.id }));
  return api.get<Profile>(`/profiles/${props.id}`)(request);
});
```

The instance stays yours — base URL, interceptors, retries, transformers. The
client adds the abort signal, the per-request headers and the cache, and
touches exactly one Axios method.

### urql

📦 [`@firsthandjs/data-urql`](../../packages/data-urql/README.md)

```bash
npm install @firsthandjs/data-urql @urql/core
```

```ts
import { Client, fetchExchange } from '@urql/core';
import { createUrqlClient } from '@firsthandjs/data-urql';

export const billing = createUrqlClient(
  new Client({ url: '/graphql', exchanges: [fetchExchange] }),
  { headers: () => ({ authorization: `Bearer ${session.token.peek()}` }) },
);
```

```tsx
const invoices = useResource(({ request }) =>
  billing.query(InvoicesDocument, { month: month.value })(request),
);

const pay = useAction((id: string, { request }) => billing.mutate(PayDocument, { id })(request));
```

Nothing declares tags at either call site: the documents do, and the client
reports them into the request. Whether you keep `cacheExchange` is your
decision — with it urql caches and `force` reaches past it; without it urql is
pure transport and our cache is available instead.

### Apollo

📦 [`@firsthandjs/data-apollo`](../../packages/data-apollo/README.md)

```bash
npm install @firsthandjs/data-apollo @apollo/client
```

```ts
import { gql } from '@apollo/client';
import { createApolloClient } from '@firsthandjs/data-apollo';

export const billing = createApolloClient(apollo, gql, {
  headers: () => ({ authorization: `Bearer ${session.token.peek()}` }),
});
```

Apollo's `InMemoryCache` is a _normalising_ cache — a different thing from a
store of resources — so there are two ways to run them together, and only two:

- **Apollo as transport.** The resources are your state, and `force` becomes
  `fetchPolicy: 'network-only'`.
- **Apollo as the store.** `billing.watch(...)` with `fromObservable`, so one
  write in its cache updates every view of that entity at once:

```tsx
const user = fromObservable(...billing.watch(UserDocument, { id: props.id }));
```

None of the three packages depends on the client it binds, not even as a peer:
the handful of methods each uses is declared structurally. They have no version
to follow, and nothing to break when yours changes.

### More than one API

There is nothing to configure. A second API is a second client, and one
component may read from both:

```tsx
const invoices = useResource(({ request }) => billing.query(InvoicesDocument)(request));
const products = useResource(({ request }) => catalog.get<Product[]>('/products')(request));
```

Tags are one namespace, so two servers that both have a `user` want distinct
names — `tag('billing:user', { id })`. A prefix is enough; nothing parses it.

## GraphQL documents

Put each operation in a `.gql` file, with its tags as **directives**:

```graphql
# notes.gql
#import "./note-fields.gql"

query Notes($search: String) @tag(name: "notes") {
  notes(search: $search) {
    ...NoteFields
  }
}
```

```graphql
# update-note.gql
mutation UpdateNote($id: ID!, $body: String!)
@invalidates(name: "note", id: $id)
@invalidates(name: "notes") {
  updateNote(id: $id, body: $body) {
    id
    body
  }
}
```

- `name` is the tag's name; every other argument is a tag variable.
- `$id` is bound from the variables of the call, so one directive covers every
  note. A variable the call leaves out **widens** the tag rather than producing
  `note(id: undefined)`.
- Directives may sit on the operation or on a field.
- `#import "./other.gql"` inlines fragments, once per file however often it is
  imported.
- **The directives never reach the server.** They are stripped from the
  document before it is sent, the way Apollo strips `@connection`. A malformed
  one is a build error.

A query's `@tag` directives are declared before the request goes out, so an
invalidation arriving mid-flight still finds it. A mutation's `@invalidates`
are what it changed — and since an action's request _is_ the store's
invalidation, `billing.mutate(Doc, vars)(request)` needs nothing further.

### The loader and the types

```ts
// vite.config.ts
import { graphql } from '@firsthandjs/data/vite';
export default defineConfig({ plugins: [firsthand({ packageName: 'app' }), graphql()] });
```

```ts
// codegen.ts
generates: {
  'src/graphql-types.ts': {
    // One plugin: adding `typescript` to the same file declares every input twice.
    plugins: ['typescript-operations'],
    config: { useTypeImports: true, skipTypename: true },
  },
  'src/graphql-modules.d.ts': {
    plugins: ['@firsthandjs/data/codegen'],
    config: { typesPath: './graphql-types' },
  },
}
```

The second output writes one `declare module '*/notes.gql'` per operation, so
**no call site carries a type argument** and an operation with required
variables cannot be called without them. Rename a field in the schema, re-run
codegen, and everything that used it stops compiling.

Without the plugin, `parseGraphQL(source)` does the same at runtime — at the
cost of shipping the parser, which the loader path leaves out of the bundle.

## Sources that push

Everything above is you asking. The other half is a source that tells you:
a WebSocket, an `EventSource`, an RxJS stream, or a normalising client's cache
when the same entity appears in twenty places and all of them must agree.

```tsx
const user = fromObservable(source, { reload: () => watched.refetch() });
```

The contract is the smallest one every such source satisfies: `subscribe` with
a `next` and an `error`, returning an unsubscribe function or something
carrying one. Apollo, urql, RxJS and TanStack's `QueryObserver` all do, and so
does fifteen lines around a `WebSocket`.

What you get back is an ordinary `Resource`: the same `data`, `status`,
`loading` and `error` cells, so a component cannot tell — and should not care —
which of the two kinds it was given.

`fromPromise(factory)` is the small end of the same idea: a promise, with no
tags and no dependencies.

## Testing

A loader is a function and a client is a value, so there is nothing
framework-specific to mock. Three levels, in order of preference:

**The network.** [MSW](https://mswjs.io) intercepts `fetch`, so the component,
the loader and the client all run for real:

```ts
server.use(http.get('/api/users/7', () => HttpResponse.json({ id: 7, name: 'Ada' })));
```

**The client.** It is a plain object; a test can hand over one of its own, or
narrow the real one with `api.with({ fetch: fakeFetch, cache: false })`.

**The store.** `createData()` is an ordinary value, so a test provides its own —
with a `storage` stub when persistence is what is under test. `store.size` says
how many resources are alive, which is how a leak is asserted.

There are deliberately no test utilities in this package: a resource is a call
site running a function, and a helper that reached into one would be reaching
into your component.

## Devtools

[`@firsthandjs/devtools`](14-devtools.md) reports every resource as it is
created, run, invalidated and dropped, with its tags rendered readably. The
tags are the thing worth seeing: they are the answer to "why did this reload?".

## What it deliberately does not do

Retries, backoff, token refresh, request queues, normalisation, optimistic
cache surgery, pagination helpers, Suspense-style integration. Each belongs to
a transport or to an application's own policy, and each would be paid for by
every application that does not need it.

---

Next: [Web components](10-web-components.md).
