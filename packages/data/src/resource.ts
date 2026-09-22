/**
 * Resources and actions: the two things an application does with a server.
 *
 * A resource is one loader, run like an effect. What it reads before its first
 * `await` is what it depends on — a prop, a signal, anything — and changing
 * that runs it again and aborts what was in flight. There is no key, no name
 * and no variables object, because a resource belongs to its call site
 * (ADR-0022).
 */
import {
  createContext,
  effect,
  isRendering,
  onCleanup,
  useContext,
  type Dispose,
} from '@firsthandjs/core';
export { createData } from './store.js';
import {
  createHeld,
  expose,
  fail,
  succeed,
  type ActionContext,
  type DataRequest,
  type DataStore,
  type Held,
  type LoadContext,
  type Resource,
  type Status,
} from './store.js';
import { anyTagMatches, type Tag } from './tags.js';
import { devQuery } from './dev.js';

export const DataContext = createContext<DataStore>();

export function useData(): DataStore {
  return useContext(DataContext).value;
}

/** Invalidates through the store this component is under. */
export function useInvalidate(): (...patterns: Tag[]) => Promise<void> {
  const store = useData();
  return (...patterns) => store.invalidate(...patterns);
}

export type ResourceOptions = {
  /**
   * A name to keep this resource's last value under, between visits.
   *
   * Persistence is the one thing that needs a name, because a name is what
   * survives a reload — a call site does not. It is opt-in for that reason,
   * and two resources sharing a name share what is stored, which is what
   * naming them the same asks for.
   */
  readonly persist?: string;
};

/**
 * Loads something, and keeps it as reactive state.
 *
 * ```tsx
 * const user = useResource(async ({ signal, tags }) => {
 *   tags(tag('user', { id: props.id }));
 *   return (await fetch(`/api/users/${props.id}`, { signal })).json() as Promise<User>;
 * });
 * ```
 *
 * Everything read before the first `await` is a dependency, exactly as in an
 * `effect` — including a token read to build a header. Read it with `peek()`
 * if that is not what you want.
 */
/** What a storage answered, applied — unless the loader got there first. */
function seed<T>(entry: Held<T>, stored: unknown): void {
  if (stored === undefined || entry.data.peek() !== undefined || entry.disposed) {
    return;
  }
  succeed(entry, stored as T);
  // Loading stays true: the loader is on its way, and what is on the screen is
  // the last answer rather than this one.
  entry.loading.value = true;
}

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

export function useResource<T>(
  load: (context: LoadContext) => Promise<T>,
  options: ResourceOptions = {},
): Resource<T> {
  const store = useData();
  const entry = createHeld<T>(store, options.persist);
  const release = store.hold(entry);
  devQuery('created', options.persist ?? '(call site)', []);

  const loading: Loading<T> = { entry, store, persist: options.persist };
  entry.run = (force: boolean): Promise<T | undefined> => runOnce(loading, load, force);

  seedFromStorage(entry, store, options.persist);
  startLoading(entry);

  onCleanup(() => {
    entry.disposed = true;
    entry.controller?.abort();
    devQuery('dropped', options.persist ?? '(call site)', entry.tags);
    release();
  });

  return expose(entry, release);
}

/** One resource, and the two things every step of a run needs beside it. */
type Loading<T> = {
  entry: Held<T>;
  store: DataStore;
  /** The name its last value is kept under, if it has one. */
  persist: string | undefined;
};

/**
 * One run of a resource.
 *
 * Whatever was in flight is aborted first: a run that has been replaced is a
 * run nobody is waiting for.
 */
