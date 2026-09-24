/**
 * Route definitions, tree flattening and matching.
 *
 * Routes are plain objects rather than JSX elements. React Router can write
 * `<Route path=... element=... />` because a React element is a description
 * that the router inspects before anything renders; Firsthand has no descriptions
 * — `<Page />` builds DOM — so there would be nothing to inspect. The object
 * form is the same information without pretending otherwise.
 */
import { signal, type Signal } from '@firsthandjs/core';
import type { View } from '@firsthandjs/dom';
import {
  compilePattern,
  matchPattern,
  type Params,
  type ParamsOf,
  type Pattern,
  type Simplify,
} from './match.js';

/**
 * What a route hands its component.
 *
 * One prop, because there is exactly one thing a route knows that its
 * component does not: what the URL captured. Reading `props.params` is an
 * ordinary reactive read, so a navigation from `/users/1` to `/users/2`
 * updates what read it and remounts nothing.
 */
export type RouteProps<P extends Params = Params> = {
  readonly params: P;
};

/** A component that a route renders. */
export type RouteComponent<P extends Params = Params> = (props: RouteProps<P>) => View;

/** What a `lazy` import may resolve to: the component, or a module holding it. */
export type LazyModule<P extends Params = Params> =
  RouteComponent<P> | { readonly default: RouteComponent<P> };

export type RouteDefinition = {
  /** Relative to the parent, unless it starts with `/`. */
  readonly path?: string;
  /** Matches when the parent matches and nothing is left over. */
  readonly index?: boolean;
  readonly component?: RouteComponent;
  /**
   * Loads the component when the route is first entered.
   *
   * This is the code-splitting seam: `lazy: () => import('./Settings.js')`
   * keeps that module out of the initial bundle, and the bundler turns it into
   * its own chunk. The import runs once per route and the result is cached.
   */
  readonly lazy?: () => Promise<LazyModule>;
  /** Shown while `lazy` is loading, instead of the router's own fallback. */
  readonly pending?: () => View;
  /** Shown when `lazy` fails, instead of the router's own failure view. */
  readonly error?: (error: unknown) => View;
  readonly children?: readonly RouteDefinition[];
};

export type RouteMatch = {
  readonly route: RouteDefinition;
  readonly params: Params;
  /** The portion of the pathname this route and its ancestors consumed. */
  readonly pathname: string;
};

type Level = {
  readonly route: RouteDefinition;
  readonly pattern: Pattern;
};

type Branch = {
  readonly levels: readonly Level[];
  readonly score: number;
};

/** Flattened branches are reused across navigations for the same route array. */
const branchCache = new WeakMap<readonly RouteDefinition[], Branch[]>();

/** A route's own path contribution; an index route adds nothing. */
function pathOf(route: RouteDefinition): string {
  return route.index === true ? '' : (route.path ?? '');
}

function flatten(
  routes: readonly RouteDefinition[],
  parents: readonly RouteDefinition[],
  into: Branch[],
): void {
  for (const route of routes) {
    const chain = [...parents, route];
    // Every route is a possible destination, including a layout route: a URL
    // that matches the layout exactly renders it with an empty outlet, exactly
    // as it does in react-router. Ranking decides between that and a deeper
    // branch, so declaring children never hides the parent.
    into.push(branch(chain));
    const children = route.children;
    if (children !== undefined) {
      flatten(children, chain, into);
    }
  }
}

function branch(chain: readonly RouteDefinition[]): Branch {
  const levels = chain.map((member, index) => ({
    route: member,
    // Every level but the last matches a prefix, so that the next level has
    // something left to match. Leading slashes are insignificant: a child path
    // is always relative to its parent.
    pattern: compilePattern(pathOf(member), index === chain.length - 1),
  }));
  return {
    levels,
    score: levels.reduce((total, level) => total + level.pattern.score, 0),
  };
}

function branchesFor(routes: readonly RouteDefinition[]): Branch[] {
  const cached = branchCache.get(routes);
  if (cached !== undefined) {
    return cached;
  }
  const branches: Branch[] = [];
  flatten(routes, [], branches);
  // Most specific first, so the array's own order never decides a match.
  branches.sort((a, b) => b.score - a.score);
  branchCache.set(routes, branches);
  return branches;
}

/**
 * Matches a pathname against a route tree.
 *
 * Returns the chain from the outermost route to the matched leaf, which is
 * what `Outlet` walks, or `null` when nothing matched.
 */
export function matchRoutes(
  routes: readonly RouteDefinition[],
  pathname: string,
): RouteMatch[] | null {
  for (const branch of branchesFor(routes)) {
    const matches: RouteMatch[] = [];
    let remaining = pathname === '' ? '/' : pathname;
    let consumed = '';
    let params: Params = {};
    let failed = false;

    for (const level of branch.levels) {
      const found = matchPattern(level.pattern, remaining);
      if (found === null) {
        failed = true;
        break;
      }
      params = { ...params, ...found.params };
      consumed += found.consumed;
      matches.push({ route: level.route, params, pathname: consumed === '' ? '/' : consumed });
      remaining = remaining.slice(found.consumed.length);
    }

    if (!failed) {
      return matches;
    }
  }
  return null;
}

/**
 * A lazy route's chunk: the component once it lands, or why it did not.
 *
 * Both are signals, so a view reading either one swaps by itself when the
 * answer arrives — including the answer that there is none.
 */
