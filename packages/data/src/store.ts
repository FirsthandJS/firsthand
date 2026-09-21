/**
 * The store: what is loaded, and when it has to be loaded again.
 *
 * It holds resources, it matches invalidation patterns against their tags, and
 * it knows nothing else. No URL, no method, no body, no client — a loader is
 * an arbitrary function returning a promise, and it may be a `fetch`, an
 * Apollo call, a worker or an algorithm that never leaves the browser
 * (ADR-0022).
 *
 * What it deliberately is not is a cache. A cache is defined by a second
 * lookup for the same thing finding the first one's result, and that requires
 * identity — a key, a name, something two callers agree on. Every form of that
 * is a thing to forget or to collide on, and deriving it implicitly from tags
 * is worse: it silently serves one resource's data to another, which is the
 * measured bug this design exists to remove. A resource belongs to its call
 * site. Deduplication, response caching and normalisation belong to the
 * transport, where the knowledge of what is *the same thing* actually lives.
 */
import { batch, signal, type ReadonlyCell, type Signal } from '@firsthandjs/core';
import { anyTagMatches, type Tag } from './tags.js';
import { devQuery } from './dev.js';

export type Status = 'idle' | 'loading' | 'success' | 'error';

/**
 * What a loader hands to a transport: everything a request needs to be sent
 * once, aborted, and — when it matters — sent *again*.
 *
 * The two travel together because they answer the same question. `signal` ends
 * a request that is no longer wanted; `force` says this run exists *because*
 * something was invalidated, so a transport cache that answers from its own
 * memory would make that invalidation silently pointless. Every client in this
 * project takes this object and honours both.
 */
export interface DataRequest {
  /** Aborted when this run is superseded, or the resource goes away. */
  readonly signal: AbortSignal;
  /**
   * True when this run was caused by an invalidation or by `reload()`.
   *
   * A client must then skip whatever it has cached and replace it with the
   * answer — which is what makes an invalidation reach all the way down.
   */
  readonly force: boolean;
  /**
   * Where a client reports what this request is about, when it knows.
   *
   * A GraphQL document carries its own `@tag` and `@invalidates` directives,
   * so a client can declare them without the call site repeating them. In a
   * resource this is the resource's `tags`; in an action it is the store's
   * `invalidates` — the same hole, filled with whichever of the two the
   * request belongs to. Optional, because a request written by hand may have
   * nothing to say.
   */
  readonly tags?: (...tags: Tag[]) => void;
}

/** What a loader is given. */
export interface LoadContext extends DataRequest {
  /**
   * Declares what this resource is about. **Replaces**: call it before the
   * first `await` when you know, again after it when only the server does, and
   * the last call of a run wins. Name both if you want both.
   */
  readonly tags: (...tags: Tag[]) => void;
  /**
   * The two above as one object, to hand to a client:
   * `api.get<User>('/users/7')(request)`.
   */
  readonly request: DataRequest;
}

/** What an action is given. */
export interface ActionContext {
  readonly signal: AbortSignal;
  /**
   * Declares what this action changed, so resources carrying a matching tag
   * reload. Replaces, like `tags`, and may be called after the answer — which
   * is the case where only the server knows what was touched.
   */
  readonly invalidates: (...tags: Tag[]) => void;
  /**
   * The request to hand to a client. `force` is always true here: an action
   * changes something, so nothing it sends may be answered from a cache.
   */
  readonly request: DataRequest;
}

/** What a client hands back: a request waiting for the context to send it. */
export type Loader<T> = (request: DataRequest) => Promise<T>;

export interface Resource<T> {
  readonly data: ReadonlyCell<T | undefined>;
  readonly error: ReadonlyCell<unknown>;
  readonly status: ReadonlyCell<Status>;
  /** True while a run is in flight, including one behind a visible value. */
  readonly loading: ReadonlyCell<boolean>;
  /** Runs again, with `force`. Never rejects. */
  reload(): Promise<T | undefined>;
  /** Stops this resource and aborts anything in flight. */
  dispose(): void;
}

/** Somewhere to keep results between visits. See {@link DataOptions}. */
export interface Storage {
  /**
   * What was kept under this name, if anything. May return a promise; a value
   * that arrives after the loader has answered is dropped.
   */
  read?(name: string): unknown;
  /** Called after each successful run of a named resource. */
  write?(name: string, data: unknown): void;
  /** Called by `store.clear()`, which is what a sign-out calls. */
  clear?(): void;
}

