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
export type DataRequest = {
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
   * True when this request is part of an action: it changes something.
   *
   * Nothing an action sends touches the cache — not read from it, which
   * `force` already prevents, and **not written to it**. A cache holds
   * representations, and what an action gets back is the answer to *doing*
   * something: a mutation result, a receipt, a recalculated report. Storing it
   * under the URL it was sent to means a later read is served an answer that
   * was never a representation of anything, and nothing looks wrong on the way
   * there.
   *
   * It is separate from `force` because the two say different things. `force`
   * is "do not answer me from memory"; this is "do not remember me".
   */
  readonly mutating?: boolean;
  /**
   * What this request has been said to be about, if anything.
   *
   * A cache may keep it beside the entry — as metadata, never as the key —
   * so that an invalidation can throw the entry away instead of waiting for
   * somebody to ask for it again. Identity stays what it was: the scope and
   * the request (ADR-0022, ADR-0025).
   */
  readonly declared?: readonly Tag[];
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
};

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
export type ActionContext = {
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
};

/** What a client hands back: a request waiting for the context to send it. */
export type Loader<T> = (request: DataRequest) => Promise<T>;

export type Resource<T> = {
  readonly data: ReadonlyCell<T | undefined>;
  readonly error: ReadonlyCell<unknown>;
  readonly status: ReadonlyCell<Status>;
  /** True while a run is in flight, including one behind a visible value. */
  readonly loading: ReadonlyCell<boolean>;
  /** Runs again, with `force`. Never rejects. */
  reload(): Promise<T | undefined>;
  /** Stops this resource and aborts anything in flight. */
  dispose(): void;
};

/** Somewhere to keep results between visits. See {@link DataOptions}. */
export type Storage = {
  /**
   * What was kept under this name, if anything. May return a promise; a value
   * that arrives after the loader has answered is dropped.
   */
  read?(name: string): unknown;
  /** Called after each successful run of a named resource. */
  write?(name: string, data: unknown): void;
  /** Called by `store.clear()`, which is what a sign-out calls. */
  clear?(): void;
};

export type DataOptions = {
  /** Where named resources are kept between visits. */
  readonly storage?: Storage;
  /**
   * Caches to empty when something is invalidated.
   *
   * A cache given here is told which tags were invalidated, and drops the
   * entries whose requests said they were about them — so a list nobody is
   * watching does not keep a stale answer for anybody who walks back to it.
   * The tags are metadata on the entry; identity is still the scope and the
   * request (ADR-0025).
   *
   * A cache that is *not* given here is not touched, which is the right
   * default for somebody else's: Apollo's and urql's caches are theirs, and
   * `force` is how a run reaches past them.
   */
  readonly caches?: readonly Forgetful[];
  /**
   * How long an invalidation is remembered for resources that did not exist
   * when it happened, in ms. Default 60 000; `0` switches it off.
   *
   * An invalidation reaches every resource that is **alive**. Nothing is
   * watching a list while you are two pages away from it, so a mutation there
   * reaches nothing — and walking back creates a *new* resource, which asks
   * the transport, which may still be holding the answer from before.
   *
   * So the store remembers what was invalidated and when. A resource whose
   * first run declares a tag that was invalidated since it was created runs
   * with `force`, which is what makes it reach past a cache exactly once. The
   * window exists because the memory is about a cache's contents, and a cache
   * entry does not live for ever; a minute is longer than any sensible `ttl`
   * and short enough to be forgotten.
   */
  readonly remember?: number;
};

/**
 * The part of a cache a store touches: what to forget, and nothing else.
 *
 * Declared structurally so that the store depends on no cache in particular —
 * ours satisfies it, and so does thirty lines of somebody's own.
 */
export type Forgetful = {
  forgetTagged(patterns: readonly Tag[]): void;
};

/** What was invalidated, and when. See {@link DataOptions.remember}. */
type Recent = {
  readonly patterns: readonly Tag[];
  readonly at: number;
};

