/**
 * Path matching, ranking and the history adapters.
 */
import { describe, expect, it } from 'vitest';
import {
  compilePattern,
  matchPattern,
  normalizePath,
  segments,
  matchRoutes,
  preloadRoutes,
  routeComponent,
  createBrowserHistory,
  createHashHistory,
  createMemoryHistory,
  parsePath,
  type RouteDefinition,
} from '@firsthandjs/router';

const node = (text: string) => (): Text => document.createTextNode(text);

describe('patterns', () => {
  it('matches static segments case-insensitively', () => {
    const pattern = compilePattern('/users/list', true);
    expect(matchPattern(pattern, '/users/list')?.params).toEqual({});
    expect(matchPattern(pattern, '/Users/List')?.params).toEqual({});
    expect(matchPattern(pattern, '/users')).toBeNull();
  });

  it('tolerates a trailing slash', () => {
    expect(matchPattern(compilePattern('/a', true), '/a/')).not.toBeNull();
  });

  it('captures parameters and decodes them', () => {
    const found = matchPattern(compilePattern('/users/:id', true), '/users/a%20b');
    expect(found?.params).toEqual({ id: 'a b' });
  });

  it('treats a trailing `?` as an optional segment', () => {
    const pattern = compilePattern('/users/:id?', true);
    expect(matchPattern(pattern, '/users')?.params).toEqual({});
    expect(matchPattern(pattern, '/users/7')?.params).toEqual({ id: '7' });
  });

  it('captures the rest of the path as `*`', () => {
    const pattern = compilePattern('/files/*', true);
    expect(matchPattern(pattern, '/files/a/b/c')?.params).toEqual({ '*': 'a/b/c' });
    expect(matchPattern(pattern, '/files')?.params).toEqual({});
  });

  it('escapes regex metacharacters in static segments', () => {
    const pattern = compilePattern('/a.b', true);
    expect(matchPattern(pattern, '/a.b')).not.toBeNull();
    expect(matchPattern(pattern, '/axb')).toBeNull();
  });

  it('matches a prefix when it is not the last level', () => {
    const pattern = compilePattern('/users', false);
    expect(matchPattern(pattern, '/users/1')?.consumed).toBe('/users');
    // Only on a segment boundary: `/usersearch` is a different route.
    expect(matchPattern(pattern, '/usersearch')).toBeNull();
  });

  it('ranks static above dynamic above optional above splat', () => {
    const score = (path: string): number => compilePattern(path, true).score;
    expect(score('/users/new')).toBeGreaterThan(score('/users/:id'));
    expect(score('/users/:id')).toBeGreaterThan(score('/users/:id?'));
    expect(score('/users/:id?')).toBeGreaterThan(score('/users/*'));
  });

  it('splits and normalises paths', () => {
    expect(segments('//a//b/')).toEqual(['a', 'b']);
    expect(normalizePath('/a/b/')).toBe('/a/b');
  });
});

describe('matchRoutes', () => {
  const routes: RouteDefinition[] = [
    {
      path: '/',
      component: node('shell'),
      children: [
        { index: true, component: node('home') },
        { path: 'users/:id', component: node('user') },
        { path: 'users/new', component: node('new') },
        { path: 'files/*', component: node('files') },
      ],
    },
    { path: '/login', component: node('login') },
  ];

  it('returns the chain from the root to the leaf', () => {
    const found = matchRoutes(routes, '/users/7');
    expect(found?.map((match) => match.pathname)).toEqual(['/', '/users/7']);
    expect(found?.[1]?.params).toEqual({ id: '7' });
  });

  it('prefers the more specific route whatever the array order', () => {
    // `users/new` is declared *after* `users/:id` and still wins.
    expect(matchRoutes(routes, '/users/new')?.[1]?.route).toBe(routes[0]?.children?.[2]);
  });

  it('matches an index route at the parent path', () => {
    const found = matchRoutes(routes, '/');
    expect(found).toHaveLength(2);
    expect(found?.[1]?.pathname).toBe('/');
  });

  it('matches a sibling at the root', () => {
    expect(matchRoutes(routes, '/login')).toHaveLength(1);
  });

  it('returns null when nothing matches', () => {
    expect(matchRoutes(routes, '/nope')).toBeNull();
  });

  it('treats an empty pathname as the root', () => {
    expect(matchRoutes(routes, '')).toHaveLength(2);
  });

  it('matches a layout route on its own, and prefers the deeper branch', () => {
    const only: RouteDefinition[] = [
      { path: 'a', component: node('a'), children: [{ path: 'b', component: node('b') }] },
    ];
    // `/a` renders the layout with an empty outlet; `/a/b` renders both.
    expect(matchRoutes(only, '/a')).toHaveLength(1);
    expect(matchRoutes(only, '/a/b')).toHaveLength(2);
    expect(matchRoutes(only, '/a/c')).toBeNull();
  });

  it('prefers an index child over the layout it belongs to', () => {
    const index = { index: true, component: node('index') } as const;
    const only: RouteDefinition[] = [{ path: 'a', component: node('a'), children: [index] }];
    expect(matchRoutes(only, '/a')?.[1]?.route).toBe(index);
  });

  it('ignores an empty children array', () => {
    expect(matchRoutes([{ path: 'a', component: node('a'), children: [] }], '/a')).toHaveLength(1);
  });

  it('reuses the compiled tree for the same routes array', () => {
    const first = matchRoutes(routes, '/login');
    const second = matchRoutes(routes, '/login');
    expect(first?.[0]?.route).toBe(second?.[0]?.route);
  });

  it('matches a route declared without a path at all', () => {
    const layout: RouteDefinition[] = [
      { component: node('layout'), children: [{ path: 'only', component: node('only') }] },
    ];
    expect(matchRoutes(layout, '/only')).toHaveLength(2);
  });
});

