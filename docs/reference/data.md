# @firsthandjs/data

[Reference index](../README.md#reference) · 5.00 kB gzip (2.61 kB with the
`.gql` loader, which leaves the parser out) · depends on `@firsthandjs/dom`

Two layers: **resources and actions**, which are reactive state and
invalidation, and a **transport client** with the one cache
([ADR-0022](../adr/0022-resources-not-a-cache.md),
[ADR-0023](../adr/0023-one-cache-at-the-transport-edge.md)). Guide:
[Data](../guide/09-data.md).

---

## The store

```ts
function createData(options?: DataOptions): DataStore;

interface DataOptions {
  /** Where named resources are kept between visits. */
  readonly storage?: Storage;
  /** Caches to empty when something is invalidated. Anything with `forgetTagged`. */
  readonly caches?: readonly Forgetful[];
  /**
   * How long an invalidation is remembered for resources that did not exist
   * when it happened, in ms. Default 60 000; `0` switches it off.
   */
  readonly remember?: number;
}

interface DataStore {
  /** Everything carrying a matching tag runs again, with `force`. */
  invalidate(...patterns: Tag[]): Promise<void>;
  /** Forgets every resource and empties the storage. */
  clear(): void;
  /** How many resources are alive. For tests and devtools. */
  readonly size: number;
}

interface Storage {
  /** May return a promise; a value arriving after the loader is dropped. */
  read?(name: string): unknown;
  write?(name: string, data: unknown): void;
  clear?(): void;
}

const DataContext: Context<DataStore>;
function useData(): DataStore;
function useInvalidate(): (...patterns: Tag[]) => Promise<void>;
```

`invalidate` resolves once the runs it triggered have settled. A storage that
throws is a storage that has nothing: it can never break a resource.

Hand the store your cache and an invalidation empties it: entries whose
requests said they were about those tags are dropped where they stand, as
metadata rather than as keys
([ADR-0025](../adr/0025-tags-as-cache-metadata.md)). A cache you do not hand
over is untouched — a transport's own cache is its own, and `force` is the only
contact with it.

An invalidation reaches every resource that is **alive** — and is remembered
for `remember` milliseconds for the ones that are not. A list two pages away
is nobody's subscriber; walking back to it creates a resource rather than
reloading one, and that resource would otherwise be handed a cached answer
from before the change. Its first run is forced instead, once: the memory is
dropped as soon as a run carrying those tags succeeds
([ADR-0024](../adr/0024-an-invalidation-outlives-its-reader.md)).

There is no `staleTime` and no `cacheTime`, because there is no cache. A
request cache belongs to the transport, where it can be the only one.

## The request

```ts
interface DataRequest {
  /** Aborted when this run is superseded, or the resource goes away. */
  readonly signal: AbortSignal;
  /**
   * True when this run was caused by an invalidation or by `reload()` — or by
   * one the resource never saw, which declaring its tags can reveal. A getter
   * for that reason: read it when you need it rather than copying it early.
   */
  readonly force: boolean;
  /**
   * True when this request is part of an action. Nothing it sends is answered
   * from a cache (`force` says that) or kept in one (this does).
   */
  readonly mutating?: boolean;
  /** Where a client reports what the answer turned out to be about. */
  readonly tags?: (...tags: Tag[]) => void;
}

type Loader<T> = (request: DataRequest) => Promise<T>;
```

What a loader hands a transport, and the whole of the contract between the two
layers. `signal` ends a request nobody wants; `force` says a client may not
answer from what it remembers; `tags` is the hole a GraphQL client reports its
document's directives into — the resource's tags in a resource, the store's
invalidation in an action.

Every client in this project returns `Loader<T>` values, which is why a call
site reads `api.get<User>('/users/7')(request)`.

## useResource

```ts
function useResource<T>(
  load: (context: LoadContext) => Promise<T>,
  options?: ResourceOptions,
): Resource<T>;

interface LoadContext extends DataRequest {
  /** Declares what this resource is about. **Replaces**; the last call wins. */
  readonly tags: (...tags: Tag[]) => void;
  /** `signal` and `force` as one object, to hand to a client. */
  readonly request: DataRequest;
}

interface ResourceOptions {
  /** A name to keep the last value under, between visits. Opt-in. */
  readonly persist?: string;
}

interface Resource<T> {
  readonly data: ReadonlyCell<T | undefined>;
  readonly error: ReadonlyCell<unknown>;
  readonly status: ReadonlyCell<Status>; // 'idle' | 'loading' | 'success' | 'error'
  /** True while a run is in flight, including one behind a visible value. */
  readonly loading: ReadonlyCell<boolean>;
  reload(): Promise<T | undefined>; // never rejects
  dispose(): void;
}
```

