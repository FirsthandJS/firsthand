# @firsthandjs/router

[Reference index](../README.md#reference) · 3.52 kB gzip · depends on
`@firsthandjs/dom`

Nested routes, ranked matching and routes whose code is loaded on demand.
Guide: [Routing](../guide/08-routing.md).

---

## Router

```tsx
const Router: Component<RouterProps>;

interface RouterProps {
  readonly routes: readonly RouteDefinition[];
  /** Defaults to a browser history over the real URL. */
  readonly history?: History;
  /** Sub-path the application is served under; ignored if `history` is given. */
  readonly basename?: string;
  /** Shown while a lazy route is loading. */
  readonly pending?: () => View;
  /** Shown when a lazy route's chunk fails to load. */
  readonly error?: (error: unknown) => View;
}

const Outlet: Component<Record<string, never>>; // renders the matched child route
```

A history the `Router` created is disposed with it; one that was passed in
belongs to the caller.

`basename` is a path segment, not a string prefix: `/app` is the basename for
`/app` and for everything under `/app/`, and has nothing to do with `/apple`.

A lazy route whose chunk fails to load renders `error` — the route's own, then
the router's. With neither, the failure is thrown where the route would have
rendered, so a `catchError` above the router sees it; what must not happen is
the pending view staying on screen with nothing behind it. Either way the
failure is forgotten, so the next navigation to that route asks for the chunk
again: the usual cause is a deploy that replaced the build under an open
document, and by then it is over.

## route()

```ts
const route: RouteBuilder<unknown>;

interface RouteBuilder<Inherited> {
  <const Path extends string>(
    spec: { readonly path: Path } & RouteSpec<ParamsOf<Path>, Inherited>,
  ): RouteDefinition;
  (spec: { readonly index: true } & RouteSpec<unknown, Inherited>): RouteDefinition;
}

type ParamsOf<Path extends string>; // 'users/:id' → { id: string }
```

```tsx
const routes = [
  route({
    path: '/',
    component: Shell,
    children: (child) => [
      child({ index: true, component: Home }),
      // `params.org` and `params.id`, both typed, neither declared twice.
      child({ path: 'users/:id', component: ({ params }) => <User id={params.id} /> }),
    ],
  }),
];
```

`route` returns the object it was given — the types are the whole feature —
with a function-form `children` called once, at definition time. Its spec
accepts everything `RouteDefinition` does; `component`, `lazy` and `children`
are the fields it types.

`ParamsOf` reads a path: `:name` is a `string`, `:name?` is optional, `*` is
captured under `'*'`, and a static segment contributes nothing.

## Routes

```ts
interface RouteDefinition {
  /** Relative to the parent, unless it starts with `/`. */
  readonly path?: string;
  /** Matches when the parent matches and nothing is left over. */
  readonly index?: boolean;
  readonly component?: RouteComponent;
  /** Loaded once, on first entry; the result is cached. */
  readonly lazy?: () => Promise<LazyModule>;
  /** Shown while `lazy` is loading, instead of the router's fallback. */
  readonly pending?: () => View;
  /** Shown when `lazy` fails, instead of the router's failure view. */
  readonly error?: (error: unknown) => View;
  readonly children?: readonly RouteDefinition[];
}

interface RouteProps<P extends Params = Params> {
  /** A live view of the match: every read is a reactive read. */
  readonly params: P;
}

type RouteComponent<P extends Params = Params> = (props: RouteProps<P>) => View;
type LazyModule<P extends Params = Params> =
  RouteComponent<P> | { readonly default: RouteComponent<P> };

interface RouteMatch {
  readonly route: RouteDefinition;
  readonly params: Params;
  /** What this route and its ancestors consumed. */
  readonly pathname: string;
}

function matchRoutes(routes: readonly RouteDefinition[], pathname: string): RouteMatch[] | null;
function routeComponent(route: RouteDefinition): RouteComponent | undefined;
function preloadRoutes(routes: readonly RouteDefinition[], pathname: string): void;
```

Branches are ranked, not tried in order: a static segment beats a parameter,
which beats a splat, however the array is sorted. Flattened branches are cached
per route array, so matching does not re-walk the tree.

## Links

```tsx
const Link: Component<LinkProps>;
const NavLink: Component<NavLinkProps>;

interface LinkProps {
  readonly to: string; // absolute, or relative to the current route
  readonly replace?: boolean;
  readonly state?: unknown;
  /** Starts loading the target route's code on hover and on focus. */
  readonly preload?: boolean;
  readonly onClick?: (event: MouseEvent) => void;
  readonly children?: View;
  /** Anything else is forwarded to the anchor. */
  readonly [attribute: string]: unknown;
}

interface NavLinkProps extends LinkProps {
  /** Active only on an exact match, rather than on a prefix. */
  readonly end?: boolean;
  /** Class added while active. Defaults to `active`. */
  readonly activeClass?: string;
  readonly class?: string;
}
```

Both render a real `<a href>` and intercept only an unmodified left click on a
same-window link. Anything else is the browser's.

```tsx
const Navigate: Component<NavigateProps>;
interface NavigateProps extends NavigateOptions {
  readonly to: string;
}
```

`Navigate` redirects in a microtask rather than during setup, because changing
the location from inside the render producing it would re-enter that render.

## Hooks

All read-only hooks return cells, because a component body runs once.

```ts
function useRouter(): RouterState;
function useLocation(): ReadonlyCell<Location>;
function useRouteParams<P extends Params = Params>(): ReadonlyCell<P>;
function useMatches(): ReadonlyCell<readonly RouteMatch[]>;
function useMatch<P extends Params = Params>(
  pattern: string,
  end?: boolean,
): ReadonlyCell<P | null>;
function useBasePath(): ReadonlyCell<string>;
function useNavigate(): NavigateFunction;
function useSearchParams(): [
  ReadonlyCell<URLSearchParams>,
  (next: URLSearchParams | Record<string, string>, options?: NavigateOptions) => void,
];

type NavigateFunction = (to: string | number, options?: NavigateOptions) => void;

interface RouterState {
  readonly history: History;
  readonly routes: readonly RouteDefinition[];
  /** Outermost matched route to the leaf; empty if none matched. */
  readonly matches: ReadonlyCell<readonly RouteMatch[]>;
  readonly pending: (() => View) | undefined;
  readonly error: ((error: unknown) => View) | undefined;
}

const RouterContext: Context<RouterState>;
```

`navigate(-1)` goes back; a string navigates, relative to the current route
unless it starts with `/`.

## History

```ts
function createBrowserHistory(basename?: string): History;
function createHashHistory(): History;
function createMemoryHistory(initial?: readonly string[]): History;

interface History {
  readonly location: ReadonlyCell<Location>;
  push(to: string, options?: NavigateOptions): void;
  replace(to: string, options?: NavigateOptions): void;
  go(delta: number): void;
  /** Turns a router path into something an `href` can use. */
  href(to: string): string;
  /** Stops listening. Calling it twice is harmless. */
  dispose(): void;
}

interface Location {
  readonly pathname: string;
  readonly search: string; // with the leading `?`, or empty
  readonly hash: string; // with the leading `#`, or empty
  readonly state: unknown;
  /** Changes on every navigation, including to the same URL. */
  readonly key: string;
}

interface NavigateOptions {
  readonly replace?: boolean;
  readonly state?: unknown;
}

function parsePath(to: string): Omit<Location, 'state' | 'key'>;
```

Memory history is synchronous and needs no `window`, which is what makes it the
right one for tests.

Every history reports a navigation once. Hash history writes the fragment and
sets the location itself, and the browser then fires `hashchange` for that
write — an echo, which lands where the location already is and is not reported
again. A `hashchange` the application did not cause is a navigation like any
other.

## Paths

```ts
type Params = Readonly<Record<string, string>>;

function compilePattern(path: string, end: boolean): Pattern;
function matchPattern(
  pattern: Pattern,
  pathname: string,
): { params: Params; consumed: string } | null;
function normalizePath(pathname: string): string;
function sameParams(a: Params, b: Params): boolean;
function segments(path: string): string[];
function resolvePath(to: string, base: string): string;
function isActivePath(current: string, target: string, end: boolean): boolean;
```

These are the matcher the router uses, exported so an application can rank or
resolve a path without rendering one — a breadcrumb, a permission check, a
prefetch decision.
