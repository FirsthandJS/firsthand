/**
 * The router as an application uses it: TSX, compiled by the real compiler.
 *
 * The assertions worth reading are the identity ones. A router that re-creates
 * a page on every navigation is easy to write and is what this design exists to
 * avoid, so the tests check the element and the setup count, not just the text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, computed, createRoot, provide, signal } from '@firsthandjs/dom';
import { cleanup, mount, tick } from '@firsthandjs/testing';
import {
  Link,
  Navigate,
  NavLink,
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
  type History,
  type RouteDefinition,
} from '@firsthandjs/router';

afterEach(cleanup);

const Home = component(() => <h1>home</h1>);
const About = component(() => <h1>about</h1>);

/**
 * Clicks, and reports whether the browser would have followed the link.
 *
 * The default is always cancelled afterwards, by a listener registered after
 * the router's own: letting a real navigation escape would make the DOM
 * emulation try to fetch the URL, which is slow, noisy and beside the point.
 * What the test wants to know — did the router take this click? — is read
 * before that happens.
 */
const click = (element: Element, init: MouseEventInit = {}): boolean => {
  let followed = false;
  const probe = (event: Event): void => {
    followed = !event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener('click', probe);
  element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }),
  );
  document.removeEventListener('click', probe);
  return followed;
};

