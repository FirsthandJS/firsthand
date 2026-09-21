# @firsthandjs/data

[Reference index](../README.md#reference) · 2.81 kB gzip (1.70 kB with the
`.gql` loader, which leaves the parser out) · depends on `@firsthandjs/dom`

Resources, actions and invalidation: what is loaded, as reactive state, and
when it has to be loaded again. Not a cache
([ADR-0022](../adr/0022-resources-not-a-cache.md)). Guide:
[Data](../guide/09-data.md).

---

## The store

```ts
function createData(options?: DataOptions): DataStore;

interface DataOptions {
  /** Where named resources are kept between visits. */
  readonly storage?: Storage;
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

There is no `staleTime` and no `cacheTime`, because there is no cache. A
request cache belongs to the transport, where it can be the only one.

## useResource

```ts
function useResource<T>(
  load: (context: LoadContext) => Promise<T>,
  options?: ResourceOptions,
): Resource<T>;

interface LoadContext {
  /** Aborted when this run is superseded, or the resource goes away. */
  readonly signal: AbortSignal;
  /** Declares what this resource is about. **Replaces**; the last call wins. */
  readonly tags: (...tags: Tag[]) => void;
  /** True when this run was caused by an invalidation or by `reload()`. */
  readonly force: boolean;
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

`force` is the one place the layers touch: pass it on as `cache: 'reload'`,
`fetchPolicy: 'network-only'` or `requestPolicy: 'network-only'`, or an
invalidation will be answered out of a transport cache.

An invalidation that arrives while a run is in flight is remembered and matched
again when the run declares its tags, so tags that only the server knows still
supersede the run that was overtaken.

## useAction

```ts
function useAction<I, R>(run: (input: I, context: ActionContext) => Promise<R>): Action<I, R>;

interface ActionContext {
  readonly signal: AbortSignal;
  /** Declares what this changed. Replaces; may be called after the answer. */
  readonly invalidates: (...tags: Tag[]) => void;
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
reads on the way is nobody's dependency. A second `run()` aborts the first.

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

## fetch

```ts
function json<T>(
  input: string,
  init?: JsonRequest,
): (context: { signal: AbortSignal }) => Promise<T>;

interface JsonRequest extends Omit<RequestInit, 'body'> {
  readonly body?: BodyInit | null;
  /** Sent as JSON, with the content type the platform will not set for you. */
  readonly json?: unknown;
}

class FirsthandHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: unknown; // the parsed body, if there was one
}
```

`json()` wires the abort signal through, throws `FirsthandHttpError` on a
non-2xx status, and parses the body — an empty one, such as a 204, is
`undefined` rather than a parse error.

`json:` is set apart from `body:` for one measured reason: `FormData`,
`URLSearchParams` and `Blob` are labelled by the platform itself, while a
stringified object is labelled `text/plain`. A `content-type` the caller sets
is left alone. `fetch` **forbids a body on GET** and throws a `TypeError`.

This is the platform, not a client: no base URL, no instance, no interceptor,
no retry. Those belong to a client — and a loader takes any client, because it
takes any function.

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

## Helper packages

```ts
function axiosLoader(instance: AxiosLike): <T>(config: AxiosRequest) => Loader<T>;
function urqlLoader(
  client: UrqlLike,
): <T>(document: GraphQLDocument<T>, variables?: Variables) => Loader<T>;
function apolloLoader(
  client: ApolloLike,
  parse: Parse,
): <T>(document: GraphQLDocument<T>, variables?: Variables) => Loader<T>;
function apolloObservable(
  client: WatchLike,
  parse: Parse,
): <T>(
  document: GraphQLDocument<T>,
  variables?: Variables,
) => readonly [ObservableLike<T>, BridgeOptions];
```

| Package                    | gzip    | Binds                                   |
| -------------------------- | ------- | --------------------------------------- |
| `@firsthandjs/data-axios`  | 0.11 kB | One method, with the abort signal wired |
| `@firsthandjs/data-urql`   | 0.30 kB | `query` / `mutation`, `force` → policy  |
| `@firsthandjs/data-apollo` | 0.37 kB | `query` / `mutate` / `watchQuery`       |

Each takes a client **you** built and declares the methods it uses
structurally: no dependency, no peer dependency, no version to follow. Both
GraphQL helpers are generic in the document's variables, so an operation with
required variables cannot be called without them and what is passed is checked
against the schema it was generated from. A query
declares its `@tag` directives; a mutation declares its `@invalidates`, so
`{ tags: invalidates }` inside an action wires the document straight to the
store.

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
