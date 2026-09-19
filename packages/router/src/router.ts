/**
 * The router itself: context, the matched chain, and `Outlet`.
 *
 * Rendering a chain of nested routes needs one property that is easy to lose:
 * navigating from `/users/1` to `/users/2` must *update* the user page, not
 * replace it, because replacing it would throw away its DOM and its state for
 * a change that only moved a parameter. So each depth watches the route
 * *object* at that depth, not the match: the component is created again only
 * when the route actually differs, and parameters reach it as ordinary
 * reactive reads.
 */
import {
  computed,
  createContext,
  onCleanup,
  provide,
  useContext,
  type ReadonlyCell,
} from '@firsthandjs/core';
import { component, type Component, type View } from '@firsthandjs/dom';
import { isComponent } from '@firsthandjs/dom/internal';
import { part, type DynamicChild } from '@firsthandjs/dom/internal';
import { createBrowserHistory, type History } from './history.js';
import {
  matchRoutes,
  routeComponent,
  type RouteComponent,
  type RouteDefinition,
  type RouteMatch,
  type RouteProps,
} from './routes.js';
import { sameParams, type Params } from './match.js';

export interface RouterState {
  readonly history: History;
  readonly routes: readonly RouteDefinition[];
  /** The chain from the outermost matched route to the leaf. Empty if none matched. */
  readonly matches: ReadonlyCell<readonly RouteMatch[]>;
  /** Shown while a lazy route is loading, unless the route has its own. */
  readonly pending: (() => View) | undefined;
}

export const RouterContext = createContext<RouterState>();

/** How deep in the matched chain the surrounding route sits. */
export const DepthContext = createContext(-1, 'route depth');

const nothing = (): View => null;
const EMPTY_PARAMS: Params = Object.freeze({});

/**
 * A route component as a real component.
 *
 * A route may be written as a plain function — `({ params }) => <User/>` — and
 * a plain function called from here would run *inside* the part that renders
 * it: reading a parameter would subscribe that part, and the next navigation
 * would rebuild the page instead of updating it. Declaring it once gives it
 * what every other component has: its own owner, and an untracked setup.
 */
const declared = new WeakMap<object, Component<RouteProps>>();

function asComponent(target: RouteComponent, path: string): Component<RouteProps> {
  if (isComponent(target)) {
    return target as unknown as Component<RouteProps>;
  }
  let existing = declared.get(target);
  if (existing === undefined) {
    existing = component<RouteProps>(
      (props) => target(props),
      undefined,
      `firsthand/router:route(${path})`,
      'Route',
    );
    declared.set(target, existing);
  }
  return existing;
}

/**
 * Renders the match at `depth`, and provides the depth its children will use.
 *
 * The returned part is anchored where it was written, and evaluated under the
 * owner that wrote it, so a route's context and disposal belong to its parent
 * route rather than to whoever happened to insert it.
 */
function renderDepth(depth: number): DynamicChild {
  const router = useContext(RouterContext);
  // Identity of the route, not of the match: this is what makes a parameter
  // change an update rather than a remount.
  const route = computed(() => router.value.matches.value[depth]?.route);
  // This route's captured parameters — its own and its ancestors'. A fresh
  // object per navigation would invalidate every reader, so equal contents
  // count as no change.
  const params = computed<Params>(() => router.value.matches.value[depth]?.params ?? EMPTY_PARAMS, {
    equals: sameParams,
  });
  /**
   * A live view of the parameters.
   *
   * Not the match's own object: a component may write `({ params }) => …`, and
   * a plain object captured at setup would be that navigation's parameters for
   * ever. Every read here goes to the cell, so `params.id` is a reactive read
   * whether it was reached through `props` or through a destructured binding —
   * the same guarantee props themselves give (ADR-0005).
   */
  // The target is a fresh, extensible object rather than a shared frozen one:
  // a proxy over a non-extensible target may not report keys the target does
  // not have, and these keys are exactly the ones it does not have.
  const view: Params = new Proxy(
    {},
    {
      get: (_target, key) => (typeof key === 'string' ? params.value[key] : undefined),
      has: (_target, key) => typeof key === 'string' && key in params.value,
      ownKeys: () => Object.keys(params.value),
      getOwnPropertyDescriptor: (_target, key) =>
        typeof key === 'string' && key in params.value
          ? { configurable: true, enumerable: true, value: params.value[key] }
          : undefined,
    },
  );

  // One props object for the life of this depth: the component runs once, and
  // reading `props.params` is what subscribes it.
  const props: RouteProps = Object.freeze({ params: view });

  return part(() => {
    const current = route.value;
    if (current === undefined) {
      return null;
    }
    // Provided before the component is created, so the component inherits it.
    provide(DepthContext, depth);
    const Component = routeComponent(current);
    if (Component === undefined) {
      // The chunk is still in flight. Reading `routeComponent` above subscribed
      // to it, so this swaps to the real view by itself once it lands.
      return (current.pending ?? router.value.pending ?? nothing)();
    }
    return asComponent(Component, current.path ?? '')(props);
  });
}

export interface RouterProps {
  readonly routes: readonly RouteDefinition[];
  /** Defaults to a browser history over the real URL. */
  readonly history?: History;
  /** Sub-path the application is served under; ignored if `history` is given. */
  readonly basename?: string;
  /** Shown while a lazy route is loading. */
  readonly pending?: () => View;
}

/**
 * The root of a routed application.
 *
 * A history it created is disposed with it; one that was passed in is not,
 * because the caller owns that.
 */
export const Router = component<RouterProps>(
  (props) => {
    const own = props.history === undefined;
    const history = props.history ?? createBrowserHistory(props.basename ?? '');
    if (own) {
      onCleanup(() => {
        history.dispose();
      });
    }

    const routes = props.routes;
    const matches = computed<readonly RouteMatch[]>(
      () => matchRoutes(routes, history.location.value.pathname) ?? [],
    );
    provide(RouterContext, { history, routes, matches, pending: props.pending });
    provide(DepthContext, -1);

    return renderDepth(0);
  },
  undefined,
  'firsthand/router:Router',
  'Router',
);

/** Where a route renders its matched child route. */
export const Outlet = component<Record<string, never>>(
  () => renderDepth(useContext(DepthContext).value + 1),
  undefined,
  'firsthand/router:Outlet',
  'Outlet',
);
