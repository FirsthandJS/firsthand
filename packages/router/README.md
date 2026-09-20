# @firsthandjs/router

Nested routes, real links, and route code that arrives when the route does.

**Documentation:** [guide](https://github.com/firsthandjs/firsthand/blob/main/docs/guide/08-routing.md) · [API reference](https://github.com/firsthandjs/firsthand/blob/main/docs/reference/router.md) · [all docs](https://github.com/firsthandjs/firsthand/blob/main/docs/README.md)

```
npm install @firsthandjs/router
```

3.44 kB gzip. No dependencies other than `@firsthandjs/core` and `@firsthandjs/dom`.

## The shape of it

```tsx
import { render, component } from '@firsthandjs/dom';
import { Router, Outlet, NavLink, route, type RouteProps } from '@firsthandjs/router';

const Shell = component(() => (
  <main>
    <nav>
      <NavLink to="/" end>
        Home
      </NavLink>
      <NavLink to="/users">Users</NavLink>
      <NavLink to="/reports" preload>
        Reports
      </NavLink>
    </nav>
    <Outlet />
  </main>
));

// `props.params` is typed by the route's path, below. Nothing says `id` twice.
const User = component<RouteProps<{ id: string }>>((props) => <h2>User {props.params.id}</h2>);

const routes = [
  route({
    path: '/',
    component: Shell,
    children: (child) => [
      child({ index: true, component: Home }),
      child({ path: 'users/:id', component: User }),
      // Not in the initial bundle. Fetched when the route is entered — or on
      // hover, because the link above asks for it.
      child({ path: 'reports', lazy: () => import('./reports.js') }),
      child({ path: '*', component: NotFound }),
    ],
  }),
];

render(() => <Router routes={routes} />);
```

## How it differs from react-router

The path syntax, the ranking rules, nesting, `Outlet`, `Link`, `NavLink`,
`Navigate`, `useNavigate`, `useLocation`, `useRouteParams` and `useSearchParams` all
behave as they do there. Two things are different on purpose.

**Routes are objects, not elements.** React Router can write
`<Route path="/users" element={<Users />} />` because a React element is a
description that the router reads before anything renders. A Firsthand element is
DOM — `<Users />` builds it — so there would be nothing to read. Writing the
route table as data is the same information without the costume, and it is also
what makes `lazy` straightforward: a route can name a module it has not loaded,
which an element cannot.

**Read-only hooks return cells.** A component body runs once, so a hook that
returned a value would return the value it had at setup and never change.

```tsx
const params = useRouteParams<{ id: string }>();
return <h2>User {params.value.id}</h2>; // fine-grained: updates this text node
```

Navigating from `/users/1` to `/users/2` does not re-create the page. The route
is the same, so the component instance is the same; only the text that read the
parameter is rewritten. Changing to a _different_ route disposes the old page
and builds the new one.

## Code splitting

```ts
{ path: 'reports', lazy: () => import('./reports.js') }
```

`lazy` is called the first time the route is entered, once per route, and the
result is cached. Until it resolves the router renders `pending` — the route's
own, or the one passed to `Router` — and swaps to the real page by itself when
the module arrives, because reading the loaded component is an ordinary
reactive read.

`<Link preload>` starts that import on hover and on focus, so the usual case is
that the chunk is already there when the click happens. `preloadRoutes(routes,
path)` does the same from anywhere.

The module may export the component as `default` or be the component itself.

## API

| Export                                                                      | What it is                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Router`                                                                    | Root. Takes `routes`, and optionally `history`, `basename`, `pending` |
| `Outlet`                                                                    | Where a route renders its matched child                               |
| `Link`, `NavLink`                                                           | A real `<a href>`; `NavLink` adds a class while active                |
| `Navigate`                                                                  | Redirects when rendered                                               |
| `useRouter`                                                                 | The router itself: its history, routes and matches                    |
| `useLocation`, `useRouteParams`, `useMatches`, `useMatch`                   | Cells                                                                 |
| `useSearchParams`                                                           | `[cell, setter]`                                                      |
| `useNavigate`                                                               | `(to: string \| number, options?) => void`                            |
| `useBasePath`, `resolvePath`, `isActivePath`                                | The rules links use, exposed                                          |
| `createBrowserHistory`, `createHashHistory`, `createMemoryHistory`          | History adapters                                                      |
| `route`                                                                     | One route, with its parameters read from its own path                 |
| `matchRoutes`, `routeComponent`, `preloadRoutes`                            | The matcher, usable on its own                                        |
| `compilePattern`, `matchPattern`, `normalizePath`, `sameParams`, `segments` | Path utilities                                                        |

### Paths

- `/users/:id` — a parameter, available as `params.value.id`, URL-decoded
- `/users/:id?` — an optional segment
- `/files/*` — a splat, available as `params.value['*']`
- `index: true` — matches when the parent matches and nothing is left over

Routes are **ranked**, not tried in order: `/users/new` wins over `/users/:id`
however the array is sorted.

### Links

`Link` intercepts only a plain left-click on a same-window link. Modified
clicks, middle clicks and `target="_blank"` are left to the browser, and the
`href` is always a real URL — the status bar, "open in new tab" and crawlers all
work. Any prop the router does not use is forwarded to the anchor.

### History

`createBrowserHistory(basename)` is the default. `createHashHistory()` suits a
host that cannot rewrite every path to one document. `createMemoryHistory()` is
what tests should use:

```tsx
const history = createMemoryHistory(['/users/1']);
const view = mount(() => <Router routes={routes} history={history} />);
history.push('/users/2'); // synchronous: the DOM is already updated
```

A history the `Router` created is disposed with it; one you passed in is yours.

## Deployment

A router that owns paths the file system does not know about needs its host to
serve the application's document for unknown paths. That is one rule in most
static hosts, and `createHashHistory()` is the way out when it is not available.
