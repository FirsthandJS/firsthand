# Data

[Index](../README.md) · Previous: [Routing](08-routing.md) · Next:
[Web components](10-web-components.md)

---

```bash
npm install @firsthandjs/data
```

Two things an application does with a server: it **loads** something and keeps
it as reactive state, and it **changes** something and says what it changed.
Those are `useResource` and `useAction`, and between them sits one idea —
**tags**, which say what a piece of state is _about_.

```tsx
import { DataContext, createData, json, tag, useAction, useResource } from '@firsthandjs/data';

const App = component(() => {
  provide(DataContext, createData());
  return <Profile id={7} />;
});

const Profile = component<{ id: number }>((props) => {
  const user = useResource(({ signal, tags }) => {
    tags(tag('user', { id: props.id }));
    return json<User>(`/api/users/${String(props.id)}`)({ signal });
  });

  const rename = useAction(async (name: string, { signal, invalidates }) => {
    const updated = await json<User>(`/api/users/${String(props.id)}`, {
      method: 'PATCH',
      json: { name },
    })({ signal });
    invalidates(tag('user', { id: props.id }), tag('users'));
    return updated;
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

No key, no cache key, no query name, no variables object. Read on for why that
is the design rather than an omission.

## What this is, and what it is not

**It is not a cache.** A cache is defined by a second lookup for the same thing
finding the first one's result, and that needs _identity_ — a key, a name,
something two call sites agree on. Every form of that is a thing to forget or
to collide on, and deriving it implicitly (from tags, say) silently serves one
resource's data to another. That was a measured bug in the package this one
replaces, and removing the concept removed the class.

A resource belongs to its **call site**. Two call sites are two resources,
whatever their tags say.

| Layer         | Owns                                     | Who                                     |
| ------------- | ---------------------------------------- | --------------------------------------- |
| Normalisation | one entity, one truth, everywhere        | Apollo, urql-graphcache                 |
| Request cache | not asking twice                         | those clients, the browser's HTTP cache |
| **Resources** | **reactive state, status, invalidation** | **this package**                        |

Deduplication and response caching sit one layer down, where the knowledge of
what is _the same thing_ actually lives. If you want them, you already have
them: `cache: 'default'` on `fetch` is the HTTP cache, `cacheExchange` is
urql's, `InMemoryCache` is Apollo's. If you do not, you do not pay for them.

The full reasoning, with the alternatives that were rejected, is in
[ADR-0022](../adr/0022-resources-not-a-cache.md).

## Resources

A loader is **any function returning a promise**: `fetch`, Axios, a GraphQL
client, a worker, IndexedDB, an algorithm that never leaves the browser.

```tsx
const rows = useResource(({ signal }) =>
  json<Row[]>(`/api/rows?page=${String(page.value)}`)({ signal }),
);
```

### Dependencies are what the loader reads

The loader runs inside an effect, so **everything it reads before its first
`await` is a dependency** — a prop, a signal, a computed. Changing one runs it
again and aborts what was in flight. That is the same rule as `effect`, and for
the same reason: nothing is declared, so nothing can be forgotten.

```tsx
const rows = useResource(({ signal }) => {
  const query = search.value; // read here → a dependency
  const size = pageSize.peek(); // read with peek() → not a dependency
  return json<Row[]>(`/api/rows?q=${query}&n=${String(size)}`)({ signal });
});
```

Reading a token to build a header therefore makes the token a dependency, which
on a sign-out would send every watched request again without one. `peek()` is
the answer — or a client that reads it for you, which is what every helper
package below does.

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
const publish = useAction(async (id: string, { signal, invalidates }) => {
  const post = await json<Post>(`/api/posts/${id}/publish`, { method: 'POST' })({ signal });
  invalidates(tag('post', { id }), tag('posts'));
  return post;
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

## Tags

A tag says what something is about. `tag('user', { id: 7 })` is a name and some
variables, and matching is exactly one rule:

> A pattern matches when the names are equal and **every variable the pattern
> names** is equal.

So **fewer variables match more**. `tag('user')` means every user — the right
answer for "I changed something and I do not know which one".
`tag('user', { id: 7 })` means that one.

Because tags are not identity, they may be coarse, they may overlap, and two
unrelated resources may share one. Nothing breaks; the worst case is a reload
you did not need.

### Declare them where you know them

`tags()` **replaces**. A run says what it is about; it does not accumulate what
it used to be about. So call it before the `await` when the client knows, and
after it when only the server does:

```tsx
const user = useResource(async ({ signal, tags }) => {
  tags(tag('user', { id: props.id })); // known now
  const loaded = await json<User>(`/api/users/${String(props.id)}`)({ signal });
  tags(tag('user', { id: loaded.id }), tag('org', { id: loaded.orgId })); // known now
  return loaded;
});
```

The late case is real: you ask for `/api/users/me`, and only the answer says
which user that was. An invalidation arriving while the request is still out is
remembered and matched again when the tags appear, so a run that was overtaken
goes again rather than leaving a stale answer on the screen.

### Invalidating by hand

```tsx
const invalidate = useInvalidate();
await invalidate(tag('users'));
```

Everything carrying a matching tag runs again, with `force`. A component that
has never heard of the action shows the new value, because the only thing
connecting the two is the tag.

## `force`: reaching past a transport cache

A loader is told **why** it is running. `force` is `true` when the run was
caused by an invalidation or by `reload()`. It is the one place the layers
touch — without it, a transport cache would hand back the answer that was just
invalidated, and the invalidation would be silently pointless.

```tsx
useResource(({ signal, force }) =>
  json<User>('/api/users/5', { cache: force ? 'reload' : 'default' })({ signal }),
);
```

`fetchPolicy: force ? 'network-only' : 'cache-first'` for Apollo,
`requestPolicy` for urql — the helper packages do this for you.

## Keeping a value between visits

Persistence is the one thing that needs a name, because a name is what survives
a reload and a call site does not. It is opt-in for exactly that reason:

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
nothing — it can never break a resource. `store.clear()` empties it, which is
what a sign-out calls.

## Transport: bring your own client

### `fetch`

`json()` is the platform with the three things a resource needs from it: the
abort signal wired through, a failed status thrown as `FirsthandHttpError`, and
the body parsed.

```ts
json<User>('/api/users/7'); // GET
json<Note>('/api/notes', { method: 'POST', json: { title } }); // JSON body
json<Upload>('/api/files', { method: 'POST', body: formData }); // multipart
json<Session>('/api/session', { method: 'POST', body: new URLSearchParams(form) });
```

`json:` exists for one measured reason: a stringified object is a string, so
`fetch` labels it `text/plain`. `FormData`, `URLSearchParams` and `Blob` are
labelled by the platform itself, boundary and all, so they go in `body` and
nothing here would improve on them. Every other `RequestInit` option —
`headers`, `credentials`, `mode`, `cache`, `keepalive` — passes straight
through, so custom headers, including authentication, are ordinary options:

```ts
json<Me>('/api/me', { headers: { authorization: `Bearer ${token.peek()}` } });
```

> `fetch` **forbids a body on GET**: it throws a `TypeError` rather than
> sending one. An endpoint that wants a body wants `POST`.

There is no base URL here, no instance, no interceptor and no retry, and there
will not be. Those belong to a client — and a loader takes any client, because
it takes any function.

### Axios

```bash
npm install @firsthandjs/data-axios
```

```ts
import axios from 'axios';
import { axiosLoader } from '@firsthandjs/data-axios';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((config) => {
  config.headers.authorization = `Bearer ${token.peek()}`;
  return config;
});