describe('lazy routes', () => {
  it('loads once and caches the result', async () => {
    let calls = 0;
    const route: RouteDefinition = {
      path: '/late',
      lazy: () => {
        calls++;
        return Promise.resolve({ default: node('late') });
      },
    };
    expect(routeComponent(route)).toBeUndefined();
    expect(routeComponent(route)).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    expect(routeComponent(route)).not.toBeUndefined();
    expect(calls).toBe(1);
  });

  it('accepts a module that is the component itself', async () => {
    const bare = node('bare');
    const route: RouteDefinition = { path: '/bare', lazy: () => Promise.resolve(bare) };
    routeComponent(route);
    await Promise.resolve();
    await Promise.resolve();
    expect(routeComponent(route)).toBe(bare);
  });

  it('preloads exactly the lazy routes on the way to a path', () => {
    let loaded = 0;
    const routes: RouteDefinition[] = [
      {
        path: '/',
        component: node('shell'),
        children: [
          {
            path: 'deep',
            lazy: () => {
              loaded++;
              return Promise.resolve(node('deep'));
            },
          },
        ],
      },
    ];
    preloadRoutes(routes, '/deep');
    expect(loaded).toBe(1);
    preloadRoutes(routes, '/deep');
    expect(loaded).toBe(1);
    preloadRoutes(routes, '/missing');
    expect(loaded).toBe(1);
  });
});

describe('parsePath', () => {
  it('splits pathname, search and hash', () => {
    expect(parsePath('/a?b=1#c')).toEqual({ pathname: '/a', search: '?b=1', hash: '#c' });
    expect(parsePath('/a#c')).toEqual({ pathname: '/a', search: '', hash: '#c' });
    expect(parsePath('/a?b=1')).toEqual({ pathname: '/a', search: '?b=1', hash: '' });
    expect(parsePath('?b=1')).toEqual({ pathname: '/', search: '?b=1', hash: '' });
  });
});

describe('memory history', () => {
  it('starts at the last initial entry', () => {
    const history = createMemoryHistory(['/a', '/b']);
    expect(history.location.value.pathname).toBe('/b');
    expect(history.href('/x')).toBe('/x');
    history.dispose();
  });

  it('pushes, replaces and goes back', () => {
    const history = createMemoryHistory();
    history.push('/a');
    history.push('/b', { state: { n: 1 } });
    expect(history.location.value.state).toEqual({ n: 1 });
    history.go(-1);
    expect(history.location.value.pathname).toBe('/a');
    history.go(-99);
    expect(history.location.value.pathname).toBe('/');
    history.go(99);
    expect(history.location.value.pathname).toBe('/b');
    history.replace('/c');
    expect(history.location.value.pathname).toBe('/c');
  });

  it('truncates forward entries on a push, and honours replace as an option', () => {
    const history = createMemoryHistory(['/a', '/b', '/c']);
    history.go(-2);
    history.push('/d');
    history.go(99);
    expect(history.location.value.pathname).toBe('/d');
    history.push('/e', { replace: true });
    expect(history.location.value.pathname).toBe('/e');
    history.go(-1);
    expect(history.location.value.pathname).toBe('/a');
  });

  it('gives every navigation a distinct key, even to the same path', () => {
    const history = createMemoryHistory();
    history.push('/same');
    const first = history.location.value.key;
    history.push('/same');
    expect(history.location.value.key).not.toBe(first);
  });
});

