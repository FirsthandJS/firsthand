# @firsthandjs/query

[Reference index](../README.md#reference) · 3.23 kB gzip (2.14 kB with the
`.gql` loader, which leaves the parser out) · depends on `@firsthandjs/dom`

A cache in front of the network, invalidated by tags. Guide:
[Data](../guide/09-data.md).

---

## The client

```ts
function createQueryClient(options?: QueryClientOptions): QueryClient;

interface QueryClientOptions {
  readonly staleTime?: number; // ms a result stays fresh. Default 0
  readonly cacheTime?: number; // ms an unwatched entry is kept. Default 300_000
}

interface QueryClient {
  entry<T, V extends Variables>(definition: QueryDefinition<T, V>): QueryEntry<T>;
  load<T, V extends Variables>(
    definition: QueryDefinition<T, V>,
    options?: LoadOptions,
  ): Promise<T | undefined>;
  invalidate(...patterns: Tag[]): Promise<void>;
  subscribe(entry: QueryEntry): Dispose;
  clear(): void;
  readonly size: number;
}

const QueryClientContext: Context<QueryClient>;
function useQueryClient(): QueryClient;
```

`invalidate` resolves once the re-fetches it triggered for watched entries have
settled; unwatched entries are marked and re-fetch on next use.

## Definitions

```ts
interface QueryDefinition<T, V extends Variables = Variables> {
  readonly tags: readonly Tag[];
  readonly variables?: V;
  readonly fetch: (context: FetchContext<V>) => Promise<T>;
  /** Only when two queries share tags *and* variables — a list and its count. */
  readonly key?: string;
  readonly staleTime?: number;
}

interface RequestContext {
  readonly signal: AbortSignal;
}
interface FetchContext<V> extends RequestContext {
  readonly variables: V;
}
interface LoadOptions {
  readonly force?: boolean;
}
type Variables = Readonly<Record<string, unknown>>;
```

An entry's identity is `tags + variables`, or `key` when one is given. Anything
the fetcher reads that can change belongs in a tag or in `variables`.

## useQuery

```ts
function useQuery<T, V extends Variables = Variables>(
  define: () => QueryDefinition<T, V>,
  options?: () => UseQueryOptions,
): QueryResult<T>;

interface UseQueryOptions {
  /** `false` keeps the entry `idle` and fetches nothing until it turns true. */
  readonly enabled?: boolean;
}

interface QueryResult<T> {
  readonly data: ReadonlyCell<T | undefined>;
  readonly error: ReadonlyCell<unknown>;
  readonly status: ReadonlyCell<QueryStatus>; // 'idle' | 'pending' | 'success' | 'error'
  readonly fetching: ReadonlyCell<boolean>;
  refetch(options?: LoadOptions): Promise<T | undefined>;
}
```

Both arguments are thunks, because a component body runs once: re-evaluating
them is what moves the subscription to another entry.

`refetch()` defaults to `force: true` — asking for a refetch means the network.
`client.load()` defaults to `force: false`.

The cells belong to the **entry**, not to the component, so two components
asking for the same thing read the same cells.

## useMutation

```ts
function useMutation<I, R>(options: MutationOptions<I, R>): MutationResult<I, R>;

interface MutationOptions<I, R> {
  readonly mutate: (input: I, context: RequestContext) => Promise<R>;
  readonly invalidates?: readonly Tag[] | ((result: R, input: I) => readonly Tag[]);
  readonly onSuccess?: (result: R, input: I) => void;
  readonly onError?: (error: unknown, input: I) => void;
}

interface MutationResult<I, R> {
  readonly data: ReadonlyCell<R | undefined>;
  readonly error: ReadonlyCell<unknown>;
  readonly status: ReadonlyCell<QueryStatus>;
  readonly fetching: ReadonlyCell<boolean>;
  mutate(input: I): Promise<R | undefined>; // never rejects
  reset(): void;
}
```

## Tags

```ts
interface Tag {
  readonly name: string;
  readonly vars: TagVars;
}
type TagVars = Readonly<Record<string, string | number | boolean | null>>;

function tag(name: string, vars?: TagVars): Tag;
function tagMatches(pattern: Tag, candidate: Tag): boolean;
function anyTagMatches(patterns: readonly Tag[], tags: readonly Tag[]): boolean;
function tagKey(value: Tag): string;
function tagsKey(tags: readonly Tag[]): string;
function variablesKey(variables: Variables): string;
```

A pattern matches a candidate when the names are equal and every variable the
pattern names is equal in the candidate. **Fewer variables match more**:
`tag('note')` matches every note.

`tagKey`, `tagsKey` and `variablesKey` are stable whatever order the keys were
written in, and are the functions the cache itself uses; they are exported so
tests and devtools can compute an entry's identity.

## REST

```ts
function json<T>(input: RequestInfo, init?: RequestInit): (context: RequestContext) => Promise<T>;

class FirsthandHttpError extends Error {
  readonly status: number;
  readonly response: Response;
}
```

`json()` wires the abort signal through and throws `FirsthandHttpError` on a
non-2xx status, so no fetcher has to check `response.ok`.

## GraphQL

```ts
const GraphQLContext: Context<GraphQLTransport>;

function createGraphQLTransport(options: TransportOptions): GraphQLTransport;

interface TransportOptions {
  readonly url: string;
  /** Static, or read per request — which is where an auth token belongs. */
  readonly headers?: Record<string, string> | (() => Record<string, string>);
  readonly fetch?: typeof fetch;
}

type GraphQLTransport = (
  document: GraphQLDocument<unknown, Variables>,
  variables: Variables,
  context: RequestContext,
) => Promise<unknown>;

class FirsthandGraphQLError extends Error {
  readonly errors: readonly { readonly message: string }[];
}
```

Named `FirsthandGraphQLError` because `graphql-js` already exports `GraphQLError`,
and an application using both has to be able to tell them apart.

```ts
function useGraphQL<TData, TVariables extends Variables>(
  document: GraphQLDocument<TData, TVariables>,
  ...rest: QueryArguments<TVariables>
): QueryResult<TData>;

function useGraphQLMutation<TData, TVariables extends Variables>(
  document: GraphQLDocument<TData, TVariables>,
  options?: Omit<MutationOptions<TVariables, TData>, 'mutate' | 'invalidates'> & {
    readonly invalidates?: MutationOptions<TVariables, TData>['invalidates'];
  },
): MutationResult<TVariables, TData>;
```

`QueryArguments<TVariables>` is a tuple rather than `variables?:`: an operation
**with** required variables cannot be called without them, and one without may
be called with the document alone.

Tags come from the document's `@tag` directives bound against the variables of
the call; `useGraphQLMutation` invalidates its `@invalidates` directives unless
`invalidates` is given.

## Documents

```ts
interface GraphQLDocument<TData = unknown, TVariables extends Variables = Variables> {
  readonly source: string; // directives already stripped
  readonly operation: string;
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

class FirsthandDirectiveError extends Error {} // a malformed @tag / @invalidates
```

A `$variable` the call leaves out is **dropped** from the resolved tag, which
widens it, rather than producing `note(id: undefined)`.

## @firsthandjs/query/vite

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

## @firsthandjs/query/codegen

A `graphql-codegen` plugin. It emits one `declare module '*/<file>.gql'` per
operation, typed against a `typescript-operations` output, so that no call site
carries a type argument:

```ts
{
  'src/graphql-modules.d.ts': {
    plugins: ['@firsthandjs/query/codegen'],
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