type Held<T = unknown> = {
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
  /** When this resource last carried an answer. 0 until it has one. */
  answeredAt: number;
  /** The run that is out, while there is one. What `settle` waits for. */
  inflight: Promise<unknown> | null;
  run: (force: boolean) => Promise<T | undefined>;
};

export type DataStore = {
  /** Everything carrying a matching tag runs again, with `force`. */
  invalidate(...patterns: Tag[]): Promise<void>;
  /** Forgets every resource and empties the storage. */
  clear(): void;
  /**
   * Resolves once nothing is loading.
   *
   * What a server render waits on: the view is rendered, this is awaited, and
   * the view is rendered again with the answers in hand. A run that starts
   * another — a resource invalidated while it was out — is waited for too, up
   * to `passes`; past that the render goes ahead with whatever is there
   * rather than never returning.
   */
  settle(passes?: number): Promise<void>;
  /** How many resources are alive. For tests and devtools. */
  readonly size: number;
  /** Internal: a resource registers itself here. */
  hold(held: Held): () => void;
  /**
   * Internal: whether an invalidation that this resource missed applies to the
   * tags it has just declared.
   */
  missed(entry: Held, tags: readonly Tag[]): boolean;
  /**
   * Internal: a run carrying these tags has answered, so an invalidation about
   * them has been acted on and is no longer owed to anybody.
   */
  settled(tags: readonly Tag[]): void;
  /** Internal: the storage this store was given. */
  readonly storage: Storage | undefined;
};

export function createData(options: DataOptions = {}): DataStore {
  const held = new Set<Held>();
  const remember = options.remember ?? 60_000;
  /** Invalidations young enough to matter to a resource that did not see them. */
  let recent: Recent[] = [];

  const now = (): number => Date.now();

  return {
    storage: options.storage,
    missed: (entry, tags) => {
      if (remember === 0 || recent.length === 0) {
        return false;
      }
      const since = now() - remember;
      recent = recent.filter((one) => one.at >= since);
      return recent.some(
        // Younger than this resource's last answer, and about what it has just
        // said it is about. A resource that has answered *since* the
        // invalidation has already taken it into account.
        (one) => one.at > entry.answeredAt && anyTagMatches(one.patterns, tags),
      );
    },
    settled: (tags) => {
      if (recent.length === 0) {
        return;
      }
      // Somebody has been to the server about this. Whatever a transport is
      // holding for those tags is that answer, so the debt is paid — and
      // keeping it would force every resource created in the next minute.
      recent = recent.filter((one) => !anyTagMatches(one.patterns, tags));
    },
    settle: async (passes = 10): Promise<void> => {
      for (let pass = 0; pass < passes; pass++) {
        const waiting: Promise<unknown>[] = [];
        for (const entry of held) {
          if (entry.inflight !== null) {
            waiting.push(entry.inflight);
          }
        }
        if (waiting.length === 0) {
          return;
        }
        await Promise.all(waiting);
      }
    },
    hold: (entry) => {
      held.add(entry);
      return () => held.delete(entry);
    },
    invalidate: async (...patterns: Tag[]): Promise<void> => {
      const waiting: Promise<unknown>[] = [];
      // Thrown out of the caches that were handed over, so an answer that is
      // now wrong is not waiting for whoever asks next. This is the precise
      // half of the fix; `recent` below is the half that also reaches a cache
      // we were not given.
      for (const cache of options.caches ?? []) {
        cache.forgetTagged(patterns);
      }
      if (remember > 0) {
        // Kept for the resources that are not here yet: a list two pages away
        // is nobody's subscriber, and it is created — not reloaded — when you
        // walk back to it.
        recent.push({ patterns, at: now() });
      }
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
      recent = [];
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
    inflight: null,
    superseded: false,
    disposed: false,
    answeredAt: 0,
    name,
  } as unknown as Held<T>;
  return entry;
}

/** Settles a successful run. Exported for the bridges, which have no loader. */
export function succeed<T>(entry: Held<T>, value: T): void {
  // When it last carried an answer, which is what decides whether an
  // invalidation it never saw still applies to it.
  entry.answeredAt = Date.now();
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
