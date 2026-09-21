# @firsthandjs/data-apollo

Apollo Client as a client for [`@firsthandjs/data`](https://www.npmjs.com/package/@firsthandjs/data).

```
npm install @firsthandjs/data-apollo
```

0.61 kB gzip. It has **no dependency on Apollo** and no peer dependency either —
the three methods it uses are declared structurally. That also keeps your copy
of `graphql` the only copy, which is a category of afternoon worth avoiding.

```tsx
import { gql } from '@apollo/client';
import { createApolloClient } from '@firsthandjs/data-apollo';
import { useAction, useResource } from '@firsthandjs/data';
import InvoicesDocument from './invoices.gql';

export const billing = createApolloClient(apollo, gql, {
  // Read per request and untracked: the token may change, and a resource must
  // not depend on it.
  headers: () => ({ authorization: `Bearer ${session.token.peek()}` }),
});

function Invoices() {
  const invoices = useResource(({ request }) =>
    billing.query(InvoicesDocument, { month: month.value })(request),
  );
  return <List items={invoices.data.value?.invoices ?? []} />;
}
```

`createApolloClient(client, parse, options?)` takes the parse function too —
`gql` from `@apollo/client`, or `parse` from `graphql` — because Apollo wants a
parsed `DocumentNode` and that parser should be yours, not ours.

## The client

```ts
billing.query(Document, variables); // a loader; declares @tag
billing.mutate(Document, variables); // a loader; declares @invalidates
billing.watch(Document, variables); // what `fromObservable` takes
billing.with({ options: { errorPolicy: 'all' } }); // a variation
```

An operation with required variables cannot be called without them: the
generated types travel with the document.

## The decision this package leaves to you: the cache

Apollo requires an `InMemoryCache`, and it is a _normalising_ cache — a
different thing from a store of resources. There are two ways to run them
together, and only two:

- **Apollo as transport.** The resources are your state. `force` is passed on
  as `fetchPolicy: 'network-only'`, so an invalidation reaches past the cache;
  set `no-cache` on the client if you want it out of the way entirely.
- **Apollo as the store.** Use `watch` instead. One write in Apollo's cache
  then updates every view of that entity at the same moment, which is what a
  per-call-site resource cannot do:

  ```tsx
  const user = fromObservable(...billing.watch(UserDocument, { id: props.id }));
  ```

What is not on the list is both at once, with the same data living in two
places under two invalidation rules. See
[ADR-0022](https://github.com/firsthandjs/firsthand/blob/main/docs/adr/0022-resources-not-a-cache.md).

## Tags come out of the document

`@firsthandjs/data/vite` reads `@tag` and `@invalidates` at build time and
strips them, so what reaches Apollo is a plain GraphQL document. A query
declares its `@tag` directives before the request goes out; a mutation declares
its `@invalidates` — and inside an action the request's tags _are_ the store's
invalidation, so nothing at the call site wires them:

```tsx
const pay = useAction((id: string, { request }) => billing.mutate(PayDocument, { id })(request));
```

MIT licensed. See the [data guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/09-data.md#apollo).
