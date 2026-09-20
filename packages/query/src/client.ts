/**
 * The cache.
 *
 * One entry per query identity, holding signals rather than a snapshot: every
 * component that asked for the same data reads the same cells, so a refetch
 * anywhere updates every one of them without a subscription list of its own.
 * That is the whole reason the result of a refetch "just appears" — there is
 * no copy to keep in sync.
 */
import {
  batch,
  signal,
  untrack,
  type Dispose,
  type ReadonlyCell,
  type Signal,
} from '@firsthandjs/core';
import { anyTagMatches, tagsKey, type Tag } from './tags.js';
import { devQuery } from './dev.js';

export type QueryStatus = 'idle' | 'pending' | 'success' | 'error';

/** Whatever a query depends on that is not a tag. */
export type Variables = Readonly<Record<string, unknown>>;

/** What every request this package makes is given. */
export interface RequestContext {
  /** Aborted when the request is superseded, replaced or dropped. */
  readonly signal: AbortSignal;
}

export interface FetchContext<V extends Variables = Variables> extends RequestContext {
  /** The variables this entry was created for. */
  readonly variables: V;
}

export interface QueryDefinition<T, V extends Variables = Variables> {
  /** What this query is about, and what a mutation invalidates it by. */
  readonly tags: readonly Tag[];
  /**
   * What this query depends on beyond its tags — a page number, a filter, a
   * sort order.
   *
   * They are part of the entry's identity, so changing one moves the query to
   * a different entry and fetches it. Anything the fetcher reads that can
   * change belongs either in a tag or here: a value in neither would be
   * answered for ever out of the first result.
   */
  readonly variables?: V;
  readonly fetch: (context: FetchContext<V>) => Promise<T>;
  /**
   * Overrides the identity.
   *
   * Only needed when two queries have the same tags *and* the same variables —
   * a list and its count, say. Tags still decide invalidation; this decides
   * which entry the data lands in.
   */
  readonly key?: string;
  /** How long a result stays fresh. Defaults to the client's setting. */
  readonly staleTime?: number;
}

/** A stable string for a set of variables, whatever order they were written in. */
export function variablesKey(variables: Variables): string {
  const names = Object.keys(variables).sort();
  return names.map((name) => `${name}=${JSON.stringify(variables[name])}`).join('&');
}

export interface QueryEntry<T = unknown> {
  readonly key: string;
  readonly tags: readonly Tag[];
  readonly variables: Variables;
  readonly data: Signal<T | undefined>;
  readonly error: Signal<unknown>;
  readonly status: Signal<QueryStatus>;
  /** True while a request is in flight, including a background refetch. */
  readonly fetching: Signal<boolean>;
  /** When the current data arrived, as `Date.now()`; 0 if there is none. */
  updatedAt: number;
  /** Marked by an invalidation: the next use re-fetches. */
  invalid: boolean;
  subscribers: number;
}

export interface LoadOptions {
  /** Ignore the cache and go to the network. */
  readonly force?: boolean;
}

export interface QueryClientOptions {
  /** How long results stay fresh, in ms. Default 0: reused, but re-fetched. */
  readonly staleTime?: number;
  /** How long an unused entry is kept, in ms. Default five minutes. */
  readonly cacheTime?: number;
}

interface Record_<T = unknown> extends QueryEntry<T> {
  fetcher: (context: FetchContext) => Promise<T>;
  staleTime: number;
  inflight: Promise<T | undefined> | null;
  controller: AbortController | null;
  collect: ReturnType<typeof setTimeout> | null;
}

export interface QueryClient {
  /** The entry a definition names, created on first use. */
  entry<T, V extends Variables>(definition: QueryDefinition<T, V>): QueryEntry<T>;
  /** Fetches if the cache cannot answer — or always, with `force`. */
  load<T, V extends Variables>(
    definition: QueryDefinition<T, V>,
    options?: LoadOptions,
  ): Promise<T | undefined>;
  /**
   * Marks every entry carrying a matching tag as invalid.
   *
   * Entries somebody is watching re-fetch immediately; the rest re-fetch the
   * next time they are used. Resolves when the immediate re-fetches settle.
   */
  invalidate(...patterns: Tag[]): Promise<void>;
  /** Holds an entry; the returned function releases it. */
  subscribe(entry: QueryEntry): Dispose;
  /** Drops everything. Requests in flight are aborted. */
  clear(): void;
  /** Entries currently held, for tests and devtools. */
  readonly size: number;
}

const FIVE_MINUTES = 5 * 60 * 1000;
const NO_VARIABLES: Variables = Object.freeze({});

