# ADR-0024: An invalidation outlives the resource that was watching

**Status:** accepted · 2026-09-21 · completes
[ADR-0023](0023-one-cache-at-the-transport-edge.md)

## Problem

An invalidation reaches every resource that is **alive**. That is the whole
mechanism, and it has a hole in it that a kanban board found in ten seconds:

1. The board list is on screen. It loads, and the client keeps the answer.
2. You open a board and move a card. The mutation's document carries
   `@invalidates(name: "boards")`, so the store invalidates that tag — and
   nothing is watching the list, so it reaches nobody.
3. You walk back. The list page mounts, which **creates** a resource rather
   than reloading one. A new resource has never been invalidated, so it runs
   with `force: false`, and the client hands it the answer from step 1.

The card counts are wrong, nothing looks broken, and every layer did exactly
what it was told. The store cannot fix it alone — the resource did not exist
when the invalidation happened — and the cache cannot fix it alone, because it
has never heard of a tag.

The workaround an application reaches for is to stop caching that request,
which is what the showcase did while this was being decided. That works and it
is a shame: the list is exactly the sort of thing a cache is for.

## Constraints

- **Tags stay out of the transport.** [ADR-0022](0022-resources-not-a-cache.md)
  put identity in the transport and invalidation in the store on purpose. A
  cache that matched tags would be the store again, one layer down.
- **No new call at the call site.** If the fix is "remember to pass `force`
  when you mount a list", it is not a fix.
- **It must forget.** A memory of invalidations that grows is a leak, and one
  that never expires makes every resource created afterwards skip the cache
  for ever.
- **It must not force twice.** Once somebody has been to the server about
  those tags, the transport holds a current answer and the next reader should
  be allowed to have it.

## Options

1. **Teach the cache about tags.** `cache.read(key, produce, tags)`, and
   `invalidate` drops matching entries. Direct, and it puts the store's
   vocabulary in the transport — the thing ADR-0022 spent its length refusing.
2. **Keep a resource alive after its component.** A detached resource that
   outlives the page so it can be invalidated. That is a cache with subscribers
   attached, and it brings back `cacheTime` and everything under it.
3. **Give the store a short memory.** It remembers what was invalidated and
   when; a resource whose run declares one of those tags runs with `force`.

## Chosen design

Option 3.

```ts
createData({ remember: 60_000 }); // the default
```

**The store keeps what it invalidated, with a timestamp.** A resource declares
its tags in the middle of a run — before a client asks its cache, which is what
makes this possible at all — and at that moment the store is asked whether an
invalidation it never saw applies:

```ts
const request: DataRequest = {
  signal: controller.signal,
  get force(): boolean {
    return forced; // raised by `tags()`, read by the client afterwards
  },
  tags: declare,
};
```

`force` is a **getter** for that reason. A client reports the document's tags,
the store raises the flag, and the cache lookup that follows sees it. Nothing
at the call site changed, and no client needed a new hook: they already declare
tags before they read, because an invalidation arriving mid-flight had to find
them (ADR-0022).

**An invalidation is owed until somebody pays it.** When a run with matching
tags succeeds, the store drops the memory: the transport now holds an answer
from after the change, and the next resource to appear may have it. Without
that rule, one invalidation would force every resource created in the following
minute.

**And tags that arrive too late are honoured anyway.** The design above rests
on a client declaring tags _before_ it reads `force`, which every client in
this project does. A loader that cannot — one that only learns what it fetched
from the reply — would otherwise get the worst of both halves: the cache
answered before the flag went up, the entry it answered from carries no tags
for [ADR-0025](0025-tags-as-cache-metadata.md) to drop, and the run would then
_settle_ the invalidation it had just failed to act on.

So the request notices whether it has been asked. If `force` was read before
the tags were known, raising it is too late to matter and the run is marked
**superseded** instead — the same mark an invalidation arriving mid-flight
leaves, and the same consequence: go again, with `force`, now that the tags
exist. A superseded run settles nothing, because it never reached the server.

The cost is one extra request, in one case: a late declaration that matches an
invalidation from the last `remember` window. Declaring first remains the fast
path and the documented one.

**And it expires.** `remember` is a window rather than a permanent record,
because the memory is about a _cache's contents_ and a cache entry does not
live for ever. A minute is longer than any sensible `ttl` and short enough to
be forgotten; `remember: 0` switches the whole thing off and restores 0.6.x
behaviour exactly.

## Non-goals

- **Invalidating a transport's own cache.** Apollo's and urql's caches are
  theirs; `force` reaches past them and that is the contract. This is about
  the cache we ship, and about any other that honours `force`.
- **Persisting the memory.** A reload empties both the store and the cache, so
  there is nothing to reconcile.

## Performance

One array of `{ patterns, at }`, filtered on read and emptied by success. The
check runs once per declaration — that is once per resource run, over at most
as many entries as there have been invalidations in the last minute, which in
an application under a person's hands is a single-digit number.

The request object gained a getter in place of a field. That is one property
access per client, on a path that is already doing a network request.

## Memory

Bounded by time rather than by count, which is the right bound here: entries
older than `remember` are dropped on the next read, and `clear()` empties them
with everything else.

## DX

What a developer does about this: nothing. That is the measure.

What they can do, if they want it: `remember: 0` to switch it off, or a longer
window if their cache's `ttl` is longer than a minute — the two numbers are
related, and the documentation says so.

## Rejected alternatives

- **Tags in the cache** (option 1). The clean version of this design, if the
  layers were not what ADR-0022 says they are. Revisit only with that ADR.
- **`invalidate({ persist: true })`.** An opt-in flag, so the case that is
  invisible until it bites is also the one somebody has to know about first.
- **Forcing every first run of a resource.** Correct, trivial, and it makes
  the cache useless for exactly the navigation it exists to serve.
