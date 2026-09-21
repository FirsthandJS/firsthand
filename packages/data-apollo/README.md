# @firsthandjs/data-apollo

Apollo Client documents as loaders for [`@firsthandjs/data`](https://www.npmjs.com/package/@firsthandjs/data).

```
npm install @firsthandjs/data-apollo
```

0.37 kB gzip. It has **no dependency on Apollo** and no peer dependency either —
the three methods it uses are declared structurally. That also keeps your copy
of `graphql` the only copy, which is a category of afternoon worth avoiding.

```tsx
import { gql } from '@apollo/client';
import { apolloLoader } from '@firsthandjs/data-apollo';
import { useResource } from '@firsthandjs/data';
import InvoicesDocument from './invoices.gql';

const billing = apolloLoader(apollo, gql);

function Invoices() {
  const invoices = useResource((context) =>
    billing(InvoicesDocument, { month: month.value })(context),
  );
  return <List items={invoices.data.value?.invoices ?? []} />;
}
```

`apolloLoader(client, parse)` takes the parse function too — `gql` from
`@apollo/client`, or `parse` from `graphql` — because Apollo wants a parsed
`DocumentNode` and that parser should be yours, not ours.

## The decision this package leaves to you: the cache

Apollo requires an `InMemoryCache`, and it is a _normalising_ cache — a
different thing from a store of resources. There are two ways to run them
together, and only two:

- **Apollo as transport.** The resources are your state. `force` is passed on
  as `fetchPolicy: 'network-only'`, so an invalidation reaches past the cache;
  set `no-cache` on the client if you want it out of the way entirely.
- **Apollo as the store.** Use `apolloObservable` instead. One write in
  Apollo's cache then updates every view of that entity at the same moment,
  which is what a per-call-site resource cannot do:

  ```tsx
  const user = fromObservable(...apolloObservable(apollo, gql)(UserDocument, { id: props.id }));
  ```

What is not on the list is both at once, with the same data living in two
places under two invalidation rules. See
[ADR-0022](https://github.com/firsthandjs/firsthand/blob/main/docs/adr/0022-resources-not-a-cache.md).

## Tags come out of the document

`@firsthandjs/data/vite` reads `@tag` and `@invalidates` at build time and
strips them, so what reaches Apollo is a plain GraphQL document. A query
declares its `@tag` directives before the request goes out — so an invalidation
arriving mid-flight still finds it — and a mutation declares its `@invalidates`,
which an action hands straight to the store:

```tsx
const pay = useAction((id: string, { signal, invalidates }) =>
  billing(PayDocument, { id })({ signal, force: true, tags: invalidates }),
);
```

MIT licensed. See the [data guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/09-data.md).
