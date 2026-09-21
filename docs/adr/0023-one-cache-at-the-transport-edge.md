# ADR-0023: One cache, at the transport edge

**Status:** accepted · 2026-09-21 · completes
[ADR-0022](0022-resources-not-a-cache.md)

## Problem

ADR-0022 moved caching out of the resource layer and said it belongs to the
transport, "where the knowledge of what is the same thing actually lives". That
is right, and it left a hole: an application that brings no client has no
transport to put a cache in.

The result was a layer that answers _"who is watching this and when must it run
again"_ sitting on top of a layer that, for anyone using plain `fetch`, has no
memory at all. Two concrete consequences:

1. **Every mount is a request.** Ten components asking for the same user make
   ten requests — which is not staleness, it is waste, and the fix does not
   need any of the machinery a real cache needs.
2. **An invalidation could not reach a cache that did exist.** `force` was a
   flag on the load context, and the call site had to remember to translate it
   into `cache: 'reload'`, `fetchPolicy: 'network-only'` or `requestPolicy`. A
   forgotten translation makes an invalidation _silently_ pointless: the
   resource re-runs, the client answers from memory, and the screen keeps
   showing what was just declared wrong.

The second is the serious one. It is a correctness bug with no symptom at the
place where the mistake is made.

## Constraints

- **One cache.** Two caches over the same data disagree, and the disagreement
  is a bug nobody can reproduce — the argument ADR-0022 already made about
  Apollo's cache and ours.
- **Not in the resource layer.** Identity is the call site there. A cache needs
  a key, and inventing one per resource is what ADR-0022 removed.
- **Useful without a server.** The same memory should serve an expensive
  computation, a worker round trip, a read out of IndexedDB. Caching is not a
  network idea.
- **Lifetimes are the application's to choose**, so they are configuration, not
  a constant in our source.
- **An invalidation must reach through it**, without the call site remembering
  anything.

## Options

1. **Leave it out; tell people to bring a client.** Honest, and what 0.5.0 did.
   It makes the smallest application — `fetch`, no dependencies — the one with
   the worst behaviour, and leaves the `force` translation to every call site.
2. **Put a cache back in the store, behind a flag.** Rejected for the reasons
   ADR-0022 gives: it needs identity, and identity in that layer is a key
   somebody has to invent and never collide on.
3. **A cache client at the transport edge, and `force` inside the request.**
   The cache is a thing you create and pass; clients take it; and the signal
   and the reason-for-running travel together as one object that every client
   is given.

## Chosen design

Option 3.

**The request is one object.** `DataRequest` is `{ signal, force, tags? }`, and
it is what a loader hands a client:

```ts
const user = useResource(({ request, tags }) => {
  tags(tag('user', { id: props.id }));
  return api.get<User>(`/users/${props.id}`)(request);
});
```

`signal` ends a request that is no longer wanted. `force` says this run exists
_because_ something was invalidated. They belong together because they answer
the same question — is this request still the one we want, and may its answer
come from memory — and putting them in one object means a client cannot take
one and quietly ignore the other.

`tags` is the third, optional, member: where a client reports what the answer
turned out to be about. A GraphQL document knows its own `@tag` and
`@invalidates` directives, so in a resource that hole is the resource's tags,
and in an action it is the store's invalidation. The call site writes neither.

**One cache, created like everything else.** `createCacheClient({ ttl, max })`
returns a `CacheClient`. `createFetchClient` keeps its answers in one, and an
algorithm of your own uses the same `read`:

```ts
const cache = createCacheClient({ ttl: 30_000 });

const primes = useResource(({ request }) =>
  cache.read(`primes:${limit.value}`, () => sieve(limit.value))(request),
);
```

There is no second implementation hidden inside the fetch client. What it
does, and the whole of it: serve a fresh entry, share what is in flight, drop
an entry on `force`, forget on request, and evict the least recently read when
`max` is reached.

**Deduplication is free of staleness.** Sharing an in-flight run happens at any
`ttl`, including the default 0. Two identical requests overlapping in time is
waste, not staleness, so there is no lifetime to configure for it — which is
how the "ten components, one request" property comes back without anybody
opting into serving old data.

**The shared run outlives one caller.** The producer is given a signal of the
cache's own, aborted only when _every_ waiter has gone. The naive version —
passing the first caller's signal — cancels a request that another component
is still showing a spinner for.