The loader runs inside an `effect`, so **everything it reads before its first
`await` is a dependency**. Changing one runs it again and aborts what was in
flight. `peek()` reads without subscribing — which is what a token used to
build a header wants.

Identity is the **call site**. Two call sites are two resources whatever their
tags say; there is no key, no name and no variables object.

`force` is the one place the layers touch, and handing `request` to a client is
how it gets there: every client here drops what it has cached when it sees it.
A loader written by hand translates it itself — `cache: 'reload'`,
`fetchPolicy: 'network-only'`, `requestPolicy: 'network-only'` — or an
invalidation will be answered out of a transport cache.

An invalidation that arrives while a run is in flight is remembered and matched
again when the run declares its tags, so tags that only the server knows still
supersede the run that was overtaken.

**Declare tags before handing `request` to a client** where you can. That is
what lets an invalidation nobody was alive to receive turn into a `force` the
cache lookup can still see:

```ts
useResource(({ request, tags }) => {
  tags(tag('board', { id: id() })); // known before the call
  return api.get<Board>(`/boards/${id()}`)(request);
});
```

Declaring afterwards is supported and costs a request: the answer may have come
from a cache that was written before the tags existed, so the run is discarded
and repeated with `force` rather than trusted.

## useAction

```ts
function useAction<I, R>(
  run: (input: I, context: ActionContext) => Promise<R>,
  options?: ActionOptions,
): Action<I, R>;

type ActionConcurrency = 'queue' | 'switch' | 'drop' | 'all';

interface ActionOptions {
  /** What a second `run()` does while the first is out. Default `queue`. */
  readonly concurrency?: ActionConcurrency;
}

interface ActionContext {
  readonly signal: AbortSignal;
  /** Declares what this changed. Replaces; may be called after the answer. */
  readonly invalidates: (...tags: Tag[]) => void;
  /**
   * The request to hand a client: `force` is always true, and its `tags` is
   * `invalidates` — so a mutation document's `@invalidates` reaches the store
   * with nothing to wire.
   */
  readonly request: DataRequest;
}

interface Action<I, R> {
  readonly data: ReadonlyCell<R | undefined>;
  readonly error: ReadonlyCell<unknown>;
  readonly status: ReadonlyCell<Status>;
  readonly running: ReadonlyCell<boolean>;
  run(input: I): Promise<R | undefined>; // never rejects
}
```

The body is **untracked**: an action runs from an event handler, and what it
reads on the way is nobody's dependency.

A second `run()` while the first is out **queues** by default. Aborting a
request does not undo what the server already did with it, so the policy that
can lose a write is the one you have to ask for
([ADR-0029](../adr/0029-a-mutation-is-not-a-read.md)):

| `concurrency` | what a second `run()` does                                    |
| ------------- | ------------------------------------------------------------- |
| `queue`       | waits for the first, then runs. Order preserved. **Default.** |
| `switch`      | aborts the one in flight and starts the new one.              |
| `drop`        | ignores the call and returns the promise already running.     |
| `all`         | runs them concurrently; each settles on its own.              |

`running` reports whether _any_ run is out, so it stays true under `all` until
the last one lands. A queued run checks whether the scope is still alive when it
starts, not when it was asked for, so one waiting behind another never begins if
the component went away.

Its request carries `force: true` **and** `mutating: true`, so nothing it sends
is answered out of a cache or written into one.

## Bridges

```ts
function fromObservable<T>(source: ObservableLike<T>, options?: BridgeOptions): Resource<T>;
function fromPromise<T>(factory: () => Promise<T>): Resource<T>;

interface ObservableLike<T> {
  subscribe(observer: {
    next?: (value: T) => void;
    error?: (error: unknown) => void;
  }): { unsubscribe: () => void } | (() => void);
}

interface BridgeOptions {
  readonly reload?: () => Promise<unknown>;
}
```

For the case a per-call-site resource is the wrong shape: the same entity in
twenty places, kept consistent by a normalising client. Apollo, urql, RxJS and
TanStack's `QueryObserver` all satisfy the contract.

## Tags

```ts
interface Tag {
  readonly name: string;
  readonly vars: TagVars;
}
type TagVars = Readonly<Record<string, string | number | boolean | null>>;
type Variables = Readonly<Record<string, unknown>>;

function tag(name: string, vars?: TagVars): Tag;
function tagMatches(pattern: Tag, candidate: Tag): boolean;
function anyTagMatches(patterns: readonly Tag[], tags: readonly Tag[]): boolean;
```

A pattern matches a candidate when the names are equal and every variable the
pattern names is equal in the candidate. **Fewer variables match more**:
`tag('note')` matches every note.

Tags are for invalidation only. They may be coarse, they may overlap, and two
unrelated resources may share one — none of which is dangerous, because nothing
is looked up by them.

## The cache

