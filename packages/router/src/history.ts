/**
 * History adapters.
 *
 * Three, with the same interface: the browser's own history, a hash-based one
 * for static hosts, and an in-memory one for tests and for rendering outside a
 * browser. The location is a signal, so everything downstream — matching, the
 * active class on a link, a component reading a parameter — is an ordinary
 * reactive read rather than a subscription the application has to manage.
 */
import { signal, type ReadonlyCell } from '@firsthandjs/core';

export type Location = {
  readonly pathname: string;
  /** Including the leading `?`, or empty. */
  readonly search: string;
  /** Including the leading `#`, or empty. */
  readonly hash: string;
  /** Whatever was passed to `push`/`replace`. */
  readonly state: unknown;
  /** Changes on every navigation, including to the same URL. */
  readonly key: string;
};

export type NavigateOptions = {
  readonly replace?: boolean;
  readonly state?: unknown;
};

export type History = {
  readonly location: ReadonlyCell<Location>;
  push(to: string, options?: NavigateOptions): void;
  replace(to: string, options?: NavigateOptions): void;
  go(delta: number): void;
  /** Turns a router path into something an `href` can use. */
  href(to: string): string;
  /** Stops listening. Returns nothing; calling it twice is harmless. */
  dispose(): void;
};

let keyCounter = 0;
const nextKey = (): string => `k${String(++keyCounter)}`;

/** Splits a URL-ish string into its three parts. */
export function parsePath(to: string): Omit<Location, 'state' | 'key'> {
  const hashAt = to.indexOf('#');
  const hash = hashAt === -1 ? '' : to.slice(hashAt);
  const withoutHash = hashAt === -1 ? to : to.slice(0, hashAt);
  const searchAt = withoutHash.indexOf('?');
  const search = searchAt === -1 ? '' : withoutHash.slice(searchAt);
  const pathname = searchAt === -1 ? withoutHash : withoutHash.slice(0, searchAt);
  return { pathname: pathname === '' ? '/' : pathname, search, hash };
}

function locationFrom(to: string, state: unknown): Location {
  return { ...parsePath(to), state, key: nextKey() };
}

/**
 * The browser's history: real URLs, real back button.
 *
 * `basename` lets an application live under a sub-path without every route
 * knowing about it.
 */
export function createBrowserHistory(basename = ''): History {
  const base = basename.endsWith('/') ? basename.slice(0, -1) : basename;
  const strip = (pathname: string): string =>
    base !== '' && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname;

  const read = (): Location => ({
    pathname: strip(window.location.pathname),
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state,
    key: nextKey(),
  });

  const current = signal<Location>(read());
  const onPopState = (): void => {
    current.value = read();
  };
  window.addEventListener('popstate', onPopState);

  const href = (to: string): string => `${base}${to.startsWith('/') ? to : `/${to}`}`;

  const navigate = (to: string, options: NavigateOptions | undefined, replace: boolean): void => {
    const state = options?.state ?? null;
    window.history[replace ? 'replaceState' : 'pushState'](state, '', href(to));
    current.value = locationFrom(to, state);
  };

  return {
    location: current,
    push: (to, options) => {
      navigate(to, options, options?.replace === true);
    },
    replace: (to, options) => {
      navigate(to, options, true);
    },
    go: (delta) => {
      window.history.go(delta);
    },
    href,
    dispose: () => {
      window.removeEventListener('popstate', onPopState);
    },
  };
}

/** Hash routing, for hosts that cannot rewrite every path to one document. */
export function createHashHistory(): History {
  const read = (): Location => ({
    ...parsePath(window.location.hash.slice(1) || '/'),
    state: null,
    key: nextKey(),
  });

  const current = signal<Location>(read());
  const onHashChange = (): void => {
    current.value = read();
  };
  window.addEventListener('hashchange', onHashChange);

  const href = (to: string): string => `#${to.startsWith('/') ? to : `/${to}`}`;

  return {
    location: current,
    push: (to, options) => {
      if (options?.replace === true) {
        window.location.replace(href(to));
      } else {
        window.location.hash = href(to).slice(1);
      }
      current.value = { ...parsePath(to), state: options?.state ?? null, key: nextKey() };
    },
    replace: (to, options) => {
      window.location.replace(href(to));
      current.value = { ...parsePath(to), state: options?.state ?? null, key: nextKey() };
    },
    go: (delta) => {
      window.history.go(delta);
    },
    href,
    dispose: () => {
      window.removeEventListener('hashchange', onHashChange);
    },
  };
}

/**
 * An in-memory history.
 *
 * What tests should use, and what a server would use: no `window`, and the
 * entry stack is inspectable.
 */
export function createMemoryHistory(initial: readonly string[] = ['/']): History {
  const entries: Location[] = initial.map((entry) => locationFrom(entry, null));
  let index = entries.length - 1;
  const current = signal<Location>(entries[index] as Location);

  return {
    location: current,
    push: (to, options) => {
      const next = locationFrom(to, options?.state ?? null);
      if (options?.replace === true) {
        entries[index] = next;
      } else {
        entries.length = index + 1;
        entries.push(next);
        index++;
      }
      current.value = next;
    },
    replace: (to, options) => {
      const next = locationFrom(to, options?.state ?? null);
      entries[index] = next;
      current.value = next;
    },
    go: (delta) => {
      const target = Math.min(Math.max(index + delta, 0), entries.length - 1);
      index = target;
      current.value = entries[target] as Location;
    },
    href: (to) => to,
    dispose: () => undefined,
  };
}