**Every transport is a client.** `createFetchClient`, `createAxiosClient`,
`createUrqlClient`, `createApolloClient`: same shape, same name, configured
once with a base URL, headers and a cache, specialised with `.with(...)`, and
overridden per call. Before this ADR the four were a mix of `json(url)` and
`xLoader(instance)`, which is three shapes for one idea.

**A token may change.** `headers` may be a function; it is called per request
and **untracked**. Per request, so the current token is sent; untracked,
because a resource that depended on the token would re-send every request when
it changes — including on the way out of a sign-out, where they would all go
again without one. That bug was measured once already (0.4.1); the clients now
prevent it rather than documenting it.

**A cache key is an identity and a request.** Added in 0.6.2, after the
question "whose answer is that?" was asked of the design. `GET /api/me` is the
same URL for every account, so a key made of method and URL alone can serve one
account's answer to the next one in the same session — the worst failure a
cache has, because nothing looks wrong. Every client therefore prefixes its
keys with an identity, defaulting to the `authorization` header the request
would carry, and takes a `scope` function for the sessions that are not a
header. Clearing on sign-out remains worth doing and is now about memory rather
than correctness.

The same review found a real collision: the Axios client keyed reads by base
URL and path, and Axios keeps the query string in `params` rather than in the
URL — so two pages of one list were one entry. Keys now include `params`,
through an exported `stableKey` that is order-independent, and a caller writing
their own `cacheKey` is told to use it.

**An action is not cacheable, at all.** Also 0.6.2's review. `force` kept an
action from being _answered_ out of the cache, but nothing kept its answer from
being _written_ there: a `GET` that recalculates something — plenty of real
APIs are shaped that way — left its result under that URL, and the next read
was served it. The request therefore says `mutating`, and every client and the
cache treat that as "run this and remember nothing", whatever the method and
whatever key the call carries. Two identical writes are two writes, so they are
not shared either.

## Non-goals

Interceptors, retries, backoff, token refresh, XSRF, request queues,
persistence of the cache, normalisation, stale-while-revalidate as a policy
flag. The first group belongs to an application's own `fetch` wrapper, which is
one function and visible; the rest belong to a normalising client, and ADR-0022
says which one of you owns the truth.

## Performance

Measured with `npm run build`:

| Package                                  |   0.5.0 |   0.6.0 |
| ---------------------------------------- | ------: | ------: |
| `@firsthandjs/data`                      | 2.81 kB | 3.65 kB |
| `@firsthandjs/data` (`.gql` loader path) | 1.70 kB | 2.56 kB |
| `@firsthandjs/data-axios`                | 0.11 kB | 0.47 kB |
| `@firsthandjs/data-urql`                 | 0.30 kB | 0.53 kB |
| `@firsthandjs/data-apollo`               | 0.37 kB | 0.61 kB |

0.84 kB gzip for the cache and the fetch client together, in a package nothing
downloads unless it imports it. The runtime budget is untouched at 5.89 kB.

What it buys back at runtime is one request where there were several, and the
avoided request is worth more than a kilobyte in every application that has a
network.

## Memory

An entry is a value, an expiry, and a promise while one is in flight. The bound
is `max`, default 100, evicting the least recently read — a cache without a
bound is a leak with a plan. An entry whose run fails is removed rather than
kept as a failure, and with no `ttl` an answered entry is dropped entirely, so
the default configuration holds nothing between requests.

## DX

The thing that goes wrong with caches is that they are invisible until they are
wrong. Three decisions against that:

- **Off by default.** `createFetchClient()` caches nothing; a cache is
  something you asked for, with a lifetime you chose.
- **`ttl: 0` is the default lifetime** when you do ask, which shares requests
  and stores nothing. Staleness is opt-in, separately.
- **`client.cache` is public**, so `api.cache?.forget()` is available at a
  sign-out, and a test can look at what is held.

## Rejected alternatives

- **`force` as a function** (`request.refresh()`) rather than a flag. It reads
  well but says _when_ rather than _whether_: a client that wants to decide
  before sending needs the answer up front, and a function that must be called
  before the request is a flag with extra steps.
- **A cache keyed by the resource's identity.** There is none; that is
  ADR-0022.
- **Caching writes.** A POST is not identified by where it was sent, and a body
  may be a stream nobody can key on. `cacheKey` is how a _reading_ POST says
  otherwise, explicitly.
- **`stale-while-revalidate` built in.** The resource layer already keeps the
  last value on screen while it reloads, which is the same behaviour where a
  person can see it.
- **A persistent cache.** That is `storage` on the store, which is about a
  value surviving a reload, and it has a name for exactly that reason.
