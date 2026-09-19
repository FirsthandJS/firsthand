# API conventions

Every public name in this project follows these rules. They exist so that you
can guess an API correctly before reading its documentation, and so that a new
package cannot drift.

Where a rule was broken, it was changed — the renames are in the changelog.

## Naming

| Shape             | Means                                                    | Examples                                                                                        |
| ----------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `createX(...)`    | Builds a new stateful thing you own, and usually dispose | `createRoot`, `createContext`, `createQueryClient`, `createBrowserHistory`                      |
| `x(...)` (a noun) | A primitive: builds a value, not a subsystem             | `signal`, `computed`, `effect`, `component`, `portal`, `list`, `tag`, `json`                    |
| `useX()`          | Reads what the tree above provides. Setup only           | `useContext`, `useQueryClient`, `useRouter`, `useRouteParams`, `useQuery`                       |
| `setX(value)`     | Writes one global or element-level setting               | `setElementPrefix`, `setAttribute`, `setProperty`                                               |
| `isX(...)`        | Returns a boolean and nothing else                       | `isActivePath`, `isComponent`                                                                   |
| `XOptions`        | An options bag, every field optional                     | `ComponentOptions`, `QueryClientOptions`, `NavigateOptions`, `LoadOptions`                      |
| `XProps`          | The props of a component                                 | `RouterProps`, `LinkProps`, `NavigateProps`                                                     |
| `XResult`         | What a hook hands back                                   | `QueryResult`, `MutationResult`                                                                 |
| `XDefinition`     | A description of something, as data                      | `RouteDefinition`, `QueryDefinition`                                                            |
| `FirsthandXError` | Every error this project throws                          | `FirsthandCycleError`, `FirsthandHttpError`, `FirsthandGraphQLError`, `FirsthandDirectiveError` |

Identifiers use the spelling the web platform uses — `normalizePath`,
`serialize` — even though the prose around them is written in British English.
One `s`/`z` convention for names, another for sentences, is less confusing than
two conventions for names.

### Why `effect` is not `useEffect`

The `use` prefix is not decoration and it is not React's rule about call order.
It marks exactly one thing: **the function reads something the tree above it
provided**, so it can only be called while there is a tree — during a
component's setup.

- `useContext`, `useTheme`, `useRouter`, `useRouteParams`, `useQueryClient`,
  `useQuery` all go up: they find a provider, a router, a client. Called from a
  timer or an event handler, there is nothing above them, and they say so.
- `signal`, `computed`, `effect`, `component`, `portal`, `tag`, `json` create a
  thing and hand it back. They read nothing from above. `effect` and `portal`
  do _attach_ to the current owner, which is why they are disposed with it, but
  they never ask what it contains — and they work in a `createRoot` with no
  component anywhere, which is what makes the core usable outside the DOM.

React names `useEffect` a hook because React needs the call-order slot. Firsthand
does not: an effect is a value that exists, not a slot in a render.

Errors are all prefixed `Firsthand` so that `instanceof` is never ambiguous:
`HttpError` and `GraphQLError` are names other libraries use too, and
`graphql-js` exports the second one.

## Reactivity

**Anything that changes is a cell.** A hook that returns reactive data returns a
`ReadonlyCell<T>`, read with `.value`:

```ts
const params = useRouteParams(); // ReadonlyCell<Params>
const user = useQuery(...); // { data, error, status, fetching } — all cells
```

A hook that returns something which does _not_ change returns it directly:
`useQueryClient()`, `useRouter()`, `useNavigate()`.

**Anything reactive you pass in is a thunk**, because a component body runs
once and a plain value would be frozen at setup:

```ts
useQuery(() => ({ tags: [tag('user', { id: props.id })], fetch: … }));
useGraphQL(UserQuery, () => ({ id: props.id }));
```

## Disposal

Anything that can be released either returns a `Dispose` function or has a
`dispose()` method — never `destroy()`, `stop()`, `close()` or `cancel()`.

```ts
const stop = render(() => <App />); // returns Dispose
const stop = effect(() => …); // returns Dispose
const release = client.subscribe(entry); // returns Dispose
history.dispose(); // a thing you were given: a method
view.unmount(); // the testing helper's word for the same thing
```

Calling a disposer twice is always safe and always a no-op.

## Failure

**Synchronous programmer errors throw.** A malformed `@tag` directive, a
context read with no provider, a cycle in the graph: these are mistakes in the
code, and they throw where they happen — under the `.graphql` loader that means
a build failure.

**Asynchronous failures land in state.** Nothing in the cache rejects:
`load`, `refetch` and `mutate` resolve with `undefined` and report the failure
through `error` and `status`. An `onClick` that forgets to `await` therefore
cannot produce an unhandled rejection, and a component reads failure the same
way it reads data.

## Defaults

An options object that says nothing must behave exactly like no options object
at all. `refetch()` and `refetch({})` both go to the network; `refetch({ force:
false })` is how you ask for the cache. This was a real wart — `refetch({})`
used to mean something different from `refetch()` — and it is the kind of thing
these rules exist to catch.

Defaults are stated in the type (`= document.body`, `= () => ({})`) or in one
sentence of the doc comment, never both and never neither.

## Identity

Anything cached is keyed by everything it depends on:

- a query's identity is its **tags plus its variables**, so changing a variable
  moves it to another entry and fetches;
- a component's identity is its stable build id, not `Function.name`;
- a keyed list row's identity is its `key`.

If a value can change what a request returns, it belongs in the identity. The
cache cannot see inside a closure, so a fetcher that reads a page number which
is in neither a tag nor `variables` would be answered for ever out of the first
result.

## What is not public

`@firsthandjs/dom/internal` is the compiler/runtime protocol. It is importable and
documented, but it is versioned by `PROTOCOL_VERSION` rather than by semver,
and it may change whenever the compiler does.

`@firsthandjs/core` exports a small internal surface for `@firsthandjs/dom` — `Cell`,
`createOwner`, `bind`, `createEffect` and the rest — under a comment saying so.
Those names are not part of the public contract.