export const load = axiosLoader(api);
```

```tsx
const profile = useResource(({ tags, ...rest }) => {
  tags(tag('profile', { id: props.id }));
  return load<Profile>({ url: `/profiles/${props.id}` })(rest);
});
```

The helper touches one method and wires the abort signal. Your base URL,
interceptors, authentication and retries stay on the instance you built.

### urql

```bash
npm install @firsthandjs/data-urql @urql/core
```

```ts
import { Client, fetchExchange } from '@urql/core';
import { urqlLoader } from '@firsthandjs/data-urql';

export const billing = urqlLoader(
  new Client({
    url: '/graphql',
    exchanges: [fetchExchange],
    fetchOptions: () => ({ headers: { authorization: `Bearer ${token.peek()}` } }),
  }),
);
```

```tsx
const invoices = useResource((context) =>
  billing(InvoicesDocument, { month: month.value })(context),
);
```

Keeping `cacheExchange` is a decision worth making on purpose: without it, urql
is your transport and the resources are your state; with it, urql also caches —
and `force` is what reaches past it.

### Apollo

```bash
npm install @firsthandjs/data-apollo @apollo/client
```

```ts
import { gql } from '@apollo/client';
import { apolloLoader, apolloObservable } from '@firsthandjs/data-apollo';

export const billing = apolloLoader(apollo, gql);
```

Apollo's `InMemoryCache` is a _normalising_ cache, which is a different thing
from a store of resources. Two ways to run them together, and only two:

- **Apollo as transport** — the resources are your state, and `force` becomes
  `network-only`.
- **Apollo as the store** — `apolloObservable` with `fromObservable`, so one
  write in its cache updates every view of that entity at once:

```tsx
const user = fromObservable(...apolloObservable(apollo, gql)(UserDocument, { id: props.id }));
```

None of the three helper packages depends on the client it binds, not even as a
peer: the handful of methods each uses is declared structurally. They have no
version to follow, and nothing to break when yours changes.

### More than one API

There is nothing to configure. A second API is a second client and a second
loader, and one component may read from both:

```tsx
const invoices = useResource((context) => billing(InvoicesDocument)(context));
const products = useResource(({ signal }) => json<Product[]>('/catalog/products')({ signal }));
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

