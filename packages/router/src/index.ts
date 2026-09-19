/**
 * `@firsthandjs/router` — nested routes, real links, and route code loaded on
 * demand.
 *
 * The API is react-router's, with two deliberate differences:
 *
 * 1. Routes are plain objects, not `<Route>` elements. Firsthand has no element
 *    descriptors to inspect before rendering, so a JSX route tree would be a
 *    costume rather than a design.
 * 2. Read-only hooks return cells, not values, because a component body runs
 *    once. `useRouteParams().value.id` is a fine-grained read; a navigation updates
 *    the text node that read it and nothing else.
 *
 * Everything else — path syntax, ranking, nesting, `Outlet`, `Link`,
 * `NavLink`, `Navigate`, `useNavigate`, `useLocation`, `useSearchParams` —
 * behaves as it does there.
 */
export { Router, Outlet, RouterContext } from './router.js';
export type { RouterProps, RouterState } from './router.js';
export { Link, NavLink } from './links.js';
export type { LinkProps, NavLinkProps } from './links.js';
export { Navigate } from './navigate.js';
export type { NavigateProps } from './navigate.js';
export {
  useRouter,
  useLocation,
  useMatch,
  useMatches,
  useNavigate,
  useRouteParams,
  useSearchParams,
  useBasePath,
  resolvePath,
  isActivePath,
} from './hooks.js';
export type { NavigateFunction } from './hooks.js';
export { matchRoutes, routeComponent, preloadRoutes, route } from './routes.js';
export type {
  RouteBuilder,
  RouteDefinition,
  RouteMatch,
  RouteComponent,
  RouteProps,
  LazyModule,
} from './routes.js';
export {
  createBrowserHistory,
  createHashHistory,
  createMemoryHistory,
  parsePath,
} from './history.js';
export type { History, Location, NavigateOptions } from './history.js';
export { compilePattern, matchPattern, normalizePath, sameParams, segments } from './match.js';
export type { Params, ParamsOf, Pattern } from './match.js';