type Chunk = {
  component: Signal<RouteComponent | undefined>;
  failure: Signal<unknown>;
};

/** Resolved lazy components, keyed by the route that asked for them. */
const loaded = new WeakMap<RouteDefinition, Chunk>();

/**
 * The component for a route, loading it on first use.
 *
 * Reading this inside a reactive scope subscribes to the load, so the view
 * swaps from the pending state to the real one by itself when the chunk
 * arrives — no callback, no state machine in the application.
 */
export function routeComponent(route: RouteDefinition): RouteComponent | undefined {
  if (route.component !== undefined) {
    return route.component;
  }
  let chunk = loaded.get(route);
  if (chunk === undefined) {
    chunk = {
      component: signal<RouteComponent | undefined>(undefined),
      failure: signal(undefined),
    };
    loaded.set(route, chunk);
    void startLoading(route, chunk);
  }
  const failure = chunk.failure.value;
  if (failure !== undefined) {
    // Forgotten before it is thrown, so the next navigation to this route asks
    // for the chunk again. The usual cause is a deploy that replaced the build
    // under an open document, and by the second attempt it is over.
    loaded.delete(route);
    // Whatever the loader rejected with, unchanged: wrapping it would hide the
    // reason a bundler gave for a chunk it could not fetch, and `startLoading`
    // has already supplied an Error for the one case that carried nothing.
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- see above
    throw failure;
  }
  return chunk.component.value;
}

async function startLoading(route: RouteDefinition, chunk: Chunk): Promise<void> {
  try {
    const module = await (route.lazy as () => Promise<LazyModule>)();
    chunk.component.value = typeof module === 'function' ? module : module.default;
  } catch (error: unknown) {
    // A chunk that never arrives is not a route that renders forever. Reported
    // through the signal rather than thrown here, because nobody is awaiting
    // this: the throw belongs on the read, where a `catchError` is watching.
    // `Promise.reject()` with no reason is rare and legal, and `undefined` is
    // how this signal says "no failure" — so it needs something to carry.
    chunk.failure.value = error ?? new Error('the route chunk failed to load');
  }
}

/**
 * Loads the code for whatever `pathname` would render, without navigating.
 *
 * Called on hover or focus by `<Link preload>`, so the chunk is usually already
 * there by the time the click happens.
 */
export function preloadRoutes(routes: readonly RouteDefinition[], pathname: string): void {
  const matches = matchRoutes(routes, pathname);
  if (matches === null) {
    return;
  }
  for (const match of matches) {
    if (match.route.component === undefined && match.route.lazy !== undefined) {
      routeComponent(match.route);
    }
  }
}

// ---------------------------------------------------------------------------
// Typed routes
// ---------------------------------------------------------------------------

/**
 * One route, with its parameters read from its own path.
 *
 * The route table already says what each path is, so nothing is declared
 * twice: `route({ path: 'users/:id', … })` types its component's
 * `props.params` as `{ id: string }`, and a component that reaches for a
 * parameter the path does not capture does not compile.
 *
 * ```tsx
 * const routes = [
 *   route({
 *     path: '/',
 *     component: Shell,
 *     children: (child) => [
 *       child({ index: true, component: Home }),
 *       child({ path: 'users/:id', component: ({ params }) => <User id={params.id} /> }),
 *     ],
 *   }),
 * ];
 * ```
 *
 * `children` as a **function** is what carries a parent's parameters down: the
 * builder it is handed knows what the ancestors captured, so the child above
 * sees both. Children as a plain array work too, and see only their own.
 *
 * All of it is types. `route` returns the object it was given, with a
 * function-form `children` called once, and a table written as plain
 * `RouteDefinition[]` still works — its components just see `Params`.
 */
export const route: RouteBuilder<unknown> = (spec: object): RouteDefinition => {
  const { children, ...rest } = spec as {
    children?: readonly RouteDefinition[] | ((child: unknown) => readonly RouteDefinition[]);
  };
  if (typeof children !== 'function') {
    return spec;
  }
  // The builder handed to the callback is this same function: the parameters
  // it carries exist only in the type system.
  return { ...rest, children: children(route) };
};

/** What `route` accepts, with `Own` from its path and `Inherited` from above. */
type RouteSpec<Own, Inherited> = {
  readonly component?: RouteComponent<Simplify<Inherited & Own> & Params>;
  /** Loaded when the route is first entered; the result is cached. */
  readonly lazy?: () => Promise<LazyModule<Simplify<Inherited & Own> & Params>>;
  /** Shown while `lazy` is loading, instead of the router's own fallback. */
  readonly pending?: () => View;
  /** Shown when `lazy` fails, instead of the router's own failure view. */
  readonly error?: (error: unknown) => View;
  readonly children?:
    | readonly RouteDefinition[]
    | ((child: RouteBuilder<Simplify<Inherited & Own>>) => readonly RouteDefinition[]);
};

/** Builds one route, knowing what the routes above it captured. */
export type RouteBuilder<Inherited> = {
  <const Path extends string>(
    spec: { readonly path: Path } & RouteSpec<ParamsOf<Path>, Inherited>,
  ): RouteDefinition;
  /** An index route adds no path, so it captures exactly what its parent did. */
  (spec: { readonly index: true } & RouteSpec<unknown, Inherited>): RouteDefinition;
};