export interface DataOptions {
  /** Where named resources are kept between visits. */
  readonly storage?: Storage;
}

interface Held<T = unknown> {
  data: Signal<T | undefined>;
  error: Signal<unknown>;
  status: Signal<Status>;
  loading: Signal<boolean>;
  /** What this resource is currently about. Replaced by every run. */
  tags: Tag[];
  controller: AbortController | null;
  /** Patterns seen while the current run is in flight, for the late-tag race. */
  pending: Tag[];
  /** Set when an invalidation matched a run that had not finished. */
  superseded: boolean;
  disposed: boolean;
  name: string | undefined;
  run: (force: boolean) => Promise<T | undefined>;
}

export interface DataStore {
  /** Everything carrying a matching tag runs again, with `force`. */
  invalidate(...patterns: Tag[]): Promise<void>;
  /** Forgets every resource and empties the storage. */
  clear(): void;
  /** How many resources are alive. For tests and devtools. */
  readonly size: number;
  /** Internal: a resource registers itself here. */
  hold(held: Held): () => void;
  /** Internal: the storage this store was given. */
  readonly storage: Storage | undefined;
}

export function createData(options: DataOptions = {}): DataStore {
  const held = new Set<Held>();

  return {
    storage: options.storage,
    hold: (entry) => {
      held.add(entry);
      return () => held.delete(entry);
    },
    invalidate: async (...patterns: Tag[]): Promise<void> => {
      const waiting: Promise<unknown>[] = [];
      for (const entry of [...held]) {
        if (entry.controller !== null) {
          // In flight, and its tags may not be known yet: a loader is allowed
          // to name what it is about only after the server has answered.
          // Remembered here and checked again when it does, so an invalidation
          // sent during the first run is not silently lost.
          entry.pending.push(...patterns);
        }
        if (!anyTagMatches(patterns, entry.tags)) {
          continue;
        }
        // Reported per matched resource rather than per call: an invalidation
        // that hits nothing is indistinguishable from one never sent, and that
        // is the confusion this exists to end.
        devQuery('invalidated', entry.name ?? '(call site)', entry.tags);
        waiting.push(entry.run(true));
      }
      await Promise.all(waiting);
    },
    clear: () => {
      for (const entry of [...held]) {
        entry.controller?.abort();
        held.delete(entry);
      }
      try {
        options.storage?.clear?.();
      } catch {
        // Storage never breaks a caller.
      }
    },
    get size(): number {
      return held.size;
    },
  };
}

/**
 * Runs one resource. Shared by `useResource` and the observable bridges, so
 * that a resource behaves the same however its values arrive.
 */
export function createHeld<T>(store: DataStore, name: string | undefined): Held<T> {
  // `run` is assigned by the caller, which needs the entry to close over. It
  // is required rather than optional because every holder sets it before
  // anything can reach it, and an optional one would be a branch no test
  // could take.
  const entry = {
    data: signal<T | undefined>(undefined),
    error: signal<unknown>(undefined),
    status: signal<Status>('idle'),
    loading: signal(false),
    tags: [],
    controller: null,
    pending: [],
    superseded: false,
    disposed: false,
    name,
  } as unknown as Held<T>;
  return entry;
}

/** Settles a successful run. Exported for the bridges, which have no loader. */
export function succeed<T>(entry: Held<T>, value: T): void {
  batch(() => {
    entry.data.value = value;
    entry.error.value = undefined;
    entry.status.value = 'success';
    entry.loading.value = false;
  });
}

/** Settles a failed run. */
export function fail(entry: Held, error: unknown): void {
  batch(() => {
    entry.error.value = error;
    entry.status.value = 'error';
    entry.loading.value = false;
  });
}

/** The public face of a held resource. */
export function expose<T>(entry: Held<T>, release: () => void): Resource<T> {
  return {
    data: entry.data,
    error: entry.error,
    status: entry.status,
    loading: entry.loading,
    reload: () => entry.run(true),
    dispose: () => {
      entry.disposed = true;
      entry.controller?.abort();
      release();
    },
  };
}

export type { Held };
