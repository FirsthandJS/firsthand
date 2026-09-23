/**
 * Async work that belongs to a scope (ADR-0028).
 *
 * The owner tree already knows how to end things: when an effect runs again,
 * `clearScope` disposes what the previous run made, and when a component goes
 * away everything under it goes with it. What it could not reach was a promise
 * — an `await` resumes with no owner at all, so an asynchronous continuation
 * outlived the scope it was started from and could still write to it.
 *
 * A task is the adapter between the two. It holds an `AbortController`, hangs
 * a scope off the current owner, and asks that owner to abort it on disposal.
 * Nothing else is new: supersession falls out of the existing `clearScope`,
 * because an effect that runs again disposes the task the previous run
 * started.
 *
 * ```ts
 * effect(() => {
 *   task(async ({ signal, resume }) => {
 *     const user = await resume(fetchUser(id.value, { signal }));
 *     profile.value = user; // only reached while this is still the current run
 *   });
 * });
 * ```
 *
 * `resume` is the price of doing this without a transform: an `await` cannot
 * be intercepted from userland, so the one place that can check whether the
 * world still wants this work is the place the value comes back through. It is
 * deliberately visible, for the same reason `snapshot()` is — a reader can see
 * where the run may stop.
 */
import {
  createDetachedOwner,
  disposeOwner,
  getOwner,
  handleError,
  setOwner,
  type Owner,
} from './core.js';
import { devWarn } from './dev.js';
import { FirsthandSupersededError } from './errors.js';
import { onCleanup } from './lifecycle.js';

export type TaskContext = {
  /** Aborted when this task is superseded, or its scope goes away. */
  readonly signal: AbortSignal;
  /**
   * Awaits something and comes back inside this task, or not at all.
   *
   * Throws {@link FirsthandSupersededError} when the task has been aborted
   * while the value was on its way. The task swallows that, so the code after
   * a `resume` runs only while the run is still the current one.
   */
  readonly resume: <V>(awaited: PromiseLike<V> | V) => Promise<V>;
  /**
   * Runs `fn` with this task's scope established.
   *
   * Needed after an `await`, where there is no ambient owner: reading context,
   * registering an `onCleanup`, or creating an effect all need to know what
   * they belong to. Everything `fn` makes is disposed when the task ends.
   */
  readonly run: <V>(fn: () => V) => V;
};

export type Task<T> = {
  /**
   * What the body produced, or `undefined` if it was superseded or threw.
   *
   * Never rejects. An error that is not supersession goes to the nearest
   * `catchError` boundary above the task, which is where an error from an
   * effect would have gone too.
   */
  readonly promise: Promise<T | undefined>;
  /** Stops it. The next `resume` throws, and the scope is disposed. */
  readonly abort: () => void;
};

/**
 * Starts async work owned by the current scope.
 *
 * The scope ends when the work ends. Anything that has to outlive the task
 * belongs to the owner above it instead.
 */
/** The three things a body is handed. Built here so `task` stays one screen. */
function contextFor(controller: AbortController, scope: Owner): TaskContext {
  return {
    signal: controller.signal,
    resume: async <V>(awaited: PromiseLike<V> | V): Promise<V> => {
      const value = await awaited;
      if (controller.signal.aborted) {
        throw new FirsthandSupersededError();
      }
      return value;
    },
    run: <V>(fn: () => V): V => {
      const previous = setOwner(scope);
      try {
        return fn();
      } finally {
        setOwner(previous);
      }
    },
  };
}

/**
 * Turns the body's promise into the task's, which never rejects.
 *
 * Being superseded is the mechanism working, so it is swallowed. Anything else
 * is a real error and belongs to a boundary above.
 */
function settle<T>(
  running: Promise<T>,
  controller: AbortController,
  scope: Owner,
  end: () => void,
): Promise<T | undefined> {
  return running.then(
    (value): T | undefined => {
      const aborted = controller.signal.aborted;
      end();
      return aborted ? undefined : value;
    },
    (error: unknown): undefined => {
      if (!controller.signal.aborted && !(error instanceof FirsthandSupersededError)) {
        handleError(error, scope);
      }
      end();
      return undefined;
    },
  );
}

/**
 * Starts async work owned by the current scope.
 *
 * The scope ends when the work ends. Anything that has to outlive the task
 * belongs to the owner above it instead.
 */
export function task<T>(body: (context: TaskContext) => Promise<T>): Task<T> {
  const parent = getOwner();
  // Detached on purpose: the abort has to be observable to this task's own
  // cleanups, and a scope in the parent's child list is torn down before the
  // parent's cleanups run. See `createDetachedOwner`.
  const scope = createDetachedOwner(parent);
  const controller = new AbortController();
  let ended = false;

  const end = (): void => {
    if (ended) {
      return;
    }
    ended = true;
    disposeOwner(scope);
  };
  const abort = (): void => {
    controller.abort();
    end();
  };

  if (parent === null) {
    devWarn(
      'task() was called outside any scope, so nothing will ever abort it. ' +
        'Start it inside a component, an effect, or a createRoot().',
    );
  } else {
    onCleanup(abort);
  }

  // The body runs synchronously up to its first `await`, and that stretch is
  // inside the task's scope — so a resource or an effect created before the
  // first suspension belongs to the task without anyone saying so.
  const previous = setOwner(scope);
  let running: Promise<T>;
  try {
    running = body(contextFor(controller, scope));
  } catch (error) {
    setOwner(previous);
    handleError(error, scope);
    end();
    return { promise: Promise.resolve(undefined), abort };
  }
  setOwner(previous);

  return { promise: settle(running, controller, scope, end), abort };
}