describe('browser history', () => {
  it('reflects pushes in the URL and in the signal', () => {
    const history = createBrowserHistory();
    history.push('/pushed?q=1');
    expect(window.location.pathname).toBe('/pushed');
    expect(history.location.value.pathname).toBe('/pushed');
    expect(history.location.value.search).toBe('?q=1');
    history.replace('/replaced', { state: { a: 1 } });
    expect(window.location.pathname).toBe('/replaced');
    expect(history.location.value.state).toEqual({ a: 1 });
    history.dispose();
  });

  it('pushes with the replace option', () => {
    const history = createBrowserHistory();
    history.push('/first');
    history.push('/second', { replace: true });
    expect(window.location.pathname).toBe('/second');
    history.dispose();
  });

  it('follows the back button', () => {
    const history = createBrowserHistory();
    history.push('/one');
    history.push('/two');
    window.history.back();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(history.location.value.pathname).toBe(window.location.pathname);
    history.dispose();
  });

  it('strips and re-adds a basename', () => {
    window.history.replaceState(null, '', '/app/inside');
    const history = createBrowserHistory('/app/');
    expect(history.location.value.pathname).toBe('/inside');
    expect(history.href('deeper')).toBe('/app/deeper');
    history.push('/moved');
    expect(window.location.pathname).toBe('/app/moved');
    expect(history.location.value.pathname).toBe('/moved');
    history.dispose();
    window.history.replaceState(null, '', '/');
  });

  it('keeps a pathname that does not start with the basename', () => {
    window.history.replaceState(null, '', '/elsewhere');
    const history = createBrowserHistory('/app');
    expect(history.location.value.pathname).toBe('/elsewhere');
    history.dispose();
    window.history.replaceState(null, '', '/');
  });

  /**
   * A basename is a path segment, not a string prefix.
   *
   * `/app` and `/apple` share four characters and nothing else, so stripping
   * by length turned `/apple/pie` into `le/pie` — a path no route matches,
   * arrived at from a URL that has nothing to do with the application. The
   * only pathnames under `/app` are `/app` itself and whatever follows
   * `/app/`.
   */
  it('does not strip a basename that is only a prefix of the first segment', () => {
    window.history.replaceState(null, '', '/apple/pie');
    const history = createBrowserHistory('/app');
    expect(history.location.value.pathname).toBe('/apple/pie');
    history.dispose();
    window.history.replaceState(null, '', '/');
  });

  it('maps the basename root back to a slash', () => {
    window.history.replaceState(null, '', '/app');
    const history = createBrowserHistory('/app');
    expect(history.location.value.pathname).toBe('/');
    history.dispose();
    window.history.replaceState(null, '', '/');
  });

  it('delegates `go` to the browser', () => {
    const history = createBrowserHistory();
    history.push('/first');
    history.push('/second');
    history.go(-1);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(history.location.value.pathname).toBe('/first');
    history.dispose();
  });

  it('stops listening once disposed', () => {
    const history = createBrowserHistory();
    history.push('/live');
    history.dispose();
    window.history.replaceState(null, '', '/changed-elsewhere');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(history.location.value.pathname).toBe('/live');
    window.history.replaceState(null, '', '/');
  });
});

describe('hash history', () => {
  it('reads and writes the fragment', () => {
    window.location.hash = '#/start';
    const history = createHashHistory();
    expect(history.location.value.pathname).toBe('/start');
    expect(history.href('next')).toBe('#/next');
    history.push('/pushed');
    expect(window.location.hash).toBe('#/pushed');
    expect(history.location.value.pathname).toBe('/pushed');
    history.dispose();
  });

  it('defaults to the root when there is no fragment', () => {
    window.location.hash = '';
    const history = createHashHistory();
    expect(history.location.value.pathname).toBe('/');
    history.dispose();
  });

  it('replaces without adding an entry', () => {
    window.location.hash = '#/a';
    const history = createHashHistory();
    history.replace('/b', { state: 1 });
    expect(history.location.value.pathname).toBe('/b');
    expect(history.location.value.state).toBe(1);
    history.push('/c', { replace: true });
    expect(history.location.value.pathname).toBe('/c');
    history.replace('/d');
    expect(history.location.value.state).toBeNull();
    history.push('/e');
    expect(history.location.value.state).toBeNull();
    history.dispose();
  });

  /**
   * One navigation, one update.
   *
   * `push` writes `window.location.hash` and sets the location itself. A real
   * browser then fires `hashchange` for the write, and the handler set it a
   * second time — so every navigation arrived twice, with two different keys.
   * Anything watching the location ran twice for one navigation: a route
   * matched twice, an effect on `location.key` fired twice, a page view was
   * counted twice.
   *
   * jsdom does not fire `hashchange` by itself, which is why this went
   * unnoticed: every test here dispatches the event by hand, and none of them
   * dispatched it after a `push`.
   */
  it('does not report a navigation twice when the browser echoes it', () => {
    window.location.hash = '#/one';
    const history = createHashHistory();
    const keys: string[] = [];
    let last = history.location.value.key;

    history.push('/two');
    keys.push(history.location.value.key);
    // What the browser does next, for the write `push` just made.
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(history.location.value.pathname).toBe('/two');
    expect(history.location.value.key).toBe(keys[0]);
    expect(history.location.value.key).not.toBe(last);

    // A hashchange the application did not cause is still a navigation.
    last = history.location.value.key;
    window.location.hash = '#/three';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(history.location.value.pathname).toBe('/three');
    expect(history.location.value.key).not.toBe(last);
    history.dispose();
    window.location.hash = '';
  });

  it('follows a hashchange, and stops once disposed', () => {
    window.location.hash = '#/one';
    const history = createHashHistory();
    window.location.hash = '#/two';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(history.location.value.pathname).toBe('/two');
    history.dispose();
    window.location.hash = '#/three';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(history.location.value.pathname).toBe('/two');
    history.go(-1);
    window.location.hash = '';
  });
});