A query's `@tag` directives are declared before the request goes out; a
mutation's `@invalidates` are what it is about, so an action hands the
document's own declaration straight to the store:

```tsx
const save = useAction((input: Input, { signal, invalidates }) =>
  billing(UpdateNoteDocument, input)({ signal, force: true, tags: invalidates }),
);
```

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
**no call site carries a type argument**. Rename a field in the schema, re-run
codegen, and everything that used it stops compiling.

Without the plugin, `parseGraphQL(source)` does the same at runtime — at the
cost of shipping the parser, which the loader path leaves out of the bundle.

## Sources that push

When the same entity appears in twenty places and all of them must stay
consistent, a per-call-site resource is the wrong shape — and a normalising
client already solves it. `fromObservable` makes its observable a resource:

```tsx
const user = fromObservable(source, { reload: () => watched.refetch() });
```

The contract is the smallest one every client satisfies: `subscribe` with a
`next` and an `error`, returning an unsubscribe function or something carrying
one. Apollo, urql, RxJS and TanStack's `QueryObserver` all do. `fromPromise` is
the other end of the range: a promise, with no tags and no dependencies.

## Testing

A loader is a function, so there is nothing framework-specific to mock. Three
levels, in order of preference:

**The network.** [MSW](https://mswjs.io) intercepts `fetch`, so the component,
the loader and the client all run for real:

```ts
server.use(http.get('/api/users/7', () => HttpResponse.json({ id: 7, name: 'Ada' })));
```

**The module.** If your loaders live in `api.ts`, replace that:

```ts
vi.mock('./api', () => ({ readUser: vi.fn().mockResolvedValue({ id: 7, name: 'Ada' }) }));
```

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

Retries, backoff, token refresh, request de-duplication, normalisation,
optimistic cache surgery, pagination helpers, Suspense-style integration. Each
belongs to a transport or to an application's own policy, and each would be
paid for by every application that does not need it.

## Coming from `@firsthandjs/query`

| Was                                            | Is                                                         |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `createQueryClient({ staleTime })`             | `createData({ storage })` — no `staleTime`, no `cacheTime` |
| `useQuery(() => ({ tags, variables, fetch }))` | `useResource(({ signal, tags }) => …)`                     |
| `useMutation({ mutate, invalidates })`         | `useAction(async (input, { signal, invalidates }) => …)`   |
| `variables: { page }`                          | read `page.value` inside the loader                        |
| `query.fetching`                               | `resource.loading`                                         |
| `status === 'pending'`                         | `status === 'loading'`                                     |
| `useGraphQL(Document, vars)`                   | `useResource((c) => client(Document, vars)(c))`            |
| `createGraphQLTransport({ url })`              | your urql or Apollo client, or `json()`                    |
| `createGraphQLApi(transport)`                  | a second loader                                            |

The cache is gone, which means a second component asking for the same thing
asks the server. If that matters, put a cache in the transport — where it can
be the only one.

---

Next: [Web components](10-web-components.md).