export function createQueryClient(options: QueryClientOptions = {}): QueryClient {
  const entries = new Map<string, Record_>();
  const defaultStale = options.staleTime ?? 0;
  const cacheTime = options.cacheTime ?? FIVE_MINUTES;

  function record<T, V extends Variables>(definition: QueryDefinition<T, V>): Record_<T> {
    // The entry stores the fetcher without its variable type. The cast is
    // sound by construction: the variables it will be handed are the ones the
    // key was derived from, which are this definition's own.
    const fetcher = definition.fetch as (context: FetchContext) => Promise<T>;
    const variables = definition.variables ?? NO_VARIABLES;
    const key = definition.key ?? `${tagsKey(definition.tags)}|${variablesKey(variables)}`;
    const existing = entries.get(key) as Record_<T> | undefined;
    if (existing !== undefined) {
      // The fetcher is re-read: it closes over the variables of whoever asked
      // most recently, and those are equal by construction — the identity is
      // derived from the same tags and the same variables.
      existing.fetcher = fetcher;
      return existing;
    }
    const created: Record_<T> = {
      key,
      tags: definition.tags,
      variables,
      data: signal<T | undefined>(undefined),
      error: signal<unknown>(undefined),
      status: signal<QueryStatus>('idle'),
      fetching: signal(false),
      updatedAt: 0,
      invalid: false,
      subscribers: 0,
      fetcher,
      staleTime: definition.staleTime ?? defaultStale,
      inflight: null,
      controller: null,
      collect: null,
    };
    entries.set(key, created);
    devQuery('created', key, definition.tags);
    return created;
  }

  function fresh(entry: Record_): boolean {
    return (
      !entry.invalid && entry.updatedAt !== 0 && Date.now() - entry.updatedAt < entry.staleTime
    );
  }

  function run<T>(entry: Record_<T>): Promise<T | undefined> {
    entry.controller?.abort();
    const controller = new AbortController();
    entry.controller = controller;
    batch(() => {
      entry.fetching.value = true;
      // Keeping the previous data visible during a refetch is the point: the
      // view shows the old value with `fetching` true, and swaps when the new
      // one lands. Only a query with nothing to show reports `pending`.
      if (entry.updatedAt === 0) {
        entry.status.value = 'pending';
      }
    });

    const request = entry
      .fetcher({ signal: controller.signal, variables: entry.variables })
      .then((value): T | undefined => {
        if (controller.signal.aborted) {
          return undefined;
        }
        batch(() => {
          entry.data.value = value;
          entry.error.value = undefined;
          entry.status.value = 'success';
          entry.fetching.value = false;
        });
        entry.updatedAt = Date.now();
        entry.invalid = false;
        entry.inflight = null;
        return value;
      })
      .catch((error: unknown): undefined => {
        if (controller.signal.aborted) {
          return undefined;
        }
        batch(() => {
          entry.error.value = error;
          entry.status.value = 'error';
          entry.fetching.value = false;
        });
        entry.inflight = null;
        return undefined;
      });

    entry.inflight = request;
    return request;
  }

  function load<T, V extends Variables>(
    definition: QueryDefinition<T, V>,
    loadOptions: LoadOptions = {},
  ): Promise<T | undefined> {
    const entry = record(definition);
    if (loadOptions.force === true) {
      return run(entry);
    }
    if (entry.inflight !== null) {
      // Deduplicated: ten components asking at once make one request.
      return entry.inflight;
    }
    if (fresh(entry)) {
      return Promise.resolve(untrack(() => entry.data.value));
    }
    return run(entry);
  }

  function drop(entry: Record_): void {
    entry.controller?.abort();
    devQuery('dropped', entry.key, entry.tags);
    entries.delete(entry.key);
  }

  return {
    entry: <T, V extends Variables>(definition: QueryDefinition<T, V>): QueryEntry<T> =>
      record(definition),
    load,
    invalidate: async (...patterns: Tag[]): Promise<void> => {
      const waiting: Promise<unknown>[] = [];
      for (const entry of [...entries.values()]) {
        if (!anyTagMatches(patterns, entry.tags)) {
          continue;
        }
        // Reported per matched entry rather than per call: an invalidation
        // that hits nothing is indistinguishable from one never sent, and
        // that is the confusion this exists to end.
        devQuery('invalidated', entry.key, entry.tags);
        entry.invalid = true;
        if (entry.subscribers > 0) {
          waiting.push(run(entry));
        }
      }
      await Promise.all(waiting);
    },
    subscribe: (entry: QueryEntry): Dispose => {
      const held = entry as Record_;
      held.subscribers++;
      if (held.collect !== null) {
        clearTimeout(held.collect);
        held.collect = null;
      }
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        held.subscribers--;
        if (held.subscribers === 0) {
          // Kept for a while: navigating away and back should not re-fetch.
          held.collect = setTimeout(() => {
            drop(held);
          }, cacheTime);
        }
      };
    },
    clear: () => {
      for (const entry of [...entries.values()]) {
        if (entry.collect !== null) {
          clearTimeout(entry.collect);
        }
        drop(entry);
      }
    },
    get size(): number {
      return entries.size;
    },
  };
}

/** What a query looks like to the code reading it. */
export interface QueryResult<T> {
  readonly data: ReadonlyCell<T | undefined>;
  readonly error: ReadonlyCell<unknown>;
  readonly status: ReadonlyCell<QueryStatus>;
  readonly fetching: ReadonlyCell<boolean>;
  /** Goes to the network, cache or not. */
  refetch(options?: LoadOptions): Promise<T | undefined>;
}