function runOnce<T>(
  loading: Loading<T>,
  load: (context: LoadContext) => Promise<T>,
  force: boolean,
): Promise<T | undefined> {
  const { entry, store } = loading;
  if (entry.disposed) {
    return Promise.resolve(undefined);
  }
  entry.controller?.abort();
  const controller = new AbortController();
  entry.controller = controller;
  entry.pending = [];
  entry.superseded = false;
  entry.loading.value = true;
  if (entry.data.peek() === undefined) {
    entry.status.value = 'loading';
  }

  const running = load(contextFor(entry, store, controller, force))
    .then(async (value): Promise<T | undefined> => answered(loading, controller, value))
    .catch((error: unknown): undefined => {
      if (controller.signal.aborted || entry.disposed) {
        return undefined;
      }
      entry.controller = null;
      fail(entry, error);
      return undefined;
    });
  // Held so a server render can wait for it. Cleared when it is this run that
  // finished: a run that started another has already replaced it.
  entry.inflight = running;
  // No rejection handler: the chain above ends in a `catch`, so this promise
  // settles with a value or not at all.
  void running.then(() => {
    if (entry.inflight === running) {
      entry.inflight = null;
    }
  });
  return running;
}

/** The run answered, unless it was replaced or dropped while it was out. */
async function answered<T>(
  loading: Loading<T>,
  controller: AbortController,
  value: T,
): Promise<T | undefined> {
  const { entry, store, persist } = loading;
  if (controller.signal.aborted || entry.disposed) {
    return undefined;
  }
  entry.controller = null;
  succeed(entry, value);
  if (!entry.superseded) {
    // A run with these tags has answered: an invalidation about them has been
    // acted on, and is not owed to the next resource that appears. A
    // superseded run has not — its answer predates the invalidation, and the
    // debt is paid by the run that follows.
    store.settled(entry.tags);
  }
  if (persist !== undefined) {
    try {
      store.storage?.write?.(persist, value);
    } catch {
      // Storage never breaks a resource.
    }
  }
  if (entry.superseded) {
    // It was invalidated while it was out. Go again, and this time the tags
    // are known.
    entry.superseded = false;
    return entry.run(true);
  }
  return value;
}

/**
 * Whatever storage already has, shown before anything has been loaded.
 *
 * Read now rather than in a microtask. A storage that answers straight away —
 * the one a server render fills, or one a page was seeded with — then has its
 * answer *during* the render rather than after it, which is what makes the
 * markup carry data at all.
 */
function seedFromStorage<T>(entry: Held<T>, store: DataStore, persist: string | undefined): void {
  const storage = store.storage;
  if (persist === undefined || storage?.read === undefined) {
    return;
  }
  let stored: unknown;
  try {
    // Called on the storage, not lifted off it: an adapter is allowed to be an
    // object with state, and a method taken off one loses it.
    stored = storage.read(persist);
  } catch {
    // A storage that cannot answer is a storage that has nothing.
    stored = undefined;
  }
  if (!isThenable(stored)) {
    seed(entry, stored);
    return;
  }
  void (async (): Promise<void> => {
    try {
      seed(entry, await stored);
    } catch {
      // As above: a rejected read is an empty one.
    }
  })();
}

/**
 * Starts the loader, in whichever way this render allows.
 *
 * A server render has no effects — there is no later for one to run in — but
 * it does have data, and the loader is what produces it. So the run is started
 * directly, once, and `store.settle()` is what waits for it; nothing re-runs
 * it, so there is nothing for tracking to buy. Unless the answer is already in
 * hand: a second pass over a storage the first pass filled has what it came
 * for, and asking again would be one request per pass for the same page.
 */
function startLoading<T>(entry: Held<T>): void {
  if (!isRendering()) {
    // The loader runs inside an effect, so what it reads is what it depends on.
    effect(() => {
      void entry.run(false);
    });
    return;
  }
  if (entry.data.peek() === undefined) {
    void entry.run(false);
  } else {
    entry.loading.value = false;
  }
}

/**
 * What a loader is handed: what to abort with, why it is running, and where to
 * report what it turned out to be about.
 *
 * `force` is a getter because declaring the tags can raise it. A client that
 * declares its tags *before* it reads `force` gets the corrected answer and
 * looks in its cache with it. One that cannot — a loader that only learns what
 * it fetched from the reply — reads `force` first, and by the time `tags()`
 * arrives the cache has already answered; raising the flag then changes
 * nothing, so the run is marked superseded instead.
 */
