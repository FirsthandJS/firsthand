# @firsthandjs/query

Data fetching and caching for REST and GraphQL, invalidated by **tags** rather
than by cache keys.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/09-data.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/query.md) · [all docs](https://github.com/firsthandjs/firsthand/blob/main/docs/README.md)

```
npm install @firsthandjs/query
```

3.32 kB gzip — 2.21 kB with the `.graphql` loader, which leaves the document
parser out of the bundle. No dependencies other than `@firsthandjs/core` and
`@firsthandjs/dom`.

## Why tags

In React Query a query's key is two things at once: its identity in the cache,
and the handle everyone else uses to invalidate it. A mutation therefore has to
know the key shapes other people wrote — `['user', id]`, `['users', filter]`,
`['org', orgId, 'members']` — and stay in step with them for ever.

A tag says what a query is _about_, and a query may carry several:

```ts
tags: [tag('user', { id: 7 }), tag('permissions', { org: 3 })];
```

A mutation then says what it changed, not who should re-run:

```ts
invalidates: (_result, input) => [tag('user', { id: input.id }), tag('users')];
```

Every query carrying a matching tag is invalidated — the ones being watched go
to the network at once, the rest on next use. A tag with fewer variables matches
more, so `tag('user')` means _every_ user, which is the right answer for "I
changed something and I do not know exactly what".

## Reading a query

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

The definition is a **thunk** because a component body runs once: when `id`
changes, the thunk is re-evaluated, the subscription moves to the entry for the
new id, and the cells the view reads start reporting that entry. The component
is not re-created and nothing above it re-renders.

`data`, `error`, `status` and `fetching` are cells belonging to the _cache
entry_, not to the component. Two components asking for the same tags read the
very same cells, which is why a refetch anywhere shows up everywhere without a
subscription list: there is no copy to keep in sync.

| Cell       | Values                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| `status`   | `idle`, `pending` (nothing to show yet), `success`, `error`             |
| `fetching` | `true` while a request is in flight, **including** a background refetch |
| `data`     | The last successful value; kept visible during a refetch                |
| `error`    | What the last failed attempt threw                                      |

`refetch()` goes to the network; `refetch({ force: false })` is how you ask for
the cache. An options object that says nothing behaves exactly like no options
object at all.

## Variables

A query is identified by its tags **and** its variables. Anything the fetcher
reads that can change belongs in one of the two:

```tsx
const rows = useQuery<Row[], { page: number; sort: string }>(() => ({
  tags: [tag('rows')],
  variables: { page: page.value, sort: sort.value },
  fetch: ({ variables, signal }) =>
    json<Row[]>(`/api/rows?page=${String(variables.page)}&sort=${variables.sort}`)({ signal }),
}));
```

Change `page` and the query moves to that page's entry and fetches it; change
it back and the first entry answers without a request. One `tag('rows')` still
invalidates every page, because tags are about _what the data is_, not which
copy of it you are looking at.

A value in neither a tag nor `variables` would be captured in the fetcher's
closure and never noticed — the entry would answer for ever out of its first
result. That is the one mistake this API can still let you make, and it is why
`variables` exists rather than leaving you to remember to put the page number
in a tag.

## Writing

```tsx
const rename = useMutation({
  mutate: (input: { id: number; name: string }) =>
    json('/api/rename', { method: 'POST', body: JSON.stringify(input) }),
  invalidates: (_result, input) => [tag('user', { id: input.id }), tag('users')],
  onSuccess: () => toast('Renamed'),
});

<button onClick={() => void rename.mutate({ id, name })} disabled={rename.fetching.value}>
  Rename
</button>;
```

`mutate` never rejects: a failure lands in `error` and `status`, and the promise
resolves with `undefined`. An `onClick` that forgets to `await` therefore cannot
produce an unhandled rejection.

## GraphQL, with the tags in the document

A `.graphql` file already says what it reads. Repeating that in TypeScript is
how a cache drifts out of step with its queries, so the tag assignment lives in
the document:

```graphql
query User($id: ID!) @tag(name: "user", id: $id) @tag(name: "permissions") {
  user(id: $id) {
    id
    name
  }
}
```

```graphql
mutation RenameUser($id: ID!, $name: String!)
@invalidates(name: "user", id: $id)
@invalidates(name: "users") {
  renameUser(id: $id, name: $name) {
    id
  }
}
```

```tsx
import UserQuery from './user.graphql';
import RenameUser from './rename-user.graphql';

const user = useGraphQL<{ user: User }>(UserQuery, () => ({ id: props.id }));
const rename = useGraphQLMutation<{ id: string; name: string }, unknown>(RenameUser);
```

`name` is the tag's name; every other argument is a tag variable. `$id` is
bound from the variables the call passes, so one directive covers every user. A
variable the call leaves out widens the tag instead of producing
`user(id: undefined)`, which would match nothing.

Arguments may be literals too — `@tag(name: "report", kind: "monthly", limit:
20)` — a document may carry as many directives as it likes, and they may sit on
a field rather than on the operation if that reads better:

```graphql
query Dashboard($org: ID!) {
  members(org: $org) @tag(name: "members", org: $org) {
    id
  }
  billing(org: $org) @tag(name: "billing", org: $org) {
    plan
  }
}
```

**The directives never reach the server.** They are instructions to the cache,
and a server that has not declared them in its schema would reject the whole
query — so they are stripped from the document before it is sent, the same way
Apollo strips `@connection`. A malformed one throws: with the Vite loader that
is a build error, which is where a typo in a cache instruction belongs.

### Importing `.graphql` files

```ts
// vite.config.ts
import { graphql } from '@firsthandjs/query/vite';

export default defineConfig({ plugins: [graphql()] });
```

The plugin parses at build time, so the parser never reaches the browser and a
malformed directive fails the build rather than a page. Declare the module type
once:

```ts
declare module '*.graphql' {
  const document: import('@firsthandjs/query').GraphQLDocument;
  export default document;
}
```

Without a bundler plugin, `parseGraphQL(source)` does the same at runtime — at
the cost of the 1.1 kB gzip the loader path shakes out.

## Setting it up

```tsx
import { createQueryClient, QueryClientContext, GraphQLContext } from '@firsthandjs/query';
import { createGraphQLTransport } from '@firsthandjs/query';

const App = component(() => {
  provide(QueryClientContext, createQueryClient({ staleTime: 30_000 }));
  provide(GraphQLContext, createGraphQLTransport({ url: '/graphql' }));
  return <Shell />;
});
```

| Option      | Meaning                                                       | Default |
| ----------- | ------------------------------------------------------------- | ------- |
| `staleTime` | How long a result is reused without going to the network      | `0`     |
| `cacheTime` | How long an entry nobody watches is kept before it is dropped | 5 min   |

Per query, `staleTime` can be overridden, and `key` separates two queries that
genuinely share tags — a list and its count, say. Tags still decide
invalidation; the key only decides which entry the data lands in.

## Authentication

Two options, both functions, and no plugin system. `headers` is called once
per request, so a token read from a signal is always the current one:

```tsx
createGraphQLTransport({
  url: '/graphql',
  headers: () => (token.value === null ? {} : { authorization: `Bearer ${token.value}` }),
  // Wraps the request: where a rejected token ends the session.
  fetch: async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 401) {
      token.value = null;
      client.clear();
    }
    return response;
  },
});
```

Reading a signal in `headers` does not make it a dependency of the queries
going out, so writing the token does not re-fetch every watched query. The
worked version, including what the server has to answer:
[Authentication](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/09-data.md#authentication).

## What it does for you

- **Deduplicates**: ten components asking at once make one request.
- **Aborts**: a superseded request's `AbortSignal` fires, and the late answer is
  ignored rather than overwriting a newer one.
- **Keeps the last value visible** during a refetch, with `fetching` true — no
  flash of nothing between a click and an answer.
- **Collects**: an entry nobody watches is dropped after `cacheTime`, so
  navigating away and straight back does not re-fetch.

## What it deliberately does not do

- Retries and backoff. A wrapper around `fetch` does that in five lines and
  knows your API's rules better than a cache does.
- Pagination and infinite lists. They are a data shape, not a cache concern.
- Optimistic updates. Planned; for now a mutation invalidates and the truth
  comes from the server.
- Suspense-style integration. `status` and `fetching` are cells; a view reads
  them where it needs them.
