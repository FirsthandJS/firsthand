/**
 * The three components that navigate: Link, NavLink and Navigate.
 *
 * The Router itself and its lazy routes are in `router.test.tsx`; what a
 * matched route hands its component is in `router-hooks.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component, signal } from '@firsthandjs/dom';
import { cleanup, mount, tick } from '@firsthandjs/testing';
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Router,
  createMemoryHistory,
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
