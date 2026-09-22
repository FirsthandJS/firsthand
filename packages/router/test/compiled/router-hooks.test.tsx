/**
 * What a route hands the component it matched: the hooks, the helpers, and the
 * params.
 *
 * The components themselves — Router, Link, NavLink, Navigate — are in
 * `router.test.tsx`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { component, computed, createRoot, provide } from '@firsthandjs/dom';
import { cleanup, mount } from '@firsthandjs/testing';
import {
  Link,
  Outlet,
  Router,
  createMemoryHistory,
  resolvePath,
  useLocation,
  useMatch,
  useMatches,
  useNavigate,
  useRouteParams,
  useSearchParams,
  isActivePath,
  useBasePath,
  RouterContext,
  route,
  type RouteDefinition,
} from '@firsthandjs/router';

afterEach(cleanup);

describe('hooks', () => {
  it('navigates by path and by delta', () => {
    const history = createMemoryHistory(['/a']);
    const Page = component(() => {
      const navigate = useNavigate();
      return (
        <div>
          <button id="to" onClick={() => navigate('/b')}>
            to b
          </button>
          <button id="back" onClick={() => navigate(-1)}>
            back
          </button>
          <button id="replace" onClick={() => navigate('/c', { replace: true })}>
            replace
          </button>
        </div>
      );
    });
    const routes: RouteDefinition[] = [
      { path: '/a', component: Page },
      { path: '/b', component: Page },
      { path: '/c', component: Page },
    ];
    const view = mount(() => <Router routes={routes} history={history} />);

    view.get<HTMLButtonElement>('#to').click();
    expect(history.location.value.pathname).toBe('/b');
    view.get<HTMLButtonElement>('#back').click();
    expect(history.location.value.pathname).toBe('/a');
    view.get<HTMLButtonElement>('#replace').click();
    expect(history.location.value.pathname).toBe('/c');
  });

  it('keeps the params cell stable when the set of parameters changes', () => {
    const history = createMemoryHistory(['/opt']);
    const Page = component(() => {
      const params = useRouteParams<{ id?: string }>();
      return <p>{params.value.id ?? 'none'}</p>;
    });
    const view = mount(() => (
      <Router routes={[{ path: '/opt/:id?', component: Page }]} history={history} />
    ));

    expect(view.text()).toBe('none');
    history.push('/opt/5');
    expect(view.text()).toBe('5');
    history.push('/opt');
    expect(view.text()).toBe('none');
  });

  it('exposes the location and the matched chain', () => {
    const history = createMemoryHistory(['/deep/1?q=x']);
    const Leaf = component(() => {
      const location = useLocation();
      const matches = useMatches();
      return (
        <p>
          {location.value.search} {String(matches.value.length)}
        </p>
      );
    });
    const view = mount(() => (
      <Router
        routes={[
          {
            path: '/deep',
            component: component(() => <Outlet />),
            children: [{ path: ':n', component: Leaf }],
          },
        ]}
        history={history}
      />
    ));

    expect(view.text()).toBe('?q=x 2');
  });

  it('matches an arbitrary pattern against the current location', () => {
    const history = createMemoryHistory(['/users/9']);
    const Page = component(() => {
      const match = useMatch<{ id: string }>('/users/:id');
      const other = useMatch<{ id: string }>('/teams/:id');
      return (
        <p>
          {match.value?.params.id ?? 'none'}/{other.value === null ? 'none' : 'some'}
        </p>
      );
    });
    const view = mount(() => (
      <Router routes={[{ path: '/users/:id', component: Page }]} history={history} />
    ));

    expect(view.text()).toBe('9/none');
  });

  it('reads and writes search parameters', () => {
    const history = createMemoryHistory(['/search?q=cats']);
    const Page = component(() => {
      const [params, setParams] = useSearchParams();
      return (
        <div>
          <p>{params.value.get('q') ?? ''}</p>
          <button id="dogs" onClick={() => setParams({ q: 'dogs' })}>
            dogs
          </button>
          <button id="clear" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            clear
          </button>
        </div>
      );
    });
    const view = mount(() => (
      <Router routes={[{ path: '/search', component: Page }]} history={history} />
    ));

    expect(view.get('p').textContent).toBe('cats');
    view.get<HTMLButtonElement>('#dogs').click();
    expect(history.location.value.search).toBe('?q=dogs');
    expect(view.get('p').textContent).toBe('dogs');
    view.get<HTMLButtonElement>('#clear').click();
    expect(history.location.value.search).toBe('');
    expect(view.get('p').textContent).toBe('');
  });

  it('resolves relative paths outside any route as absolute', () => {
    const history = createMemoryHistory(['/']);
    const view = mount(() => (
      <Router
        routes={[{ path: '/', component: component(() => <Link to="somewhere">go</Link>) }]}
        history={history}
      />
    ));
    expect(view.get<HTMLAnchorElement>('a').getAttribute('href')).toBe('/somewhere');
  });
});

describe('outside a matched route', () => {
  /** A router context with nothing matched, which is what disposal looks like. */
  const empty = (): void => {
    provide(RouterContext, {
      history: createMemoryHistory(['/x']),
      routes: [],
      matches: computed(() => []),
      pending: undefined,
    });
  };

  it('resolves the base path to the root', () => {
    createRoot((dispose) => {
      empty();
      expect(useBasePath().value).toBe('/');
      dispose();
    });
  });

  it('reports no parameters', () => {
    createRoot((dispose) => {
      empty();
      expect(useRouteParams().value).toEqual({});
      dispose();
    });
  });
});

