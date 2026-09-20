# Data

[Index](../README.md) · Previous: [Routing](08-routing.md) · Next:
[Web components](10-web-components.md)

---

```bash
npm install @firsthandjs/query
```

A cache in front of the network, for REST and GraphQL, invalidated by **tags**
rather than by cache keys.

## Setting it up

```tsx
import { QueryClientContext, createQueryClient } from '@firsthandjs/query';

const App = component(() => {
  provide(QueryClientContext, createQueryClient({ staleTime: 30_000 }));
  return <Shell />;
});
```

| Option      | Meaning                                                       | Default |
| ----------- | ------------------------------------------------------------- | ------- |
| `staleTime` | How long a result is reused without going to the network      | `0`     |
| `cacheTime` | How long an entry nobody watches is kept before being dropped | 5 min   |

## Reading

```tsx
import { useQuery, tag, json } from '@firsthandjs/query';

const UserCard = component<{ id: number }>(({ id }) => {
  const user = useQuery<User>(() => ({
    tags: [tag('user', { id })],
    fetch: json(`/api/users/${String(id)}`),
  }));

  return (
    <article class={user.fetching.value ? 'stale' : ''}>
      {user.status.value === 'error' ? <p>Could not load.</p> : <h2>{user.data.value?.name}</h2>}
    </article>
  );
});
```

The definition is a **thunk**, because a component body runs once: when `id`
changes, the thunk is re-evaluated, the subscription moves to the entry for the
new id, and the cells the view reads start reporting that entry. Nothing
re-renders.

| Cell       | Values                                                              |
| ---------- | ------------------------------------------------------------------- |
| `status`   | `idle`, `pending` (nothing to show yet), `success`, `error`         |
| `fetching` | `true` while a request is in flight, **including** a background one |
| `data`     | The last successful value; kept visible during a refetch            |
| `error`    | What the last failed attempt threw                                  |

`status` and `fetching` are separate on purpose: "I have nothing to show" and
"I am asking again" are different, and conflating them is what puts a spinner
over data that is already correct.

```tsx
user.refetch(); // go to the network
user.refetch({ force: false }); // respect the cache
```

## Tags, and why not keys

A tag says what a query is **about**, and a query may carry several:

```ts
tags: [tag('user', { id: 7 }), tag('permissions', { org: 3 })];
```

A mutation says what it **changed**, not who should re-run:

```tsx
const rename = useMutation({
  mutate: (input: Rename) => save(input),
  invalidates: (_result, input) => [tag('user', { id: input.id }), tag('users')],
});

<button onClick={() => void rename.mutate({ id, name })} disabled={rename.fetching.value}>
  Rename
</button>;
```

Every query carrying a matching tag is invalidated. A tag with **fewer**
variables matches more, so `tag('user')` means every user — the right answer
for "I changed something and I do not know which one".

Watched entries re-fetch at once; the rest re-fetch on next use. A component
that never heard of the mutation shows the new value, because every component
asking for the same tags reads the same cells.

`mutate` never rejects: a failure lands in `error` and `status`, and the
promise resolves with `undefined`. An `onClick` that forgets to `await` cannot
produce an unhandled rejection.

## Variables

A query's identity is its tags **and** its variables. Anything the fetcher
reads that can change belongs in one of the two:

```tsx
const rows = useQuery<Row[], { page: number }>(() => ({
  tags: [tag('rows')],
  variables: { page: page.value },
  fetch: ({ variables, signal }) =>
    json<Row[]>(`/api/rows?page=${String(variables.page)}`)({ signal }),
}));
```

Change `page` and the query moves to that page's entry and fetches; change it
back and the first entry answers with no request. One `tag('rows')` still
invalidates every page.

A value in neither a tag nor `variables` is captured in the fetcher's closure,
which the cache cannot see into — the entry would answer for ever out of its
first result. That is the one mistake this API can still let you make.

## REST

`json()` wires the abort signal through and turns a failed status into a thrown
`FirsthandHttpError`, so nothing has to check `response.ok`:

```ts
fetch: json<User>('/api/users/7');
fetch: ({ signal }) => json<User>('/api/users', { method: 'POST', body })({ signal });
```