```ts
function createCacheClient(options?: CacheOptions): CacheClient;

interface CacheOptions {
  /** How long an answer is served again without asking, in ms. Default 0. */
  readonly ttl?: number;
  /** How many entries to keep; least recently read goes first. Default 100. */
  readonly max?: number;
  /** For tests: what `Date.now()` should be. */
  readonly now?: () => number;
}

/** A key for a value, stable however the value was written. */
function stableKey(value: unknown): string;

interface CacheClient {
  /** Wraps a producer so its answer is kept under `key`. */
  read<T>(key: string, produce: Loader<T>): Loader<T>;
  /** Puts a value in by hand; with no `ttl` it stays until forgotten. */
  write(key: string, value: unknown): void;
  /** What is there, without running anything. `undefined` if stale. */
  peek(key: string): unknown;
  /** Forgets one key, or everything. */
  forget(key?: string): void;
  /** Forgets every entry whose request said it was about one of these. */
  forgetTagged(patterns: readonly Tag[]): void;
  readonly size: number;
}
```

One cache, at the transport edge, for two jobs: what a client fetched, and what
an algorithm of yours computed. `createFetchClient` keeps its answers in one of
these, and there is no second implementation hidden inside it.

- **In flight is shared at any `ttl`**, including the default 0: two identical
  requests overlapping in time is waste rather than staleness, so it needs no
  configuration. Serving an _older_ answer is the separate decision, and that
  is what `ttl` buys.
- **`force` drops the entry**, which is how an invalidation reaches through.
- **A `mutating` request is run and nothing else**: not served from here, not
  shared with anybody, and not kept. That is every action, whatever its method
  or key.
- **The producer gets a signal of the cache's own**, aborted only when every
  waiter has gone — so one component leaving does not cancel a request another
  is still waiting for.
- **A failure is not kept**: the next caller asks again.

Keys are the caller's, and every client here builds one from an **identity**
and a **request** so that two accounts in one session cannot read each other's
answers. `stableKey` is exported because a key you write yourself needs the
same property: it must carry everything that varies, in an order-independent
form.

## fetch

```ts
function createFetchClient(options?: FetchClientOptions): FetchClient;

interface FetchClientOptions {
  /** Prefixed to every relative path; an absolute URL is left alone. */
  readonly baseUrl?: string;
  /** A function is called per request and **untracked**, so a token may change. */
  readonly headers?: HeadersInit | (() => HeadersInit);
  /** `false` (default), options for a cache of its own, or a shared one. */
  readonly cache?: false | CacheOptions | CacheClient;
  /**
   * Who the cached answers belong to. Default: the `authorization` header this
   * request would carry. Read per request, untracked.
   */
  readonly scope?: () => string;
  /** Applied to every request: `credentials`, `mode`, `referrerPolicy`, … */
  readonly init?: RequestInit;
  /** The seam: wrap `fetch` to log, to retry, or to end a session on a 401. */
  readonly fetch?: typeof globalThis.fetch;
}

interface FetchClient {
  request<T>(url: string, init?: JsonRequest): Loader<T>;
  get<T>(url: string, init?: JsonRequest): Loader<T>;
  post<T>(url: string, init?: JsonRequest): Loader<T>;
  put<T>(url: string, init?: JsonRequest): Loader<T>;
  patch<T>(url: string, init?: JsonRequest): Loader<T>;
  /** `delete` is a keyword in enough places to be worth avoiding. */
  remove<T>(url: string, init?: JsonRequest): Loader<T>;
  /** A copy with some options replaced; the cache is shared unless replaced. */
  with(options: FetchClientOptions): FetchClient;
  readonly cache: CacheClient | undefined;
}

interface JsonRequest extends Omit<RequestInit, 'body'> {
  readonly body?: BodyInit | null;
  /** Sent as JSON, with the content type the platform will not set for you. */
  readonly json?: unknown;
  /**
   * This call's cache key, or `false` for nowhere. It must carry everything
   * that varies — the body included — and the identity is added for you.
   */
  readonly cacheKey?: string | false;
}

class FirsthandHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown; // the parsed body, if there was one
}
```

A small REST client on the browser's own `fetch`: a base URL, headers read per
request, a failed status thrown, the abort signal wired through, and the shared
cache. An empty body, such as a 204, is `undefined` rather than a parse error.

Only `GET` and `HEAD` are cached, keyed by identity, method and URL — a write
is not identified by where it was sent. `cacheKey` says otherwise for a POST that
reads, and `cacheKey: false` keeps one read out of the cache entirely. The
platform's own `cache` option is untouched and still passed to `fetch`: that
one is the HTTP cache, a different thing.

`json:` is set apart from `body:` for one measured reason: `FormData`,
`URLSearchParams` and `Blob` are labelled by the platform itself, while a
stringified object is labelled `text/plain`. A `content-type` the caller sets
is left alone. `fetch` **forbids a body on GET** and throws a `TypeError`.

