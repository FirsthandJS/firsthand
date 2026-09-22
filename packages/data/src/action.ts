/**
 * An action: a change, and what it changed.
 *
 * Its own module beside `resource.ts` because reading and writing are two
 * reasons to change. A resource is run like an effect and re-runs itself; an
 * action is run when somebody asks, never rejects, and reports failure through
 * `error` (ADR-0029).
 */

import { onCleanup, untrack } from '@firsthandjs/core';

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

  const holder: Running = { controller: null, invalidating: [] };
  onCleanup(() => {
    entry.disposed = true;
    holder.controller?.abort();
  });

  return {
    data: entry.data,
    error: entry.error,
    status: entry.status,
    running: entry.loading,
    run: (input: I): Promise<R | undefined> =>
      once(entry, store, holder, () => run(input, contextFor(holder))),
  };
}

/** The run in flight, if any. One object so `onCleanup` and `once` share it. */
type Running = {
  controller: AbortController | null;
  /** What this run said it changed. Reset before every run, so never absent. */
  invalidating: Tag[];
};

/**
 * What an action is handed.
 *
 * An action changes something, so nothing it sends may be answered out of a
 * cache (`force`) or kept in one (`mutating`). `tags` is the store's
 * invalidation, so a client that knows what a mutation changed — a document
 * with `@invalidates` — reports it without the call site repeating it.
 */
function contextFor(holder: Running): ActionContext {
  const current = holder.controller as AbortController;
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
  body: () => Promise<R>,
): Promise<R | undefined> {
  holder.controller?.abort();
  holder.controller = new AbortController();
  const current = holder.controller;
  holder.invalidating = [];
  entry.loading.value = true;
  entry.status.value = 'loading';

  try {
    const result = await untrack(body);
    if (current.signal.aborted || entry.disposed) {
      return undefined;
    }
    succeed(entry, result);
    if (holder.invalidating.length > 0) {
      await store.invalidate(...holder.invalidating);
    }
    return result;
  } catch (error: unknown) {
    if (current.signal.aborted || entry.disposed) {
      return undefined;
    }
    fail(entry, error);
    return undefined;
  }
}
