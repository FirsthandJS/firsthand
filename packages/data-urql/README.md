# @firsthandjs/data-urql

urql documents as loaders for [`@firsthandjs/data`](https://www.npmjs.com/package/@firsthandjs/data).

```
npm install @firsthandjs/data-urql
```

0.30 kB gzip. It has **no dependency on urql** and no peer dependency either —
the two methods it uses are declared structurally. It was checked against
`@urql/core` 6, which has no React dependency of its own.

```tsx
import { Client, fetchExchange } from '@urql/core';
import { urqlLoader } from '@firsthandjs/data-urql';
import { useResource } from '@firsthandjs/data';
import InvoicesDocument from './invoices.gql';

const billing = urqlLoader(
  new Client({
    url: '/graphql',
    exchanges: [fetchExchange],
    fetchOptions: () => ({ headers: { authorization: `Bearer ${session.token.value}` } }),
  }),
);

function Invoices() {
  const invoices = useResource((context) =>
    billing(InvoicesDocument, { month: month.value })(context),
  );
  return <List items={invoices.data.value?.invoices ?? []} />;
}
```

`month.value` is read inside the loader, so changing the month runs the query
again and aborts the one in flight.

## Tags come out of the document

`@firsthandjs/data/vite` reads `@tag` and `@invalidates` directives at build
time and strips them, so what reaches urql is a plain GraphQL document. This
package binds them against the variables of the call and declares them _before_
the request goes out — so an invalidation arriving mid-flight still finds it.

```graphql
query Invoices($month: String!) @tag(name: "invoices", vars: ["month"]) {
  invoices(month: $month) {
    id
    total
  }
}
```

## The decision this package leaves to you: `cacheExchange`

- **Without it,** urql is your transport and the resources are your state. One
  source of truth.
- **With it,** urql also caches — which is a real choice, not a default worth
  inheriting from a helper. `force` is passed on as
  `requestPolicy: 'network-only'`, so an invalidation reaches past that cache.

If you want urql's cache to be the source of truth for an entity shown in many
places at once, subscribe to it with `fromObservable` instead of loading it
per call site. See [ADR-0022](https://github.com/firsthandjs/firsthand/blob/main/docs/adr/0022-resources-not-a-cache.md).

## Mutations

A document whose `kind` is `mutation` goes to `client.mutation`, and what it
declares is its `@invalidates` directives — so an action hands the document's
own declaration straight to the store:

```graphql
mutation Pay($id: ID!) @invalidates(name: "invoices") {
  pay(id: $id) {
    id
    paidAt
  }
}
```

```tsx
const pay = useAction((id: string, { signal, invalidates }) =>
  billing(PayDocument, { id })({ signal, force: true, tags: invalidates }),
);
```

MIT licensed. See the [data guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/09-data.md).
