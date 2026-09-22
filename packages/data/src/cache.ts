/**
 * The cache — one, and the transport layer's, not the store's.
 *
 * ADR-0022 says resources are not a cache, and they are not: a resource
 * belongs to its call site, and two call sites are two resources. What that
 * argument leaves open is that the *transport* wants one, and an application
 * that brings no client has nowhere to put it. This is that place.
 *
 * It is deliberately one cache for two jobs. `createFetchClient` keeps its
 * responses here, and an algorithm of your own — an expensive computation, a
 * worker round trip, a read out of IndexedDB — keeps its results here through
 * exactly the same `read`. There is no second, hidden implementation inside
 * the fetch client, because two caches with two sets of rules is the thing
 * this project spent an ADR refusing.
 *
 * ```ts
 * const cache = createCacheClient({ ttl: 30_000 });
 *
 * const primes = useResource((context) =>
 *   cache.read(`primes:${limit.value}`, () => sieve(limit.value))(context.request),
 * );
 * ```
 *
 * What it does, and the whole of it:
 *
 * - **Serves a fresh entry** without running the producer. Freshness is `ttl`,
 *   which is 0 by default: nothing is reused, but see the next point.
 * - **Deduplicates what is in flight.** Two callers asking for one key while
 *   the request is out get one request and both get its answer — at any `ttl`,
 *   because two identical requests overlapping in time is waste rather than
 *   staleness.
 * - **Honours `force`.** An invalidated resource reaches through: the entry is
 *   dropped, the producer runs, and the answer replaces what was there. This
 *   is the point where the store's invalidation and the transport's memory
 *   meet, and without it an invalidation would be answered out of the cache it
 *   was meant to defeat.
 * - **Stays out of an action's way.** A `mutating` request is run and nothing
 *   else: not served from here, not shared with anybody, and not kept.
 * - **Forgets.** `forget(key)`, `forget()` for all of it, `forgetTagged(…)`
 *   for everything an invalidation was about, and the oldest entry goes when
 *   `max` is reached.
 *
 * The last of those is the one worth explaining. An entry remembers what the
 * request said it was about, and a store that is given this cache throws those
 * entries away when it invalidates — so a list nobody is watching is not
 * served a stale answer when somebody walks back to it. The tags are
 * **metadata, never the key**: identity is still the scope and the request,
 * which is what ADR-0022 is about and what this deliberately does not undo.
 */
import { anyTagMatches, type Tag } from './tags.js';
import type { DataRequest, Loader } from './store.js';

/**
 * A key for a value, stable however the value was written.
 *
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` are the same request, so they must be
 * the same key — which `JSON.stringify` alone does not give you, because it
 * keeps insertion order. Exported because a caller building a `cacheKey` of
 * their own needs the same guarantee, and getting it wrong means one answer
 * served for two different requests.
 */
