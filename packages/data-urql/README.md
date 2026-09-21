# @firsthandjs/data-urql

urql as a client for [`@firsthandjs/data`](https://www.npmjs.com/package/@firsthandjs/data).

```
npm install @firsthandjs/data-urql
```

0.58 kB gzip. It has **no dependency on urql** and no peer dependency either —
the two methods it uses are declared structurally. It was checked against
`@urql/core` 6, which has no React dependency of its own.

```tsx
import { Client, fetchExchange } from '@urql/core';
import { createUrqlClient } from '@firsthandjs/data-urql';
import { useAction, useResource } from '@firsthandjs/data';
import InvoicesDocument from './invoices.gql';
import PayDocument from './pay.gql';

export const billing = createUrqlClient(
  new Client({ url: '/graphql', exchanges: [fetchExchange] }),
  // Read per request and untracked: the token may change, and a resource must
  // not depend on it.
  { headers: () => ({ authorization: `Bearer ${session.token.peek()}` }) },
);

function Invoices() {
  const invoices = useResource(({ request }) =>
    billing.query(InvoicesDocument, { month: month.value })(request),
  );
  const pay = useAction((id: string, { request }) => billing.mutate(PayDocument, { id })(request));

  return <List items={invoices.data.value?.invoices ?? []} onPay={(id) => void pay.run(id)} />;
}
```

`month.value` is read inside the loader, so changing the month runs the query
again and aborts the one in flight.

## Tags come out of the document

`@firsthandjs/data/vite` reads `@tag` and `@invalidates` directives at build
time and strips them, so what reaches urql is a plain GraphQL document.

```graphql
query Invoices($month: String!) @tag(name: "invoices", vars: ["month"]) {
  invoices(month: $month) {
    id
    total
  }
}

mutation Pay($id: ID!) @invalidates(name: "invoices") {
  pay(id: $id) {
    id
    paidAt
  }
}
```

`query` declares the `@tag` directives into the request before it goes out — so
an invalidation arriving mid-flight still finds it — and `mutate` declares the
`@invalidates`. Inside an action the request's tags _are_ the store's
invalidation, so neither call site writes a tag at all.

## The decision this package leaves to you: `cacheExchange`

- **Without it,** urql is your transport and the resources are your state. Pass
  `cache: { ttl }` here if you want one anyway; it is the same cache the rest
  of `@firsthandjs/data` uses, queries only, keyed by operation and variables.
- **With it,** urql also caches — a real choice, not a default worth inheriting
  from a helper. `force` is passed on as `requestPolicy: 'network-only'`, so an
  invalidation reaches past it.

If you do give this client a cache, its keys carry the operation, the variables
(in any order they were written) and an identity — the `authorization` header
by default, or a `scope` you give — so two accounts in one session cannot read
each other's answers.

What you should not have is two caches over one piece of data, because they
disagree. If urql's cache should be the source of truth for an entity shown in
many places, subscribe to it with `fromObservable` instead.

MIT licensed. See the [data guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/09-data.md#urql).