Anything returning a promise works — `fetch`, `axios`, a WebSocket request, a
function reading from IndexedDB.

## GraphQL

### Setting up GraphQL

One plugin, one config file, and a directory of operations. In order:

```bash
npm install @firsthandjs/query graphql
npm install --save-dev @graphql-codegen/cli @graphql-codegen/typescript-operations
```

```ts
// vite.config.ts — the loader turns .gql files into parsed documents
import { graphql } from '@firsthandjs/query/vite';

plugins: [firsthand({ packageName: 'app' }), graphql()];
```

```
src/
  gql/
    boards.gql          one operation per file, cache tags as directives
    board-fields.gql    a fragment, inlined by #import
  graphql-types.ts      generated: result and variable types
  graphql-modules.d.ts  generated: which .gql file has which of them
codegen.ts              points at the schema and at src/gql
server/schema.graphql   or wherever your schema comes from
```

```tsx
// once, where the application starts
provide(QueryClientContext, createQueryClient({ staleTime: 30_000 }));
provide(GraphQLContext, createGraphQLTransport({ url: '/graphql' }));
```

```tsx
// and then, anywhere
import BoardsDocument from '../gql/boards.gql';

const boards = useGraphQL(BoardsDocument);
```

That is the whole path. The rest of this section is what each step is for:
[the document](#the-document) and its directives, [types](#loading-and-types),
[the transport](#the-transport), [authentication](#authentication), and
[more than one API](#more-than-one-api).

Nothing here is required. Without the loader, `parseGraphQL(source)` does the
same at runtime; without codegen, the types are the ones you write. The
loader and codegen are what make a call site carry no type argument and no
drift.

### The document

Put each operation in a `.gql` file, with its cache tags as **directives**:

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
- `$id` is bound from the variables the call passes, so one directive covers
  every note.
- A variable the call leaves out **widens** the tag rather than producing
  `note(id: undefined)`.
- Directives may sit on the operation or on a field.
- `#import "./other.gql"` inlines fragments, once per file however often it is
  imported.

**The directives never reach the server.** They are instructions to the cache,
and a server that has not declared them would reject the query, so they are
stripped from the document before it is sent — the same way Apollo strips
`@connection`. A malformed one is a build error.

### Loading and types

```ts
// vite.config.ts
import { graphql } from '@firsthandjs/query/vite';
export default defineConfig({ plugins: [firsthand({ packageName: 'app' }), graphql()] });
```

```ts
// codegen.ts
import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: 'server/schema.graphql',
  documents: 'src/gql/**/*.gql',
  generates: {
    'src/graphql-types.ts': {
      // One plugin: adding `typescript` to the same file declares every input
      // object twice.
      plugins: ['typescript-operations'],
      config: { useTypeImports: true, skipTypename: true },
    },
    'src/graphql-modules.d.ts': {
      plugins: ['@firsthandjs/query/codegen'],
      config: { typesPath: './graphql-types' },
    },
  },
};

export default config;
```

The second output is what makes the first reachable: it writes one
`declare module '*/notes.gql'` per operation, pointing at the generated types.
With it, **no call site carries a type argument**:

```tsx
import NotesDocument from './gql/notes.gql';
import UpdateNoteDocument from './gql/update-note.gql';

const notes = useGraphQL(NotesDocument, () => ({ search: search.value }));
notes.data.value?.notes[0]?.title; // string | undefined, from the schema

const save = useGraphQLMutation(UpdateNoteDocument);
void save.mutate({ id, body }); // variables checked against the operation
```

Rename a field in the schema, re-run codegen, and everything that used it stops
compiling. An operation with required variables cannot be called without them.

### The transport

One call says where the server is, and it is provided like anything else:

```tsx
import { GraphQLContext, createGraphQLTransport } from '@firsthandjs/query';

provide(GraphQLContext, createGraphQLTransport({ url: '/graphql' }));
```

`url` is the only required option. A different origin is a full URL, and a
proxy in `vite.config.ts` is the usual alternative during development.

Errors in a GraphQL response become one thrown `FirsthandGraphQLError`, which
lands in the query's `error` cell.

Without a bundler plugin, `parseGraphQL(source)` does the same at runtime — at
the cost of the parser, which the loader path leaves out of the bundle.

### Authentication

Two options carry it, and each is a function. There is no plugin system here:
urql answers this with exchanges, Apollo with links, and both are pipelines
you insert middleware into. What an application actually needs is a header on
every request and somewhere to notice a rejected token.

**`headers` is called per request.** Read the token out of a signal and every
request carries the current one; nothing has to be rebuilt when it changes.

```tsx
import { signal } from '@firsthandjs/dom';

export const token = signal<string | null>(localStorage.getItem('token'));

provide(
  GraphQLContext,
  createGraphQLTransport({
    url: '/graphql',
    headers: () => (token.value === null ? {} : { authorization: `Bearer ${token.value}` }),
  }),
);
```

Reading a signal there does **not** make it a dependency of the queries that
go out: a fetcher is imperative I/O, and what a query depends on is what its
`define` thunk reads. Writing the token therefore does not re-fetch every
watched query — which, on a sign-out, would send them all again without one.

**`fetch` is the seam for everything else.** It wraps the request, so it is
where a rejected token ends a session:

```tsx
const client = createQueryClient();

createGraphQLTransport({
  url: '/graphql',
  headers: () => …,
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 401) {
      token.value = null;
      client.clear(); // the next account must not read this one's cache
    }
    return response;
  },
});
```

This wants a server that answers **401** rather than a 200 with an error in
the body. With `graphql-yoga` that is one option on the error:

```ts
throw new GraphQLError('Sign in to continue', { extensions: { http: { status: 401 } } });
```

Silent token refresh, retry with backoff, or request de-duplication would all
go in that same function — and at three of them, a pipeline starts to earn its
keep. Until then it is one function, and it is enough.

Signing **in** is an ordinary mutation. Keep the token where the header can
read it, and let the tags do the rest:

```tsx
const logIn = useGraphQLMutation(LogInDocument, {
  onSuccess: (result) => {
    token.value = result.logIn.token;
  },
});
```

The operation's `@invalidates` directives then refresh whatever the previous
visitor was looking at.

### More than one API

`useGraphQL` reads its transport from `GraphQLContext`, which holds one value
per subtree. That is the right shape while there is one server, and it cannot
answer the case that turns up in real applications: **one component reading
from two**.

`createGraphQLApi` binds the same hooks to a transport of their own:

```tsx
// setup/apis.ts
import { createGraphQLApi, createGraphQLTransport } from '@firsthandjs/query';

export const billing = createGraphQLApi(createGraphQLTransport({ url: '/billing/graphql' }));
export const catalog = createGraphQLApi(createGraphQLTransport({ url: '/catalog/graphql' }));
```

```tsx
const Dashboard = component(() => {
  const invoices = billing.useQuery(InvoicesDocument);
  const products = catalog.useQuery(ProductsDocument);
  …
});
```

Each has its own `headers` and its own `fetch`, so two servers with different
authentication are two transports and nothing else.

**One cache serves both**, with everything that implies: deduplication,
`staleTime`, and one namespace of tags. Two servers that both have a `user`
therefore want distinct tag names —

```graphql
query Customer($id: ID!) @tag(name: "billing:user", id: $id) { … }
```

— or a mutation on one will invalidate a query on the other. A prefix is
enough; the cache never parses it.

REST needs none of this: `json(url)` takes the URL, so a second API is a
second URL.

## What the cache does for you

- **Deduplicates**: ten components asking at once make one request.
- **Aborts**: a superseded request's `AbortSignal` fires, and the late answer
  is dropped rather than overwriting a newer one.
- **Keeps the last value visible** during a refetch, with `fetching` true.
- **Collects**: an entry nobody watches is dropped after `cacheTime`, so
  navigating away and back does not re-fetch.

## What it deliberately does not do

Retries and backoff, pagination helpers, optimistic updates, and
Suspense-style integration. Each is a policy applications have real opinions
about, and each would be paid for by every application that does not need it.
The reasoning is in
[ADR-0014](../adr/0014-tag-based-cache-invalidation.md).

---

Next: [Web components](10-web-components.md).