function contextFor<T>(
  entry: Held<T>,
  store: DataStore,
  controller: AbortController,
  force: boolean,
): LoadContext {
  /** Raised when the run turns out to be about something recently invalidated. */
  let forced = force;
  /** Whether a client has already asked why this is running. */
  let asked = false;

  const declare = (...next: Tag[]): void => {
    // Replaces. A run says what it is about; it does not accumulate what it
    // used to be about.
    entry.tags = next;
    // And the case a resource cannot see for itself: an invalidation that
    // happened while nothing was watching this. The tags are only known now,
    // which is why `force` is read rather than copied — a client asks for it
    // after it has declared them and before it asks its cache.
    if (!forced && store.missed(entry, next)) {
      forced = true;
      // Too late to be honoured: the answer in hand is the one that was
      // invalidated. Nothing else can tell — the cache entry it came from
      // carries no tags, because they did not exist when it was written.
      if (asked) {
        entry.superseded = true;
      }
    }
    // And the race this closes: an invalidation that arrived while this run
    // was in flight could not match tags that did not exist yet.
    if (entry.pending.length > 0 && anyTagMatches(entry.pending, next)) {
      entry.superseded = true;
    }
  };
  const why = (): boolean => {
    asked = true;
    return forced;
  };
  const request: DataRequest = {
    signal: controller.signal,
    get force(): boolean {
      return why();
    },
    // Read after `tags()` by a cache that keeps them, which is every client in
    // this project: they declare first and look in their cache second.
    get declared(): readonly Tag[] {
      return entry.tags;
    },
    tags: declare,
  };
  return {
    signal: controller.signal,
    get force(): boolean {
      return why();
    },
    request,
    tags: declare,
  };
}

export type ObservableLike<T> = {
  subscribe(observer: {
    next?: (value: T) => void;
    error?: (error: unknown) => void;
  }): { unsubscribe: () => void } | (() => void);
};

export type BridgeOptions = {
  /** What `reload()` should do, if the source can do it. */
  readonly reload?: () => Promise<unknown>;
};

/**
 * A source that pushes, as a resource.
 *
 * For the case a per-call-site resource is the wrong shape: the same entity in
 * twenty places, which must stay consistent. A normalising client already
 * solves that, and this makes its observable a cell — one write in its cache,
 * twenty views updated together.
 *
 * The contract is the smallest one every client satisfies: `subscribe` with a
 * `next` and an `error`, returning either an unsubscribe function or something
 * carrying one. Apollo, urql, RxJS and TanStack's `QueryObserver` all do.
 */
export function fromObservable<T>(
  source: ObservableLike<T>,
  options: BridgeOptions = {},
): Resource<T> {
  const store = useData();
  const entry = createHeld<T>(store, undefined);
  const release = store.hold(entry);
  entry.run = () =>
    options.reload === undefined ? Promise.resolve(undefined) : void_(options.reload());
  entry.loading.value = true;
  entry.status.value = 'loading';

  const subscription = source.subscribe({
    // A source that pushes after the scope has gone is pushing into nothing:
    // the cells are still there, but nobody is reading them.
    next: (value) => {
      succeed(entry, value);
    },
    error: (error) => {
      fail(entry, error);
    },
  });
  const stop: Dispose =
    typeof subscription === 'function'
      ? subscription
      : (): void => {
          subscription.unsubscribe();
        };

  onCleanup(() => {
    entry.disposed = true;
    stop();
    release();
  });

  return expose(entry, () => {
    stop();
    release();
  });
}

/** A promise, as a resource. The loader form without tags or dependencies. */
export function fromPromise<T>(factory: () => Promise<T>): Resource<T> {
  return useResource(() => factory());
}

/** Discards a promise's value, keeping its settling. */
async function void_(promise: Promise<unknown>): Promise<undefined> {
  await promise;
  return undefined;
}

export type { LoadContext, ActionContext, Resource, Status };
