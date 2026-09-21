# ADR-0014: Invalidation by tags, not by cache keys

Status: **superseded** by [ADR-0022](0022-resources-not-a-cache.md) (2026-09-21)

Tags survived; the cache around them did not. Identity derived from tags turned
out to make two unrelated call sites share one entry, which
[ADR-0022](0022-resources-not-a-cache.md) records with the measurement. What
follows is the original decision, kept because the argument for tags over keys
is still the argument this project makes.

## Problem

Applications need a cache in front of the network: deduplicated requests, a
shared result, a way to say "this is wrong now, fetch it again". React Query is
the shape people know, and the brief asks for a replacement that works for REST
_and_ GraphQL, where invalidation is expressed in tags rather than in one cache
key, tags may carry variables, a query may have several, and a mutation may
invalidate several queries at once.

The problem with the key-as-handle design is not performance, it is coupling. A
key is a query's identity, so it is written by whoever wrote the query; making
it also the invalidation handle means every mutation has to know the key shapes
other people chose, and stay in step with them. The information the mutation
actually has is different: it knows _what it changed_, not who is watching.

## Constraints

- A query carries several tags; a tag carries variables.
- One mutation invalidates every query carrying a matching tag, without naming
  any of them.
- Results are cached, can be forced to the network, and can be re-fetched by
  hand.
- A re-fetched value appears in every view reading it, with no subscription
  bookkeeping in the application.
- Status is observable — at least "is a request in flight".
- GraphQL documents declare their own tags, in the `.graphql` file.
- No dependency, and nothing in the browser that only a build needs.

## Options considered

1. **React Query's model, ported.** Key-as-handle plus prefix matching. Familiar
   and rejected by the brief, and prefix matching makes the _order_ of a key's
   segments a public contract — `['user', id, 'posts']` can be invalidated by
   user but not by posts.
2. **Normalised entity cache** (Apollo, urql's graphcache). Responses are
   flattened into entities by id, and a mutation returning a user patches every
   query mentioning that user, with no invalidation at all. Genuinely better
   _when it works_: it needs ids everywhere, schema knowledge, and merge policies
   for every list, and it does not apply to REST at all. Far more than 3 kB.
3. **Tags, separate from identity.** Chosen. Identity defaults to the tags, so
   the usual query writes one thing; `key` separates the rare two queries that
   share tags.

## Chosen design

**A tag is a name plus variables.** `tag('user', { id: 7 })`. Matching is: same
name, and every variable the _pattern_ names has the same value on the
candidate. Variables the pattern leaves out are wildcards, so `tag('user')`
covers every user and `tag('user', { id: 7 })` covers exactly one. That single
rule replaces prefix matching and does not depend on the order anything was
written in.

**An entry holds signals, not a snapshot.** `data`, `error`, `status` and
`fetching` are cells on the cache entry. Every component that asks for the same
tags reads the same cells, so a refetch updates all of them with no subscriber
list, no copies, and no comparison — this is the whole of "a refetched value is
displayed automatically".

**Definitions are thunks.** `useQuery(() => ({ tags: [...], fetch }))`. A
component body runs once, so a plain object would freeze the variables at setup.
Re-evaluating the thunk moves the subscription to another entry when a variable
changes, which is an ordinary reactive update rather than a re-render.

**Invalidation is two-speed.** A matching entry is marked invalid; if someone is
watching it, it re-fetches immediately, otherwise on next use. A cache that
re-fetched everything would turn one mutation into a thundering herd.

**GraphQL directives.** `@tag(name: "user", id: $id)` on the operation or on a
field, bound against the call's variables. Real directives rather than
comments, because a comment is not part of the language and every tool in the
chain — formatters, linters, editors — treats it as noise; a directive is
syntax those tools already understand.

They are removed from the document before it is sent. A server that has not
declared `@tag` in its schema rejects the whole query, and declaring a
directive in the schema for something only the client cares about is a strange
thing to ask of an API — Apollo strips `@connection` for the same reason. The
stripping is a hand-written scanner that knows where strings and comments are
(about eighty lines) rather than a GraphQL parser, which is several times the
size of this whole package. It lives in a module that imports nothing but tags,
so the build-time `.graphql` loader can use it without pulling the runtime in,
and an application using the loader ships no parser at all.

A malformed directive throws, which under the loader is a build failure.

## Performance implications

- One `Map` lookup per read; matching runs only during invalidation, over
  entries, not over components.
- Requests are deduplicated per entry, and a superseded request is aborted —
  its late answer is dropped rather than overwriting a newer one.
- 3.23 kB gzip, measured by `npm run build`, outside the runtime budget —
  2.14 kB for an application that uses the `.graphql` loader, because the
  document parser is then unreachable and tree-shaken out. Both figures are
  measured, not estimated.
- Invalidation is O(entries × patterns × tags). Entries are dropped
  `cacheTime` after the last watcher, so that product stays proportional to what
  the application is actually showing.

## Memory implications

- One entry per query identity, four signals each.
- An entry with no watchers is dropped after `cacheTime`, cancelling any
  in-flight request. Re-subscribing before then cancels the collection, so
  navigating away and back does not re-fetch.
- The hooks hold nothing beyond the cells: a component leaving releases its hold
  through the ordinary owner tree.

## DX implications

- A mutation is written in terms of what it changed. It cannot fall out of step
  with key shapes it does not know about.
- A GraphQL query's tags are next to the query, in the file people edit when the
  query changes.
- `status` and `fetching` are separate on purpose: "I have nothing to show" and
  "I am asking again" are different states, and conflating them is what produces
  a spinner over data that is already correct.
- The cost is one concept more than React Query: identity and invalidation are
  no longer the same string.

## Rejected alternatives

- **Prefix-matched keys.** See option 1.
- **A normalised entity cache.** See option 2. It is the right answer for a
  GraphQL-only application with ids everywhere; it is the wrong shape for a
  3 kB package that must also serve REST.
- **Retries, backoff, pagination helpers, optimistic updates.** Each is a policy
  an application has real opinions about, and each would be paid for by every
  application that does not.
- **Suspense-style throwing.** A promise thrown to an ancestor is a control-flow
  trick for a re-render model. Here a cell that is `undefined` until it is not
  already says the same thing, locally.
