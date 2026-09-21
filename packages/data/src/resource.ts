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
  onCleanup,
  untrack,
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

export interface ResourceOptions {
  /**
   * A name to keep this resource's last value under, between visits.
   *
   * Persistence is the one thing that needs a name, because a name is what
   * survives a reload — a call site does not. It is opt-in for that reason,
   * and two resources sharing a name share what is stored, which is what
   * naming them the same asks for.
   */
  readonly persist?: string;
}

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
export function useResource<T>(
  load: (context: LoadContext) => Promise<T>,
  options: ResourceOptions = {},
): Resource<T> {
  const store = useData();
  const entry = createHeld<T>(store, options.persist);
  const release = store.hold(entry);
  devQuery('created', options.persist ?? '(call site)', []);

  entry.run = (force: boolean): Promise<T | undefined> => {
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

    const declare = (...next: Tag[]): void => {
      // Replaces. A run says what it is about; it does not accumulate what
      // it used to be about.
      entry.tags = next;
      // And the race this closes: an invalidation that arrived while this
      // run was in flight could not match tags that did not exist yet.
      if (entry.pending.length > 0 && anyTagMatches(entry.pending, next)) {
        entry.superseded = true;
      }
    };
    // The request a client is handed: what to abort with, why it is running,
    // and where to report what it turned out to be about.
    const request: DataRequest = { signal: controller.signal, force, tags: declare };
    const context: LoadContext = { ...request, request, tags: declare };

    return load(context)
      .then(async (value): Promise<T | undefined> => {
        if (controller.signal.aborted || entry.disposed) {
          return undefined;
        }
        entry.controller = null;
        succeed(entry, value);
        if (options.persist !== undefined) {
          try {
            store.storage?.write?.(options.persist, value);
          } catch {
            // Storage never breaks a resource.
          }
        }
        if (entry.superseded) {
          // It was invalidated while it was out. Go again, and this time the
          // tags are known.
          entry.superseded = false;
          return entry.run(true);
        }
        return value;
      })
      .catch((error: unknown): undefined => {
        if (controller.signal.aborted || entry.disposed) {
          return undefined;
        }
        entry.controller = null;
        fail(entry, error);
        return undefined;
      });
  };

  // Shown before anything has been loaded, when there is something to show.
  const persist = options.persist;
  const storage = store.storage;
  if (persist !== undefined && storage?.read !== undefined) {
    void (async (): Promise<void> => {
      try {
        // Called on the storage, not lifted off it: an adapter is allowed to
        // be an object with state, and a method taken off one loses it.
        const stored: unknown = await storage.read?.(persist);
        if (stored !== undefined && entry.data.peek() === undefined && !entry.disposed) {
          succeed(entry, stored as T);
          // Loading stays true: the loader is on its way, and what is on the
          // screen is the last answer rather than this one.
          entry.loading.value = true;
        }
      } catch {
        // A storage that cannot answer is a storage that has nothing.
      }
    })();
  }

  // The loader runs inside an effect, so what it reads is what it depends on.
  effect(() => {
    void entry.run(false);
  });

  onCleanup(() => {
    entry.disposed = true;
    entry.controller?.abort();
    devQuery('dropped', options.persist ?? '(call site)', entry.tags);
    release();
  });

  return expose(entry, release);
}

export interface Action<I, R> {
  readonly data: Resource<R>['data'];
  readonly error: Resource<R>['error'];
  readonly status: Resource<R>['status'];
  readonly running: Resource<R>['loading'];
  /** Runs it. Never rejects: failure is reported through `error`. */
  run(input: I): Promise<R | undefined>;
}

/**
 * Changes something, and says what it changed.
 *
 * ```tsx
 * const rename = useAction(async (input: Rename, { signal, invalidates }) => {
 *   const changed = await patch(input, signal);
 *   invalidates(...changed.tags); // the server knows which user that was
 *   return changed.user;
 * });
 * ```
 */
export function useAction<I, R>(
  run: (input: I, context: ActionContext) => Promise<R>,
): Action<I, R> {
  const store = useData();
  const entry = createHeld<R>(store, undefined);
  let controller: AbortController | null = null;

  onCleanup(() => {
    entry.disposed = true;
    controller?.abort();
  });

  return {
    data: entry.data,
    error: entry.error,
    status: entry.status,
    running: entry.loading,
    run: async (input: I): Promise<R | undefined> => {
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      let invalidating: Tag[] = [];
      entry.loading.value = true;
      entry.status.value = 'loading';

      try {
        // Untracked: an action runs from an event handler, and what it reads
        // on the way is nobody's dependency.
        const invalidates = (...tags: Tag[]): void => {
          invalidating = tags;
        };
        const result = await untrack(() =>
          run(input, {
            signal: current.signal,
            invalidates,
            // An action changes something, so nothing it sends may be answered
            // out of a cache: `force` is not a choice here. `tags` is the
            // store's invalidation, so a client that knows what a mutation
            // changed — a document with `@invalidates` — reports it without
            // the call site repeating it.
            request: { signal: current.signal, force: true, tags: invalidates },
          }),
        );
        if (current.signal.aborted || entry.disposed) {
          return undefined;
        }
        succeed(entry, result);
        if (invalidating.length > 0) {
          await store.invalidate(...invalidating);
        }
        return result;
      } catch (error: unknown) {
        if (current.signal.aborted || entry.disposed) {
          return undefined;
        }
        fail(entry, error);
        return undefined;
      }
    },
  };
}

export interface ObservableLike<T> {
  subscribe(observer: {
    next?: (value: T) => void;
    error?: (error: unknown) => void;
  }): { unsubscribe: () => void } | (() => void);
}

export interface BridgeOptions {
  /** What `reload()` should do, if the source can do it. */
  readonly reload?: () => Promise<unknown>;
}

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
