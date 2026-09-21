# ADR-0025: Tags as cache metadata, never as cache identity

**Status:** accepted · 2026-09-21 · completes
[ADR-0024](0024-an-invalidation-outlives-its-reader.md)

## Problem

ADR-0024 made an invalidation reach a resource that did not exist when it
happened: the store remembers what it invalidated, and the next run whose tags
match is forced. That works, and it works for **any** transport, because all it
does is raise a flag every client already honours.

What it does not do is take the wrong answer out of the cache. The stale entry
sits there until somebody asks for it and is refused, which has two costs:

- **It is paid at the reader's expense.** The first navigation back pays a
  forced request that a dropped entry would have made unnecessary to think
  about.
- **It keeps what it should not.** An answer known to be wrong stays in memory
  until its `ttl` expires or the `max` bound evicts it.

The precise thing to do is obvious — throw those entries away when the
invalidation happens — and it needs something the cache does not have: a way to
tell which entries an invalidation is about.

## Constraints

- **Identity must not become tags again.** Deriving a cache key from tags is
  the measured bug [ADR-0022](0022-resources-not-a-cache.md) exists to remove:
  two unrelated call sites carrying one tag shared an entry, and one was served
  the other's data. Whatever tags do here, they must not decide what _is_ the
  same request.
- **A transport's own cache is its own.** Apollo's and urql's caches are theirs
  and cannot be told about tags. Whatever is built here must leave them exactly
  as they are.
- **A cache must remain usable without a store.** `createCacheClient` in front
  of an algorithm has no tags and no store, and must not need either.
- **No new work at the call site.** The tags are already declared; nothing
  should have to be declared twice.

## Options

1. **Key by tags as well as by request.** Immediately rejected: it is the
   0.4.0 design with more steps, and the collision comes back the moment two
   requests share a tag.
2. **Have the store hold the cache's keys.** A map from tag to key, kept by the
   store. It knows nothing about eviction, so it would hold keys that no longer
   exist and miss entries created by clients it was not told about.
3. **Tags as metadata on the entry, and a store that empties the cache it was
   given.** The entry keeps what its request said it was about; the store calls
   `forgetTagged` when it invalidates.

## Chosen design

Option 3, and it is deliberately the _second_ half of a fix rather than a
replacement for the first.

**The request carries what it has been declared to be about.**

```ts
readonly declared?: readonly Tag[];
```

A client declares a document's tags before it looks in its cache — it has to,
because an invalidation arriving mid-flight had to find the run (ADR-0022) — so
by the time an entry is created, the request knows. The cache copies that onto
the entry and never reads it again except to forget:

```ts
const entry: Entry = { value: undefined, tags: request.declared ?? [], … };
```

**The key is untouched.** It is still `scope + request`, as
[ADR-0023](0023-one-cache-at-the-transport-edge.md) left it. Two call sites
carrying `tag('directory')` and asking for different URLs are still two
entries; the tags on them are a label, not an address. That distinction is the
whole of this ADR.

**The store empties the caches it was handed, and only those.**

```ts
const cache = createCacheClient({ ttl: 30_000 });
const store = createData({ caches: [cache] });
```

`caches` takes anything with `forgetTagged`, declared structurally, so the
store depends on no cache in particular. A cache that is not passed is not
touched — which is the right default for a transport's own, where `force`
remains the only contact.

**Both halves stay.** The store's memory (ADR-0024) reaches caches it was never
given, including somebody else's; `forgetTagged` is precise and immediate for
the one it was. An application that passes its cache gets both, and the second
makes the first almost never fire.

## Non-goals

- **Partial invalidation of a normalising cache.** Apollo's `cache.evict` is
  Apollo's, and an entity is not a tag.
- **Retrofitting tags onto an entry that was written without them.** A loader
  that declares its tags after the answer has arrived leaves an untagged entry
  behind, which `forgetTagged` will never match. That case is handled one
  layer up — [ADR-0024](0024-an-invalidation-outlives-its-reader.md) makes the
  run go again — rather than by giving the cache a way to relabel an entry
  after the fact, which would mean a second key lookup on every successful run
  to fix a case that costs one request.
- **Tags on a cache used without a store.** `read(key, produce)` in front of an
  algorithm has no tags, gets an empty array, and is never matched by
  `forgetTagged` — silence is the right answer where nothing was declared.

## Performance

`forgetTagged` walks the entries once per invalidation, comparing tags with the
same matcher the store uses. The bound is `max` — 100 by default — against an
event that happens when a person presses a button.

An entry gained a `readonly Tag[]`, which for a fetch client is the array the
resource already holds; nothing is copied per request.

## Memory

Strictly less than before: entries known to be wrong are dropped at
invalidation instead of waiting for a `ttl`.

## DX

One line to opt in, and the failure mode without it is the old behaviour rather
than a broken one. The guide says plainly which half does what, because the
difference matters exactly once — when somebody asks why a urql cache is not
being emptied, and the answer is that it is urql's.

## Rejected alternatives

- **Keying by tags** (option 1). ADR-0022, again.
- **A store-held index of keys** (option 2). The store would be guessing about
  a cache's contents, and would be wrong after the first eviction.
- **Making `caches` the default by passing the cache implicitly.** There is no
  implicit cache: `createFetchClient` may be given one, several clients may
  share one, and an application may have none. Something that must be passed to
  be true is better than something that is true only sometimes.
