# Routing

[Index](../README.md) · Previous: [Styling](07-styling.md) · Next:
[Data](09-data.md)

---

```bash
npm install @firsthandjs/router
```

```tsx
import { Router, Outlet, NavLink, route } from '@firsthandjs/router';

const routes = [
  route({
    path: '/',
    component: Shell,
    children: (child) => [
      child({ index: true, component: Home }),
      child({ path: 'users/:id', component: User }),
      child({ path: 'reports', lazy: () => import('./reports.js') }),
      child({ path: '*', component: NotFound }),
    ],
  }),
];

render(() => <Router routes={routes} />);
```

If you know `react-router`, you know this: the same path syntax, the same
ranking, `Outlet`, `Link`, `NavLink`, `Navigate`, and the same hook names. Two
things differ, both on purpose.

**Routes are data, not `<Route>` elements.** A React element is a
description the router reads before anything renders; a Firsthand element is DOM,
so there would be nothing to read. The object form is also what makes `lazy`
possible: a route can name a module it has not imported.

**A route's parameters come from its own path.** `route()` keeps the path as a
literal type and types the component as receiving exactly what that path
captures:

```tsx
import { route, type RouteProps } from '@firsthandjs/router';

const User = component<RouteProps<{ id: string }>>((props) => <h2>User {props.params.id}</h2>);

// Or inline, where no annotation is needed at all:
child({ path: 'users/:id', component: ({ params }) => <h2>User {params.id}</h2> });
```

Nothing is declared twice, and `params.slug` on a route that captures `id` does
not compile. `children` written as a **function** is what carries a parent's
parameters into its children; written as a plain array, they see only their
own. A table written as plain `RouteDefinition[]` still works — its components
just see `Params`.

Navigating from `/users/1` to `/users/2` rewrites that text node. It does not
re-create the page — same route, same component instance. Navigating to a
_different_ route disposes the old page and builds the new one. `props.params`
is a live view of the current match, so destructuring it changes nothing:
`({ params }) => …` and `props.params.id` are both reactive reads.

**Without props**, the hooks return cells, because a component body runs once:

```tsx
const User = component(() => {
  const params = useRouteParams<{ id: string }>();
  return <h2>User {params.value.id}</h2>;
});
```

Prefer the prop where you can: it is checked against the route table, while the
hook's type argument is an assertion nobody verifies. The hook is the right
tool in one place — a component in a **layout**, which is not the component of
the route that captured the parameter and therefore has nothing to be typed
against. `useRouteParams()` there returns the leaf match's parameters, which is
what a sidebar highlighting the open item wants.

## Paths

| Pattern       | Matches                                        |
| ------------- | ---------------------------------------------- |
| `users`       | exactly that segment                           |
| `users/:id`   | a parameter, as `params.value.id`, URL-decoded |
| `users/:id?`  | an optional segment                            |
| `files/*`     | a splat, as `params.value['*']`                |
| `index: true` | the parent's path with nothing left over       |

Routes are **ranked**, not tried in order: `/users/new` wins over `/users/:id`
however the array is sorted. A layout route with children can also match on its
own, rendering with an empty outlet.

## Layouts

```tsx
const Shell = component(() => (
  <main>
    <nav>…</nav>
    <Outlet />
  </main>
));
```

`Outlet` renders the matched child route. The layout is created once and kept
across navigations between its children — put your header, sidebar and
persistent state there.

## Links

```tsx
<Link to="/users/1">Ada</Link>
<Link to="edit">Edit</Link>              {/* relative to the current route */}
<NavLink to="/users" end>Users</NavLink> {/* gets `active` while matching */}
<NavLink to="/docs" activeClass="current">Docs</NavLink>
<Link to="/reports" preload>Reports</Link>
```

A `Link` renders a real `<a href>` and intercepts only a plain left-click on a
same-window link. Modified clicks, middle clicks and `target="_blank"` are the
browser's, the URL is in the status bar, and a crawler sees a link.

## Code loaded on demand

```ts
{ path: 'reports', lazy: () => import('./reports.js'), pending: () => <Spinner /> }
```

`lazy` is called the first time the route is entered, once, and the result is
cached. Until it resolves the router renders `pending` — the route's own, or
the one given to `Router` — and swaps to the real page by itself when the
module arrives, because reading the loaded component is an ordinary reactive
read.

`<Link preload>` starts that import on hover and on focus, so the usual case is
that the chunk is already there when the click happens.
`preloadRoutes(routes, path)` does the same from anywhere.

The module may export the component as `default` or be the component itself.

### When the chunk does not arrive

```tsx
{ path: 'reports', lazy: () => import('./reports.js'), error: (why) => <Sorry why={why} /> }
```

The ordinary reason is a deploy: the build was replaced while somebody had the
old document open, and the file that page asks for is gone. The router renders
`error` — the route's own, or the one given to `Router`. With neither, the
failure is thrown where the route would have rendered, so a `catchError` above
the router sees it.

Either way the failure is forgotten rather than remembered, so the next
navigation to that route asks for the chunk again. What must not happen — and
what used to — is the pending view staying on screen for ever with nothing
behind it and no reason given.

## Navigating in code

```tsx
const navigate = useNavigate();

navigate('/users/1');
navigate('edit'); // relative
navigate('/login', { replace: true, state: { from } });
navigate(-1); // back
```

## Reading the location

```tsx
const location = useLocation(); // ReadonlyCell<Location>
const matches = useMatches(); // the matched chain
const match = useMatch('/users/:id'); // match an arbitrary pattern
const [params, setParams] = useSearchParams();

setParams({ q: 'cats' });
setParams(new URLSearchParams(), { replace: true });
```

## Redirecting

```tsx
{ path: 'old', component: component(() => <Navigate to="/new" />) }
```

`Navigate` redirects in a microtask rather than during setup, because changing
the location from inside the render that is producing it would re-enter that
render. Nothing is painted in between.

## History

```tsx
<Router routes={routes} />                                  {/* browser history */}
<Router routes={routes} basename="/app" />                  {/* under a sub-path */}
<Router routes={routes} history={createHashHistory()} />    {/* a static host */}
<Router routes={routes} history={createMemoryHistory(['/users/1'])} /> {/* tests */}
```

A history the `Router` created is disposed with it; one you passed in is yours.

`basename` is a path segment, not a string prefix: `/app` covers `/app` and
everything under `/app/`, and has nothing to do with `/apple`.

Memory history is what tests should use — synchronous, inspectable, no
`window`:

```tsx
const history = createMemoryHistory(['/users/1']);
const view = mount(() => <Router routes={routes} history={history} />);

history.push('/users/2');
expect(view.text()).toContain('Grace'); // no await: writes are synchronous
```

## Deploying

A router owns paths the file system does not know about, so the host must serve
the application's document for unknown paths. That is one rule in most static
hosts; `createHashHistory()` is the way out when it is not available. See
[Building and deploying](16-building.md).

---

Next: [Data](09-data.md) — talking to a server.
