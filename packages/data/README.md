# @firsthandjs/data

Data that comes from outside the reactive graph, brought in as reactive state:
what is loaded, what state that is in, and when it has to be loaded again.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/09-data.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/data.md) · [ADR-0022](https://github.com/firsthandjs/firsthand/blob/main/docs/adr/0022-resources-not-a-cache.md) · [ADR-0023](https://github.com/firsthandjs/firsthand/blob/main/docs/adr/0023-one-cache-at-the-transport-edge.md)

```
npm install @firsthandjs/data
```

3.84 kB gzip. It depends on `@firsthandjs/core` and `@firsthandjs/dom`.

```tsx
const api = createFetchClient({ baseUrl: '/api' });

const user = useResource(({ request, tags }) => {
  tags(tag('user', { id: props.id }));
  return api.get<User>(`/users/${props.id}`)(request);
});

return <h1>{user.data.value?.name ?? '…'}</h1>;
```

No key, no name, no variables object. `props.id` is read inside the loader, so
changing it runs the loader again and aborts what was in flight — exactly as an
`effect` behaves, and for the same reason.

A server is the common case, not the only one: a worker, IndexedDB, a
WebSocket, a computation too expensive to repeat are all the same shape.

## Two layers

**Reactivity** — `useResource`, `useAction`, tags — knows who is watching what,
what state it is in, and when it must run again. **Transport** — a client —
knows how to send one request. Between them is one object:

```ts
type Loader<T> = (request: { signal: AbortSignal; force: boolean }) => Promise<T>;
```

`signal` ends a request nobody wants. `force` says this run exists _because_
something was invalidated, so a cache may not answer it. That is the whole
contract, which is why a loader can be any function at all.

## The cache is the transport's

A cache answers "have I got this already?", which needs to know when two things
are the same thing. A resource belongs to its call site, so that knowledge does
not exist in the reactivity layer — but at the transport it is right there in
the request.

```ts
const cache = createCacheClient({ ttl: 30_000 });

// In front of a client…
const api = createFetchClient({ baseUrl: '/api', cache });

// …or in front of anything else, which is the other half of what it is for.
const report = useResource(({ request }) =>
  cache.read(`report:${month.value}`, () => buildReport(month.value))(request),
);
```

One cache, both jobs. With no `ttl` it still shares what is in flight — ten
components asking at once make one request, which is waste removed rather than
staleness introduced. `force` drops the entry, which is how an invalidation
reaches all the way down.

**An action never touches it** — not read from, not written to, whatever its
method or key. A cache holds representations, and what an action gets back is
the answer to doing something.

A key is an **identity** and a **request**: `GET /api/me` is the same URL for
everybody, so the identity — the `authorization` header by default, or a
`scope` function you give — is what stops one account being served the answer
cached for another.

## Tags are for invalidation

They may be coarse, they may overlap, and two unrelated sources may share one.
Nothing is ever looked up by them, which is what makes that safe.

```tsx
const rename = useAction((name: string, { request, invalidates }) => {
  invalidates(tag('user', { id: props.id }), tag('users'));
  return api.patch<User>(`/users/${props.id}`, { json: { name } })(request);
});
```

`tags()` **replaces**, so a run says what it is about rather than accumulating
what it used to be about — and it may be called after the answer, for the case
where only the server knows which user `/users/me` was.

## Bringing a client

`createFetchClient` is a small REST client on the browser's own `fetch`: a base
URL, headers read per request so a token may change, a failed status thrown,
the abort signal wired through, and the cache.

For anything else, [`@firsthandjs/data-axios`](https://www.npmjs.com/package/@firsthandjs/data-axios),
[`-urql`](https://www.npmjs.com/package/@firsthandjs/data-urql) and
[`-apollo`](https://www.npmjs.com/package/@firsthandjs/data-apollo) bind an
instance **you** built: your interceptors, your links, your authentication.
None of them depends on the client it binds, so none has a version to follow.

For GraphQL, tags come out of the `.gql` file as `@tag` / `@invalidates`
directives, read at build time by `@firsthandjs/data/vite` and typed by
`@firsthandjs/data/codegen`. The document that reaches your client is a plain
object with the directives already removed.

## What it deliberately does not do

Interceptors, retries, backoff, token refresh, progress events, XSRF,
normalisation, optimistic cache surgery, pagination helpers. Each belongs to a
transport or to an application's own policy — and a loader takes any client,
because it takes any function.

MIT licensed.
