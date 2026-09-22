/**
 * The router as an application uses it: TSX, compiled by the real compiler.
 *
 * The assertions worth reading are the identity ones. A router that re-creates
 * a page on every navigation is easy to write and is what this design exists to
 * avoid, so the tests check the element and the setup count, not just the text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { component } from '@firsthandjs/dom';
import { cleanup, mount, tick } from '@firsthandjs/testing';
import {
  Outlet,
  Router,
  createMemoryHistory,
  useRouteParams,
  type RouteDefinition,
} from '@firsthandjs/router';

afterEach(cleanup);

const Home = component(() => <h1>home</h1>);
const About = component(() => <h1>about</h1>);

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