No interceptors, no retries, no token refresh: `fetch` is the seam, and it is
one function you can see.

## Documents

```ts
interface GraphQLDocument<TData = unknown, TVariables extends Variables = Variables> {
  readonly source: string; // directives already stripped
  readonly operation: string;
  readonly kind: 'query' | 'mutation' | 'subscription';
  readonly tags: readonly TagTemplate[];
  readonly invalidates: readonly TagTemplate[];
  // Phantom, for inference only; never present at runtime:
  readonly data?: TData;
  readonly variables?: TVariables;
}

interface TagTemplate {
  readonly name: string;
  readonly vars: Readonly<Record<string, TagValue>>;
}
type TagValue = { readonly variable: string } | { readonly literal: TagVars[string] };

function parseGraphQL<TData = unknown, TVariables extends Variables = Record<string, never>>(
  source: string,
): GraphQLDocument<TData, TVariables>;

function resolveTags(templates: readonly TagTemplate[], variables: Variables): Tag[];

/** Required when the operation has variables, omitted when it has none. */
type DocumentArguments<TVariables extends Variables> =
  Record<string, never> extends TVariables ? [variables?: TVariables] : [variables: TVariables];

class FirsthandDirectiveError extends Error {} // a malformed @tag / @invalidates
```

A `$variable` the call leaves out is **dropped** from the resolved tag, which
widens it, rather than producing `note(id: undefined)`.

Parsing GraphQL is transport work, so nothing here sends a document: the helper
packages below do, or four lines of your own.

## The other clients

Same shape, one per transport, each in its own package and each binding a
client **you** built:

```ts
function createAxiosClient(instance: AxiosLike, options?: AxiosClientOptions): AxiosClient;
function createUrqlClient(client: UrqlLike, options?: UrqlClientOptions): UrqlClient;
function createApolloClient(
  client: ApolloLike & WatchLike,
  parse: Parse,
  options?: ApolloClientOptions,
): ApolloClient;
```

| Package                                                            |    gzip | Has                                            |
| ------------------------------------------------------------------ | ------: | ---------------------------------------------- |
| [`@firsthandjs/data-axios`](../../packages/data-axios/README.md)   | 0.58 kB | `request`, `get`/`post`/`put`/`patch`/`remove` |
| [`@firsthandjs/data-urql`](../../packages/data-urql/README.md)     | 0.58 kB | `query`, `mutate`                              |
| [`@firsthandjs/data-apollo`](../../packages/data-apollo/README.md) | 0.65 kB | `query`, `mutate`, `watch`                     |

Each takes `headers` (a function is read per request and untracked), `cache`
(`false`, options, or a shared `CacheClient`), `scope` (who the cached answers
belong to; the `authorization` header by default), a per-transport options bag,
and has `.with(...)` and `.cache` like the fetch client. Axios reads are keyed
by their `params` as well as their URL, because that is where Axios keeps the
query string; the GraphQL clients are keyed by operation and variables. None depends on the client
it binds, not even as a peer: the two or three methods each uses are declared
structurally, so there is no version to follow.

The GraphQL clients are generic in the document's variables, so an operation
with required variables cannot be called without them. `query` declares the
document's `@tag` directives into the request and `mutate` declares its
`@invalidates` — which inside an action is the store's invalidation, so a
mutation wires itself.

`watch` returns what `fromObservable` takes, for the case where Apollo's
normalising cache should be the source of truth:

```ts
const user = fromObservable(...billing.watch(UserDocument, { id }));
```

## @firsthandjs/data/vite

```ts
function graphql(): GraphQLPlugin; // a Vite/Rollup plugin
function inlineImports(
  source: string,
  file: string,
  seen: Set<string>,
  read: (file: string) => string,
): string;
```

An import of a `.gql` / `.graphql` file becomes a parsed document at build
time, so the parser never ships. `#import "./fragments.gql"` inlines a file
once however often it is imported; `inlineImports` is exported so another
bundler's plugin can reuse it.

## @firsthandjs/data/codegen

A `graphql-codegen` plugin. It emits one `declare module '*/<file>.gql'` per
operation, typed against a `typescript-operations` output, so that no call site
carries a type argument:

```ts
{
  'src/graphql-modules.d.ts': {
    plugins: ['@firsthandjs/data/codegen'],
    config: { typesPath: './graphql-types' },
  }
}
```

| Option      | Meaning                                                   |
| ----------- | --------------------------------------------------------- |
| `typesPath` | Module the generated operation types come from (required) |

Do not add the `typescript` plugin to the same output file as
`typescript-operations`: both declare every input object, and TypeScript then
reports a duplicate identifier.