describe('Router', () => {
  it('renders the route that matches, and swaps on navigation', () => {
    const history = createMemoryHistory(['/']);
    const routes: RouteDefinition[] = [
      { path: '/', component: Home },
      { path: '/about', component: About },
    ];
    const view = mount(() => <Router routes={routes} history={history} />);

    expect(view.text()).toBe('home');
    history.push('/about');
    expect(view.text()).toBe('about');
    history.push('/nowhere');
    expect(view.text()).toBe('');
  });

  it('renders nothing when no route matches at all', () => {
    const history = createMemoryHistory(['/missing']);
    const view = mount(() => (
      <Router routes={[{ path: '/', component: Home }]} history={history} />
    ));
    expect(view.text()).toBe('');
  });

  it('renders children through an Outlet', () => {
    const history = createMemoryHistory(['/users/1']);
    const User = component(() => {
      const params = useRouteParams<{ id: string }>();
      return <p>user {params.value.id}</p>;
    });
    const Shell = component(() => (
      <main>
        <nav>shell</nav>
        <Outlet />
      </main>
    ));
    const routes: RouteDefinition[] = [
      {
        path: '/',
        component: Shell,
        children: [
          { index: true, component: Home },
          { path: 'users/:id', component: User },
        ],
      },
    ];
    const view = mount(() => <Router routes={routes} history={history} />);

    expect(view.text()).toBe('shelluser 1');
    history.push('/');
    expect(view.text()).toBe('shellhome');
  });

  it('updates a page on a parameter change instead of re-creating it', () => {
    const history = createMemoryHistory(['/users/1']);
    const setups = vi.fn();
    const User = component(() => {
      setups();
      const params = useRouteParams<{ id: string }>();
      return <p>user {params.value.id}</p>;
    });
    const view = mount(() => (
      <Router routes={[{ path: '/users/:id', component: User }]} history={history} />
    ));
    const paragraph = view.get('p');

    history.push('/users/2');

    expect(view.text()).toBe('user 2');
    // The same element, and the component body ran once.
    expect(view.get('p')).toBe(paragraph);
    expect(setups).toHaveBeenCalledTimes(1);
  });

  it('keeps a shared layout when only the child route changes', () => {
    const history = createMemoryHistory(['/a']);
    const layouts = vi.fn();
    const Shell = component(() => {
      layouts();
      return (
        <main>
          <Outlet />
        </main>
      );
    });
    const routes: RouteDefinition[] = [
      {
        path: '/',
        component: Shell,
        children: [
          { path: 'a', component: Home },
          { path: 'b', component: About },
        ],
      },
    ];
    const view = mount(() => <Router routes={routes} history={history} />);
    const main = view.get('main');

    history.push('/b');

    expect(view.text()).toBe('about');
    expect(view.get('main')).toBe(main);
    expect(layouts).toHaveBeenCalledTimes(1);
  });

  it('creates and disposes its own history when none is given', () => {
    window.history.replaceState(null, '', '/own');
    const view = mount(() => <Router routes={[{ path: '/own', component: Home }]} />);
    expect(view.text()).toBe('home');
    view.unmount();
    // Disposed: a popstate afterwards reaches nothing.
    window.history.replaceState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  it('honours a basename', () => {
    window.history.replaceState(null, '', '/base/inner');
    const view = mount(() => (
      <Router routes={[{ path: '/inner', component: Home }]} basename="/base" />
    ));
    expect(view.text()).toBe('home');
    view.unmount();
    window.history.replaceState(null, '', '/');
  });
});

describe('lazy routes', () => {
  const late = component(() => <h1>late</h1>);

  it('shows the router-level pending view, then the loaded component', async () => {
    const history = createMemoryHistory(['/']);
    const routes: RouteDefinition[] = [
      { path: '/', component: Home },
      { path: '/late', lazy: () => Promise.resolve({ default: late }) },
    ];
    const view = mount(() => (
      <Router routes={routes} history={history} pending={() => <p>loading</p>} />
    ));

    history.push('/late');
    expect(view.text()).toBe('loading');

    await tick();
    expect(view.text()).toBe('late');
  });

  it('prefers a pending view declared on the route', async () => {
    const history = createMemoryHistory(['/slow']);
    const routes: RouteDefinition[] = [
      {
        path: '/slow',
        lazy: () => Promise.resolve(late),
        pending: () => <p>route says wait</p>,
      },
    ];
    const view = mount(() => (
      <Router routes={routes} history={history} pending={() => <p>router says wait</p>} />
    ));

    expect(view.text()).toBe('route says wait');
    await tick();
    expect(view.text()).toBe('late');
  });

  it('renders nothing while loading when no pending view was given', async () => {
    const history = createMemoryHistory(['/bare']);
    const routes: RouteDefinition[] = [{ path: '/bare', lazy: () => Promise.resolve(late) }];
    const view = mount(() => <Router routes={routes} history={history} />);

    expect(view.text()).toBe('');
    await tick();
    expect(view.text()).toBe('late');
  });
});

describe('Link', () => {
  const routes: RouteDefinition[] = [
    {
      path: '/',
      component: component(() => (
        <main>
          <Link to="/about" class="nav">
            about
          </Link>
          <Outlet />
        </main>
      )),
      children: [
        { index: true, component: Home },
        { path: 'about', component: About },
      ],
    },
  ];

  it('renders a real anchor and navigates on a plain click', () => {
    const history = createMemoryHistory(['/']);
    const view = mount(() => <Router routes={routes} history={history} />);
    const anchor = view.get<HTMLAnchorElement>('a');

    expect(anchor.getAttribute('href')).toBe('/about');
    expect(anchor.className).toBe('nav');
    expect(click(anchor)).toBe(false); // default prevented
    expect(history.location.value.pathname).toBe('/about');
    expect(view.text()).toContain('about');
  });

  it('leaves modified clicks and new-window links to the browser', () => {
    const history = createMemoryHistory(['/x']);
    const view = mount(() => (
      <Router
        routes={[
          {
            path: '/x',
            component: component(() => (
              <div>
                <Link to="/plain" id="plain">
                  plain
                </Link>
                <Link to="/blank" target="_blank" id="blank">
                  blank
                </Link>
              </div>
            )),
          },
        ]}
        history={history}
      />
    ));

    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      expect(click(view.get('#plain'), init)).toBe(true);
    }
    expect(click(view.get('#blank'))).toBe(true);
    expect(history.location.value.pathname).toBe('/x');
  });

  it('replaces when asked, and carries state', () => {
    const history = createMemoryHistory(['/a']);
    const view = mount(() => (
      <Router
        routes={[
          {
            path: '/a',
            component: component(() => (
              <Link to="/b" replace state={{ from: 'a' }}>
                b
              </Link>
            )),
          },
          { path: '/b', component: About },
        ]}
        history={history}
      />
    ));

    click(view.get('a'));

    expect(history.location.value.pathname).toBe('/b');
    expect(history.location.value.state).toEqual({ from: 'a' });
    history.go(-1);
    // Replaced, so there is no `/a` left behind it.
    expect(history.location.value.pathname).toBe('/b');
  });

  it('calls its own onClick first, and stops if that prevented the default', () => {
    const history = createMemoryHistory(['/a']);
    const seen = vi.fn((event: MouseEvent) => {
      event.preventDefault();
    });
    const view = mount(() => (
      <Router
        routes={[
          {
            path: '/a',
            component: component(() => (
              <Link to="/b" onClick={seen}>
                b
              </Link>
            )),
          },
        ]}
        history={history}
      />
    ));

    click(view.get('a'));

    expect(seen).toHaveBeenCalledTimes(1);
    expect(history.location.value.pathname).toBe('/a');
  });

  it('resolves a relative target against the current route', () => {
    const history = createMemoryHistory(['/users/7']);
    const view = mount(() => (
      <Router
        routes={[
          {
            path: '/users/:id',
            component: component(() => <Link to="edit">edit</Link>),
          },
        ]}
        history={history}
      />
    ));

    expect(view.get<HTMLAnchorElement>('a').getAttribute('href')).toBe('/users/7/edit');
  });

  it('follows a href that changes reactively', () => {
    const history = createMemoryHistory(['/a']);
    const target = signal('/one');
    const view = mount(() => (
      <Router
        routes={[
          {
            path: '/a',
            component: component(() => <Link to={target.value}>go</Link>),
          },
        ]}
        history={history}
      />
    ));
    const anchor = view.get<HTMLAnchorElement>('a');

    expect(anchor.getAttribute('href')).toBe('/one');
    target.value = '/two';
    expect(anchor.getAttribute('href')).toBe('/two');
  });

  it('preloads the target route on hover and on focus', () => {
    const history = createMemoryHistory(['/a']);
    const loads = vi.fn(() => Promise.resolve(component(() => <p>later</p>)));
    const view = mount(() => (
      <Router
        routes={[
          {
            path: '/a',
            component: component(() => (
              <Link to="/later" preload>
                later
              </Link>
            )),
          },
          { path: '/later', lazy: loads },
        ]}
        history={history}
      />
    ));
    const anchor = view.get('a');

    anchor.dispatchEvent(new Event('pointerenter'));
    anchor.dispatchEvent(new Event('focus'));

    expect(loads).toHaveBeenCalledTimes(1);
  });
});

describe('NavLink', () => {
  const build = (history: History) =>
    mount(() => (
      <Router
        routes={[
          {
            path: '/',
            component: component(() => (
              <nav>
                <NavLink to="/" end id="home">
                  home
                </NavLink>
                <NavLink to="/docs" class="item" id="docs">
                  docs
                </NavLink>
                <NavLink to="/docs" activeClass="on" id="custom">
                  docs
                </NavLink>
                <Outlet />
              </nav>
            )),
            children: [
              { index: true, component: Home },
              { path: 'docs', component: About },
              { path: 'docs/deep', component: About },
            ],
          },
        ]}
        history={history}
      />
    ));

  it('marks the active link, exactly or by prefix', () => {
    const history = createMemoryHistory(['/']);
    const view = build(history);

    expect(view.get('#home').className).toBe('active');
    expect(view.get('#home').getAttribute('aria-current')).toBe('page');
    expect(view.get('#docs').className).toBe('item');

    history.push('/docs/deep');

    // `end` on the home link keeps it inactive on a deeper path.
    expect(view.get('#home').className).toBe('');
    expect(view.get('#home').getAttribute('aria-current')).toBeNull();
    expect(view.get('#docs').className).toBe('item active');
    expect(view.get('#custom').className).toBe('on');
  });
});

describe('Navigate', () => {
  it('redirects once rendered', async () => {
    const history = createMemoryHistory(['/old']);
    const view = mount(() => (
      <Router
        routes={[
          { path: '/old', component: component(() => <Navigate to="/new" />) },
          { path: '/new', component: About },
        ]}
        history={history}
      />
    ));

    await tick();

    expect(history.location.value.pathname).toBe('/new');
    expect(view.text()).toBe('about');
  });

  it('does not redirect if it was disposed first', async () => {
    const history = createMemoryHistory(['/old']);
    const view = mount(() => (
      <Router
        routes={[{ path: '/old', component: component(() => <Navigate to="/new" />) }]}
        history={history}
      />
    ));

    view.unmount();
    await tick();

    expect(history.location.value.pathname).toBe('/old');
  });

  it('pushes instead of replacing when asked', async () => {
    const history = createMemoryHistory(['/old']);
    mount(() => (
      <Router
        routes={[
          { path: '/old', component: component(() => <Navigate to="/new" replace={false} />) },
          { path: '/new', component: About },
        ]}
        history={history}
      />
    ));

    await tick();
    history.go(-1);
    expect(history.location.value.pathname).toBe('/old');
  });
});

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
