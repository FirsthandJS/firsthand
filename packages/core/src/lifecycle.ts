import { createOwner, disposeOwner, getOwner, handleError, setOwner } from './core.js';
import { devRoot, devWarn } from './dev.js';
import type { Dispose } from './types.js';

/**
 * Registers a callback to run when the enclosing scope is disposed, or — inside
 * an effect — before the effect's next run.
 */
export function onCleanup(fn: () => void): void {
  const owner = getOwner();
  if (owner === null) {
    devWarn('onCleanup() was called outside any scope, so it will never run.');
    return;
  }
  (owner.disposals ??= []).push(fn);
}

/**
 * Creates a detached root scope and hands back its disposer.
 *
 * Everything reactive created inside `fn` belongs to this root, so `dispose()`
 * unsubscribes all of it. This is the explicit escape hatch for reactive code
 * that lives outside a component; not calling `dispose()` leaks.
 */
export function createRoot<T>(fn: (dispose: Dispose) => T): T {
  const owner = createOwner(getOwner());
  // A root is where devtools start walking: everything the graph holds hangs
  // off one of these, through owners that disposal already keeps linked.
  devRoot(owner);
  const previous = setOwner(owner);
  try {
    return fn(() => {
      disposeOwner(owner);
    });
  } finally {
    setOwner(previous);
  }
}

/**
 * Installs an error boundary on the current scope.
 *
 * Errors thrown by `fn`, by effects created under it, or by DOM parts it owns
 * propagate up the *owner* tree — so a portal's errors reach the boundary that
 * lexically encloses the `portal()` call, not one near its DOM parent.
 */
export function catchError<T>(fn: () => T, handler: (error: unknown) => void): T | undefined {
  const owner = createOwner(getOwner());
  owner.handler = handler;
  const previous = setOwner(owner);
  // The scope is restored explicitly on both paths rather than in a `finally`,
  // so that the abrupt completion of a boundary is an ordinary, observable code
  // path instead of a hidden one.
  try {
    const result = fn();
    setOwner(previous);
    return result;
  } catch (error) {
    setOwner(previous);
    handleError(error, owner);
    return undefined;
  }
}

/**
 * Runs `fn` with `owner` as the current scope.
 *
 * Needed by asynchronous continuations — an `await` resumes with no ambient
 * scope, so code that creates effects after awaiting must re-establish one.
 */
export function runWithOwner<T>(owner: ReturnType<typeof getOwner>, fn: () => T): T {
  const previous = setOwner(owner);
  try {
    return fn();
  } finally {
    setOwner(previous);
  }
}

export { getOwner };
export type { Owner } from './core.js';
