/**
 * Hooks.
 *
 * The names are react-router's, the return types are not: each read-only hook
 * hands back a cell rather than a value, because a component body runs once.
 * `useRouteParams().value.id` inside a JSX expression is a fine-grained read, and
 * changing the parameter updates exactly that text node.
 */
import { computed, useContext, type ReadonlyCell } from '@firsthandjs/core';
import { DepthContext, RouterContext, type RouterState } from './router.js';
import {
  compilePattern,
  matchPattern,
  normalizePath,
  sameParams,
  segments,
  type Params,
} from './match.js';
import type { Location, NavigateOptions } from './history.js';
import type { RouteMatch } from './routes.js';

/** What `useNavigate` returns: a path, or a delta through the history stack. */
export type NavigateFunction = (to: string | number, options?: NavigateOptions) => void;

/**
 * Resolves `to` against a base path.
 *
 * `..` steps up a path segment. React Router steps up a *route* level, which
 * differs only when one route owns several segments; the path rule is the one
 * that can be explained without knowing the route tree.
 */
export function resolvePath(to: string, base: string): string {
  const cut = to.search(/[?#]/);
  const path = cut === -1 ? to : to.slice(0, cut);
  const suffix = cut === -1 ? '' : to.slice(cut);
  if (path.startsWith('/')) {
    return `${normalizePath(path)}${suffix}`;
  }
  const parts = segments(base);
  for (const step of segments(path)) {
    if (step === '.') {
      continue;
    }
    if (step === '..') {
      parts.pop();
      continue;
    }
    parts.push(step);
  }
  return `/${parts.join('/')}${suffix}`;
}

/** The path everything relative in the surrounding route resolves against. */
export function useBasePath(): ReadonlyCell<string> {
  const router = useContext(RouterContext);
  const depth = useContext(DepthContext).value;
  // A negative depth — a link rendered by the router itself rather than by a
  // route — indexes nothing and falls through to the root.
  return computed(() => router.value.matches.value[depth]?.pathname ?? '/');
}

/**
 * The router above this component.
 *
 * The same shape as `useQueryClient()` in `@firsthandjs/query`: a `use*` hook that
 * returns the thing itself, because a router does not change under you.
 */
export function useRouter(): RouterState {
  return useContext(RouterContext).value;
}

export function useLocation(): ReadonlyCell<Location> {
  return useRouter().history.location;
}

/**
 * The parameters of the deepest matched route, merged down the chain.
 *
 * The type parameter names what the route captures — `useRouteParams<{ id: string
 * }>()` — which is what lets `params.value.id` be written as a property
 * instead of an index. It is an assertion about the route, exactly as it is in
 * react-router, and it appears only in the return type.
 */
export function useRouteParams<P extends Params = Params>(): ReadonlyCell<P> {
  const router = useContext(RouterContext);
  return computed<P>(
    () => {
      const matches = router.value.matches.value;
      return (matches[matches.length - 1]?.params ?? {}) as P;
    },
    // Every navigation builds a fresh params object; without this, moving from
    // `/a?x=1` to `/a?x=2` would invalidate every reader of `params`.
    { equals: sameParams as (a: P, b: P) => boolean },
  );
}

/** The whole matched chain, outermost first. */
export function useMatches(): ReadonlyCell<readonly RouteMatch[]> {
  return useContext(RouterContext).value.matches;
}

export function useNavigate(): NavigateFunction {
  const router = useContext(RouterContext);
  const base = useBasePath();
  return (to, options) => {
    const { history } = router.value;
    if (typeof to === 'number') {
      history.go(to);
      return;
    }
    const target = resolvePath(to, base.value);
    if (options?.replace === true) {
      history.replace(target, options);
    } else {
      history.push(target, options);
    }
  };
}

/** Whether a path is active, by the same rule `NavLink` uses. */
export function isActivePath(current: string, target: string, end: boolean): boolean {
  const a = normalizePath(current);
  const b = normalizePath(target);
  return end ? a === b : a === b || a.startsWith(b === '/' ? '/' : `${b}/`);
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function useMatch<P extends Params = Params>(
  path: string,
): ReadonlyCell<{ params: P } | null> {
  const pattern = compilePattern(path, true);
  const location = useLocation();
  return computed(() => matchPattern(pattern, location.value.pathname) as { params: P } | null);
}

/** Reads and writes the query string. */
export function useSearchParams(): [
  ReadonlyCell<URLSearchParams>,
  (next: URLSearchParams | Record<string, string>, options?: NavigateOptions) => void,
] {
  const location = useLocation();
  const navigate = useNavigate();
  const params = computed(() => new URLSearchParams(location.value.search));
  const set = (next: URLSearchParams | Record<string, string>, options?: NavigateOptions): void => {
    const search = new URLSearchParams(next).toString();
    navigate(`${location.value.pathname}${search === '' ? '' : `?${search}`}`, options);
  };
  return [params, set];
}
