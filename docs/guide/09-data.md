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

```tsx
import { GraphQLContext, createGraphQLTransport } from '@firsthandjs/query';

provide(
  GraphQLContext,
  createGraphQLTransport({
    url: '/graphql',
    headers: () => ({ authorization: `Bearer ${token.value}` }), // read per request
  }),
);
```

Errors in a GraphQL response become one thrown `FirsthandGraphQLError`, which
lands in the query's `error` cell.

Without a bundler plugin, `parseGraphQL(source)` does the same at runtime — at
the cost of the parser, which the loader path leaves out of the bundle.

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