export function stableKey(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableKey).join(',')}]`;
  }
  if (value instanceof Date) {
    // Named, because an object branch would read every `Date` as `{}` and make
    // two different days one key.
    return value.toISOString();
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, held]) => held !== undefined)
    .sort(([one], [other]) => (one < other ? -1 : 1));
  return `{${entries.map(([name, held]) => `${name}:${stableKey(held)}`).join(',')}}`;
}

export type CacheOptions = {
  /**
   * How long an answer is served again without running the producer, in ms.
   *
   * Default 0: every run asks again, and only what is *in flight* is shared.
   * That is the safe default — an application that has not thought about
   * staleness does not silently get some.
   */
  readonly ttl?: number;
  /**
   * How many entries to keep. The least recently read goes first. Default 100.
   *
   * A cache without a bound is a leak with a plan, and the number is here
   * rather than in a comment because only the application knows what its
   * entries weigh.
   */
  readonly max?: number;
  /** For tests: what `Date.now()` should be. */
  readonly now?: () => number;
};

export type CacheClient = {
  /**
   * Wraps a producer so its answer is kept under `key`.
   *
   * The producer is given a request of the cache's own: its signal is aborted
   * when *every* waiter has gone, so one component leaving does not cancel a
   * request another is still waiting for.
   */
  read<T>(key: string, produce: Loader<T>): Loader<T>;
  /**
   * Puts a value in directly — a push from a socket, a known first page.
   *
   * A value you hand over is not an answer that might already be stale, so
   * with no `ttl` configured it stays until it is forgotten rather than
   * expiring immediately.
   */
  write(key: string, value: unknown): void;
  /** Reads what is there without running anything. `undefined` if stale. */
  peek(key: string): unknown;
  /** Forgets one key, or everything. */
  forget(key?: string): void;
  /**
   * Forgets every entry whose request said it was about one of these.
   *
   * What `store.invalidate` calls on a cache it was given. Matching is the
   * tags' own rule — fewer variables match more — and an entry that never said
   * what it was about is never matched, because nothing can be concluded about
   * it.
   */
  forgetTagged(patterns: readonly Tag[]): void;
  /**
   * Everything answered so far, as plain data.
   *
   * What a server sends to the browser with the page. Resources have no keys
   * — a resource belongs to its call site, which is the whole of ADR-0022 —
   * but the transport's cache does, so this is where handing an answer from
   * one process to another can be done at all. Entries still in flight are
   * left out: there is nothing to hand over yet.
   *
   * ```ts
   * const state = cache.dump();           // on the server
   * cache.seed(state);                    // in the browser, before render
   * ```
   */
  dump(): Record<string, unknown>;
  /**
   * Puts answers a server produced in, as if they had been `write`n.
   *
   * They stay until something forgets them, so the first render in the
   * browser is served from here rather than asking again.
   */
  seed(entries: Record<string, unknown>): void;
  /** Resolves once nothing this cache is running is still out. */
  settle(passes?: number): Promise<void>;
  /** How many entries are held, in flight included. */
  readonly size: number;
};

type Entry = {
  value: unknown;
  /** What the request that produced this said it was about. Metadata only. */
  tags: readonly Tag[];
  /** When it stops being fresh; `Infinity` for a write with no ttl. */
  expires: number;
  /** The run everybody is waiting for, while there is one. */
  inflight: Promise<unknown> | null;
  controller: AbortController | null;
  /** How many callers still want the in-flight run. */
  waiting: number;
};

export function createCacheClient(options: CacheOptions = {}): CacheClient {
  const ttl = options.ttl ?? 0;
  const max = options.max ?? 100;
  const now = options.now ?? ((): number => Date.now());
  // Insertion order is the eviction order, and a read moves an entry to the
  // end: a `Map` already keeps that order, so there is no list to maintain.
  const entries = new Map<string, Entry>();

  const drop = (key: string): void => {
    const entry = entries.get(key);
    entry?.controller?.abort();
    entries.delete(key);
  };

  /** An answer somebody handed over, rather than one a producer returned. */
  const put = (key: string, value: unknown): void => {
    keep(key, {
      value,
      tags: [],
      expires: ttl === 0 ? Infinity : now() + ttl,
      inflight: null,
      controller: null,
      waiting: 0,
    });
  };

  const keep = (key: string, entry: Entry): void => {
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > max) {
      // The first key is the one read longest ago, and there is always one:
      // the size is over the bound, so the map is not empty.
      for (const oldest of entries.keys()) {
        drop(oldest);
        break;
      }
    }
  };

  return {
    get size(): number {
      return entries.size;
    },
    dump: (): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of entries) {
        // Freshness is not asked about. This is a handover, not a read: the
        // answers were produced by the render that is being sent, and with the
        // default `ttl` of 0 they are stale the moment they arrive — which
        // would make a dump of a default cache empty, which is useless. What
        // is left out is what has no answer yet.
        if (entry.inflight === null) {
          out[key] = entry.value;
        }
      }
      return out;
    },
    seed: (values: Record<string, unknown>): void => {
      for (const key in values) {
        put(key, values[key]);
      }
    },
    settle: async (passes = 10): Promise<void> => {
      for (let pass = 0; pass < passes; pass++) {
        const waiting: Promise<unknown>[] = [];
        for (const entry of entries.values()) {
          if (entry.inflight !== null) {
            waiting.push(entry.inflight);
          }
        }
        if (waiting.length === 0) {
          return;
        }
        // A producer that fails is still a producer that finished.
        await Promise.all(waiting.map(async (one) => one.catch(() => undefined)));
      }
    },
    peek: (key: string): unknown => {
      const entry = entries.get(key);
      if (entry === undefined || entry.expires <= now()) {
        return undefined;
      }
      return entry.value;
    },
    write: put,
    forget: (key?: string): void => {
      if (key === undefined) {
        for (const held of [...entries.keys()]) {
          drop(held);
        }
        return;
      }
      drop(key);
    },
    forgetTagged: (patterns: readonly Tag[]): void => {
      for (const [key, entry] of [...entries]) {
        if (entry.tags.length > 0 && anyTagMatches(patterns, entry.tags)) {
          drop(key);
        }
      }
    },
    read:
      <T>(key: string, produce: Loader<T>): Loader<T> =>
      async (request: DataRequest): Promise<T> => {
        if (request.mutating === true) {
          // An action. It is not answered from here and it does not end up
          // here: a write is not a representation, and two writes are two
          // writes rather than one to share.
          return await produce(request);
        }
        const held = entries.get(key);
        if (request.force) {
          // The invalidation reaches through: whatever is here is the answer
          // that was just declared wrong, and a run in flight was started
          // before it was.
          drop(key);
        } else if (held !== undefined) {
          if (held.inflight !== null) {
            return await share(held, request);
          }
          if (held.expires > now()) {
            keep(key, held);
            return held.value as T;
          }
          entries.delete(key);
        }

        // The cache's own controller, not the caller's: the run belongs to
        // everybody waiting for it, and ends when the last of them leaves.
        const controller = new AbortController();
        const entry: Entry = {
          value: undefined,
          // What the request has been declared to be about by now. A client
          // declares before it looks here, which is what makes this possible.
          tags: request.declared ?? [],
          expires: 0,
          inflight: null,
          controller,
          waiting: 0,
        };
        const run = produce({ signal: controller.signal, force: request.force })
          .then((value): T => {
            if (entries.get(key) === entry) {
              if (ttl === 0) {
                // Nothing to keep: with no lifetime, the entry existed only so
                // that callers overlapping in time could share one run.
                entries.delete(key);
              } else {
                entry.value = value;
                entry.expires = now() + ttl;
                entry.inflight = null;
                entry.controller = null;
              }
            }
            return value;
          })
          .catch((error: unknown): never => {
            // A failure is not an answer: the next caller asks again.
            if (entries.get(key) === entry) {
              entries.delete(key);
            }
            throw error as Error;
          });
        entry.inflight = run;
        keep(key, entry);
        return await share(entry, request);
      },
  };
}

/**
 * Waits for a shared run, and stops caring when the caller does.
 *
 * The run is only aborted once nobody is left waiting for it — the case a
 * naive implementation gets wrong, where one component unmounting cancels the
 * request another component is still showing a spinner for.
 */
async function share<T>(entry: Entry, request: DataRequest): Promise<T> {
  entry.waiting += 1;
  const stop = (): void => {
    // This caller has gone. If it was the last one, so has the reason to run:
    // anything else would cancel a request another component is still showing
    // a spinner for.
    if (entry.waiting <= 1 && entry.inflight !== null) {
      entry.controller?.abort();
    }
  };
  request.signal.addEventListener('abort', stop, { once: true });
  try {
    return (await entry.inflight) as T;
  } finally {
    request.signal.removeEventListener('abort', stop);
    entry.waiting -= 1;
  }
}