describe('isActivePath', () => {
  it('treats the root as a prefix of everything', () => {
    expect(isActivePath('/anything/deep', '/', false)).toBe(true);
    expect(isActivePath('/anything/deep', '/', true)).toBe(false);
    expect(isActivePath('/docs/intro', '/docs', false)).toBe(true);
    expect(isActivePath('/documents', '/docs', false)).toBe(false);
  });
});

describe('resolvePath', () => {
  it('handles absolute, relative, dot and parent segments', () => {
    expect(resolvePath('/a/b', '/base')).toBe('/a/b');
    expect(resolvePath('c', '/a/b')).toBe('/a/b/c');
    expect(resolvePath('./c', '/a/b')).toBe('/a/b/c');
    expect(resolvePath('../c', '/a/b')).toBe('/a/c');
    expect(resolvePath('../../c', '/a/b')).toBe('/c');
    expect(resolvePath('', '/a/b')).toBe('/a/b');
    expect(resolvePath('?q=1', '/a')).toBe('/a?q=1');
    expect(resolvePath('/a/?q=1#h', '/base')).toBe('/a?q=1#h');
  });
});

describe('route()', () => {
  it('hands a route component its parameters as a prop', () => {
    const routes = [
      route({
        path: 'users/:id',
        component: ({ params }) => <h2 data-testid="user">user {params.id}</h2>,
      }),
    ];
    const history = createMemoryHistory(['/users/7']);
    const view = mount(() => <Router routes={routes} history={history} />);

    expect(view.get('[data-testid="user"]').textContent).toBe('user 7');

    // The same route with another parameter updates in place.
    const heading = view.get('[data-testid="user"]');
    history.push('/users/8');
    expect(view.get('[data-testid="user"]').textContent).toBe('user 8');
    expect(view.get('[data-testid="user"]')).toBe(heading);
  });

  it('carries a parent route’s parameters into a child built by the callback', () => {
    const routes = [
      route({
        path: 'orgs/:org',
        component: () => <Outlet />,
        children: (child) => [
          child({
            path: 'users/:id',
            component: ({ params }) => (
              <p data-testid="both">
                {params.org}/{params.id}
              </p>
            ),
          }),
          child({ index: true, component: ({ params }) => <p data-testid="both">{params.org}</p> }),
        ],
      }),
    ];
    const history = createMemoryHistory(['/orgs/acme/users/3']);
    const view = mount(() => <Router routes={routes} history={history} />);

    expect(view.get('[data-testid="both"]').textContent).toBe('acme/3');

    history.push('/orgs/acme');
    expect(view.get('[data-testid="both"]').textContent).toBe('acme');
  });

  it('returns a plain definition, children and all', () => {
    const child = route({ path: 'a' });
    const parent = route({ path: '/', children: [child] });
    expect(parent.children).toEqual([child]);

    // The function form is called once, at definition time, and what it
    // returns is an ordinary array.
    const built = route({ path: '/', children: (make) => [make({ path: 'b' })] });
    expect(built.children?.[0]?.path).toBe('b');
  });

  it('gives a component with no parameters an empty object rather than undefined', () => {
    const routes = [
      route({
        path: 'about',
        component: ({ params }) => <p data-testid="about">{Object.keys(params).length}</p>,
      }),
    ];
    const history = createMemoryHistory(['/about']);
    const view = mount(() => <Router routes={routes} history={history} />);

    expect(view.get('[data-testid="about"]').textContent).toBe('0');
  });
});

describe('the params a route hands its component', () => {
  it('behaves like an ordinary object, and every read is live', () => {
    let seen: Record<string, unknown> = {};
    const routes = [
      route({
        path: 'users/:id',
        component: (props) => {
          const params = props.params as Record<string, string>;
          seen = {
            spread: { ...params },
            keys: Object.keys(params),
            hasId: 'id' in params,
            hasOther: 'other' in params,
            // A symbol key is not a parameter, and must not be looked up as one.
            symbol: (params as unknown as Record<symbol, unknown>)[Symbol.iterator],
            descriptor: Object.getOwnPropertyDescriptor(params, 'id'),
            missing: Object.getOwnPropertyDescriptor(params, 'other'),
            symbolDescriptor: Object.getOwnPropertyDescriptor(params, Symbol.iterator),
          };
          return <p data-testid="live">{params['id']}</p>;
        },
      }),
    ];
    const history = createMemoryHistory(['/users/7']);
    const view = mount(() => <Router routes={routes} history={history} />);

    expect(seen['spread']).toEqual({ id: '7' });
    expect(seen['keys']).toEqual(['id']);
    expect(seen['hasId']).toBe(true);
    expect(seen['hasOther']).toBe(false);
    expect(seen['symbol']).toBeUndefined();
    expect(seen['descriptor']).toMatchObject({ value: '7', enumerable: true });
    expect(seen['missing']).toBeUndefined();
    expect(seen['symbolDescriptor']).toBeUndefined();

    history.push('/users/8');
    expect(view.get('[data-testid="live"]').textContent).toBe('8');
  });

  it('reads as empty from a reference kept after the route is gone', () => {
    let kept: Record<string, string> = {};
    const routes: RouteDefinition[] = [
      route({
        path: 'users/:id',
        component: (props) => {
          kept = props.params as Record<string, string>;
          return <p>user</p>;
        },
      }),
    ];
    const history = createMemoryHistory(['/users/7']);
    mount(() => <Router routes={routes} history={history} />);
    expect(kept['id']).toBe('7');

    // Navigating to something that matches nothing leaves this depth without
    // a match at all. Whatever kept the object — a closure, a timer — reads
    // empty rather than throwing or reporting a route that is gone.
    history.push('/nowhere');
    expect(kept['id']).toBeUndefined();
    expect(Object.keys(kept)).toEqual([]);
  });
});
