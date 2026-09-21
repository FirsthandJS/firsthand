# @firsthandjs/data

Resources, actions and invalidation for Firsthand: what is loaded, as reactive
state, and when it has to be loaded again.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/09-data.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/data.md) · [ADR-0022](https://github.com/firsthandjs/firsthand/blob/main/docs/adr/0022-resources-not-a-cache.md)

```
npm install @firsthandjs/data
```

2.81 kB gzip. It depends on `@firsthandjs/core` and `@firsthandjs/dom`.

```tsx
const user = useResource(async ({ signal, tags }) => {
  tags(tag('user', { id: props.id }));
  return json<User>(`/api/users/${props.id}`)({ signal });
});

return <h1>{user.data.value?.name ?? '…'}</h1>;
```

No key, no name, no variables object. `props.id` is read inside the loader, so
changing it runs the loader again and aborts what was in flight — exactly as an
`effect` behaves, and for the same reason.

## What it is not

**It is not a cache.** A cache is defined by a second lookup for the same thing
finding the first one's result, and that needs identity: a key, a name,
something two callers agree on. Every form of that is a thing to forget or
collide on. A resource belongs to its call site instead, and two call sites are
two resources whatever their tags say.

Deduplication, response caching and normalisation belong one layer down, where
the knowledge of what is _the same thing_ actually lives — Apollo's cache, urql's
`cacheExchange`, the browser's HTTP cache, or three lines of your own.

| Layer         | Owns                                     | Who                           |
| ------------- | ---------------------------------------- | ----------------------------- |
| Normalisation | one entity, one truth, everywhere        | Apollo, urql-graphcache       |
| Request cache | not asking twice                         | those clients, the HTTP cache |
| **Resources** | **reactive state, status, invalidation** | **this package**              |

## Tags are for invalidation

They may be coarse, they may overlap, and two unrelated sources may share one.
That is the feature — and it is safe, because they are not identity.

```tsx
const rename = useAction(async (input: Rename, { signal, invalidates }) => {
  const changed = await json<Changed>(`/api/users/by-name/${input.name}`, {
    method: 'PATCH',
    json: input,
    signal,
  })({ signal });
  // The client knew a name; only the server knows which id that was.
  invalidates(...changed.tags);
  return changed.user;
});
```

Declare them where you know them: before the `await` when the caller does,
after it when only the server does. `tags()` **replaces**, so a run says what
it is about rather than accumulating what it used to be about.

## Reaching past a cache

The loader is told _why_ it is running. Without that, a transport cache would
hand back the answer that was just invalidated:

```tsx
useResource(async ({ signal, force }) =>
  json<User>('/api/users/5', { cache: force ? 'reload' : 'default' })({ signal }),
);
```

`fetchPolicy: 'network-only'` for Apollo, `requestPolicy` for urql — the
helper packages do it for you.

## Bringing a client

`@firsthandjs/data-axios`, `-urql` and `-apollo` bind an instance **you** built:
your interceptors, your links, your authentication. None of them depends on the
client it binds, so none of them has a version to follow.

For GraphQL, tags come out of the `.gql` file as `@tag` / `@invalidates`
directives, read at build time by `@firsthandjs/data/vite` and typed by
`@firsthandjs/data/codegen`. The document that reaches your client is a plain
object with the directives already removed.

## What it deliberately does not do

Interceptors, retries, backoff, token refresh, request de-duplication, progress
events, XSRF, a Node adapter, normalisation, optimistic cache surgery,
pagination helpers. Each belongs to a transport or to an application's own
policy — and a loader takes any client, because it takes any function.

MIT licensed.
