/**
 * An action: a change, and what it changed.
 *
 * Its own module beside `resource.ts` because reading and writing are two
 * reasons to change. A resource is run like an effect and re-runs itself; an
 * action is run when somebody asks, never rejects, and reports failure through
 * `error` (ADR-0029).
 */

import { batch, onCleanup, untrack } from '@firsthandjs/core';

import { useData } from './resource.js';

import {
  createHeld,
  fail,
  succeed,
  type ActionContext,
  type DataStore,
  type Held,
  type Resource,
} from './store.js';

import type { Tag } from './tags.js';

export type Action<I, R> = {
  readonly data: Resource<R>['data'];
  readonly error: Resource<R>['error'];
  readonly status: Resource<R>['status'];
  readonly running: Resource<R>['loading'];
  /** Runs it. Never rejects: failure is reported through `error`. */
  run(input: I): Promise<R | undefined>;
};

/**
 * What a second `run()` does while the first is still out.
 *
 * A resource has no such question — a newer read always wins, and an abandoned
 * read costs nothing. A mutation is the opposite: aborting one does not undo
 * it. The request may already have reached the server, so `switch` is the only
 * policy here that can lose a write, and it is therefore the one that has to
 * be asked for rather than assumed (ADR-0029).
 *
 * - `queue` — run them in order, one at a time. The default.
 * - `switch` — abort the one in flight and start the new one. Correct for an
 *   idempotent mutation whose latest input supersedes the earlier one, such as
 *   an autosaved draft; wrong for anything that accumulates.
 * - `drop` — while one is out, ignore the new call and hand back the promise
 *   of the run already going. This is what a double-clicked button wants.
 * - `all` — run them concurrently. Each settles on its own; the last to answer
 *   is what `data` ends up holding.
 */
export type ActionConcurrency = 'queue' | 'switch' | 'drop' | 'all';

export type ActionOptions = {
  /** Defaults to `queue`. See {@link ActionConcurrency}. */
  readonly concurrency?: ActionConcurrency;
};

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
  options: ActionOptions = {},
): Action<I, R> {
  const store = useData();
  const entry = createHeld<R>(store, undefined);
  const concurrency = options.concurrency ?? 'queue';
  const holder: Running = { controller: null, invalidating: [], live: new Set(), outstanding: 0 };
  /** The run `drop` hands back, and the one `queue` waits behind. */
  let inflight: Promise<R | undefined> | null = null;

  onCleanup(() => {
    entry.disposed = true;
    for (const controller of holder.live) {
      controller.abort();
    }
    holder.live.clear();
  });

  return {
    data: entry.data,
    error: entry.error,
    status: entry.status,
    running: entry.loading,
    run: (input: I): Promise<R | undefined> => {
      if (entry.disposed) {
        return Promise.resolve(undefined);
      }
      if (concurrency === 'drop' && inflight !== null) {
        return inflight;
      }
      if (concurrency === 'switch') {
        for (const controller of holder.live) {
          controller.abort();
        }
      }
      // `once` never rejects, so chaining on it needs no `catch` and one
      // failed run does not stop the queue behind it.
      const started =
        concurrency === 'queue' && inflight !== null
          ? inflight.then(() => once(entry, store, holder, (context) => run(input, context)))
          : once(entry, store, holder, (context) => run(input, context));
      inflight = started;
      void started.then(() => {
        if (inflight === started) {
          inflight = null;
        }
      });
      return started;
    },
  };
}

/** The run in flight, if any. One object so `onCleanup` and `once` share it. */
type Running = {
  controller: AbortController | null;
  /** What this run said it changed. Reset before every run, so never absent. */
  invalidating: Tag[];
  /** Every run still out. More than one only under `all`. */
  live: Set<AbortController>;
  /** How many runs are out, which is what `running` reports. */
  outstanding: number;
};

/**
 * What an action is handed.
 *
 * An action changes something, so nothing it sends may be answered out of a
 * cache (`force`) or kept in one (`mutating`). `tags` is the store's
 * invalidation, so a client that knows what a mutation changed — a document
 * with `@invalidates` — reports it without the call site repeating it.
 */
function contextFor(holder: Running, current: AbortController): ActionContext {
  const invalidates = (...tags: Tag[]): void => {
    holder.invalidating = tags;
  };
  return {
    signal: current.signal,
    invalidates,
    request: {
      signal: current.signal,
      force: true,
      mutating: true,
      tags: invalidates,
    },
  };
}

/**
 * Runs it once, replacing whatever was in flight, and never rejecting.
 *
 * Untracked: an action runs from an event handler, and what it reads on the
 * way is nobody's dependency.
 */
async function once<R>(
  entry: Held<R>,
  store: DataStore,
  holder: Running,
  body: (context: ActionContext) => Promise<R>,
): Promise<R | undefined> {
  // Checked here rather than at the call: a queued run may have been waiting
  // behind another while the component went away.
  if (entry.disposed) {
    return undefined;
  }
  // Read through a call from here on. The check above narrows the property to
  // `false` for the rest of the function, and the compiler has no way to know
  // that a cleanup sets it during one of the awaits below.
  const gone = (): boolean => entry.disposed;
  const current = new AbortController();
  holder.controller = current;
  holder.live.add(current);
  holder.outstanding++;
  holder.invalidating = [];
  const context = contextFor(holder, current);
  batch(() => {
    entry.loading.value = true;
    entry.status.value = 'loading';
  });

  try {
    const result = await untrack(() => body(context));
    if (current.signal.aborted || gone()) {
      return undefined;
    }
    succeed(entry, result);
    if (holder.invalidating.length > 0) {
      await store.invalidate(...holder.invalidating);
    }
    return result;
  } catch (error: unknown) {
    if (current.signal.aborted || gone()) {
      return undefined;
    }
    fail(entry, error);
    return undefined;
  } finally {
    holder.live.delete(current);
    holder.outstanding--;
    // `succeed` and `fail` each cleared it for their own run; under `all` that
    // is too early, because somebody else is still out. This is the only place
    // that knows.
    if (!gone()) {
      entry.loading.value = holder.outstanding > 0;
    }
  }
}
