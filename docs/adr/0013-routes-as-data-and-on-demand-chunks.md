# ADR-0013: Routes as data, and route code loaded on demand

Status: **accepted** (2026-09-19)

## Problem

Applications need routing, and the router people know is `react-router-dom`. The
brief is "almost 1:1 like react-router-dom", plus something react-router only
gained later and never made central: entering a route must be able to _load_ the
code for that route, so that an application is not one bundle.

Two things make a straight port impossible to do honestly:

1. React Router's route table is JSX — `<Route path element={<Page />} />`. A
   React element is a description; the router reads `props.path` off it before
   anything renders. A Firsthand element is DOM: `<Page />` has already built
   nodes by the time anyone could inspect it.
2. React Router's hooks return values, and a re-render delivers the next one.
   Firsthand component bodies run once, so a hook returning `params.id` would
   return the parameter it had at setup, for ever.

## Constraints

- Path syntax, ranking, nesting, `Outlet`, `Link`, `NavLink`, `Navigate` and the
  hook names must match react-router, or the familiarity is worth nothing.
- Navigating between two URLs of the same route must **update** the page, not
  replace it. Replacing it would discard DOM and component state for a change
  that moved a string.
- A lazily loaded route must not require the application to write a loading
  state machine.
- No dependency, and no meaningful size added to applications that do not route.
- `<a href>` must be a real link: status bar, middle-click, "open in new tab",
  crawlers.

## Options considered

1. **JSX route elements, inspected before rendering.** Would require route
   elements to be inert descriptors — a second, parallel element model beside
   the real one, with its own type rules, existing only to be read by the
   router. Rejected: it would be a costume over a mechanism that does not exist
   here, and it cannot express `lazy` at all, because an element cannot
   reference a component that has not been imported.
2. **A `createRoutes()` builder DSL.** `route('/users', Users, [route(':id',
User)])`. Same information as an object, more to learn, worse to serialise,
   and it hides the fact that a route table is data.
3. **Plain objects** — `{ path, component, children, lazy, pending, index }`.
   Chosen.

And for what the hooks return:

1. **Values.** Correct in a re-render model, silently wrong here.
2. **Getter functions** — `params().id`. Works, but reads differently from every
   other value in a Firsthand application.
3. **Cells** — `params.value.id`. Chosen: identical in shape to a signal or a
   computed, and fine-grained by construction.

## Chosen design

**Matching.** The route tree is flattened once per route array into ranked
branches, cached in a `WeakMap` keyed by that array. Every route is a possible
destination, including a layout route with children, so a URL matching the
layout exactly renders it with an empty outlet — react-router's behaviour.
Scoring is react-router's: static 10, dynamic 6, optional 4, index 2, splat 1,
summed over the branch, highest first. Declaration order never decides a match.

**Rendering.** `Router` puts the matched chain in a context and renders depth 0;
`Outlet` renders depth + 1, reading its own depth from a second context that the
depth above provided. The part at each depth watches
`computed(() => matches.value[depth]?.route)` — the route _object_, not the
match. That single choice is what makes a parameter change an update: the
computed's value is unchanged, so the part never re-runs, while `useRouteParams()`,
a separate cell, does change and rewrites exactly the text that read it.

**Loading.** `routeComponent(route)` returns `route.component`, or reads a signal
that a one-shot `route.lazy()` import fills in. Because it is read inside the
rendering part, resolution is an ordinary reactive update: pending view now,
real page when the chunk lands, no callback and no state machine. `<Link
preload>` calls the same function on `pointerenter` and `focus`, attached
directly rather than through delegation because neither event bubbles.

**Failing to load.** _Amended (0.11.2):_ the first version of this design had
only the success path. An import that rejects — a deploy replaced the build
while somebody had the old document open, which is the ordinary reason — left
the signal empty and the rejection unhandled, so the pending view stayed on
screen for ever with nothing behind it, and the failed attempt was remembered,
so going back never asked again.

The failure is now a second signal beside the component, which the same
rendering part reads, so reporting it is the same ordinary reactive update that
success is. The route's `error` view wins over the router's; with neither, the
failure is thrown where the route would have rendered and a `catchError` above
sees it. It is forgotten before it is reported, which makes the next navigation
a second attempt — the retry costs nothing to implement and is right far more
often than not, because the cause is usually over by then.

**Links.** `Link` builds an `<a>` with DOM calls rather than TSX, so the package
needs no compiler pass of its own. It intercepts a click only when it is
unmodified, left-button, and same-window; anything else is the browser's.

## Performance implications

- Matching is a pre-compiled regular expression per level, run over a path that
  shortens as levels consume it. Flattening and compiling happen once per route
  array, not per navigation.
- A navigation between two URLs of the same route touches only the cells that
  actually changed: measured in `packages/router/test/compiled/router.test.tsx`
  as one setup call across the change, and in Chromium, Firefox and WebKit as an
  element that survives it (`tests/browser/router.spec.ts`).
- The package is 3.36 kB gzip, measured by `npm run build`, and is reported
  outside the runtime budget because an application that does not route never
  downloads it.

## Memory implications

- One `WeakMap` entry per route array, released with the array.
- One signal per lazily loaded route, in a `WeakMap` keyed by the route.
- Route pages are owned by the part that rendered them, so leaving a route
  disposes its effects and removes its nodes through the ordinary owner tree.

## DX implications

- The route table is data: it can be generated, split across files, or walked to
  build a sitemap.
- **A route's parameters come from its own path.** `route({ path: 'users/:id',
… })` keeps the path as a literal type and types the component as receiving
  `props.params: { id: string }`; `children` written as a function hands a
  builder that carries the ancestors' parameters down. Nothing declares a
  parameter twice, and asking for one the path does not capture does not
  compile. The runtime is untouched — `route` returns the object it was given —
  so a plain `RouteDefinition[]` still works, with `params` typed as `Params`.
- `useRouteParams<{ id: string }>()` remains for a component that takes no
  props, and for a **layout**, which is not the component of the route that
  captured the parameter and so has nothing to be typed against. Its type
  argument is an assertion nobody verifies; the prop is checked.
- The one thing to unlearn from react-router is `.value`.
- A route component written as a plain function is declared once behind the
  scenes, so it gets its own owner and an untracked setup. Without that, reading
  a parameter would subscribe the part that renders it, and the next navigation
  would rebuild the page instead of updating it — which is exactly what it did
  until a test caught it.

## Rejected alternatives

- **A `<Routes>`/`<Route>` element API.** See option 1: it cannot express
  `lazy`, and it would require inventing a descriptor element model that the
  framework otherwise does not have.
- **Re-creating the page on every navigation.** Simpler to implement, and it
  throws away the property that makes this framework worth using.
- **Suspense-style loading.** A separate mechanism for "a value is not here
  yet", when a signal that is `undefined` until it is not already says exactly
  that.
- **A data layer (`loader`, `action`) as in react-router 6.4+.** Fetching is the
  job of a cache with its own invalidation rules, not of the router.
