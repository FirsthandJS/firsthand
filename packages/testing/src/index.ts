/**
 * `@firsthandjs/testing` — mounting, cleanup and leak probes.
 *
 * Deliberately small. Firsthand renders real DOM, so the DOM is the API: there is
 * no wrapper object to learn and no query language to re-implement. What a test
 * actually needs from a framework is somewhere to mount, a guarantee that the
 * previous test's tree is gone, and a way to ask whether disposal really
 * released everything. That is what is here.
 *
 * It is runner-agnostic. `autoCleanup()` hooks into whatever `afterEach` the
 * environment provides — Vitest, Jest, Mocha, Playwright's component runner —
 * and does nothing if there is none.
 */
import { createRoot, type Dispose } from '@firsthandjs/core';
import { render, type View } from '@firsthandjs/dom';

/*
 * `get` and `all` take the element type as a parameter used only in the return
 * position, exactly as `querySelector` does. The caller is asserting what it
 * expects to find, and the alternative — returning `HTMLElement` — would push a
 * cast to every call site, which is the thing this API exists to avoid.
 */
/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters */

/** What `mount` hands back. */
export type Mounted = {
  /** The element the view was rendered into. */
  readonly container: HTMLElement;
  /** Disposes the view and removes its container. Idempotent. */
  readonly unmount: Dispose;
  /** Shorthand for `container.textContent`, which most assertions want. */
  text(): string;
  /** `querySelector` that throws instead of returning null. */
  get<E extends Element = HTMLElement>(selector: string): E;
  /** `querySelectorAll` as a real array. */
  all<E extends Element = HTMLElement>(selector: string): E[];
};

const active = new Set<Dispose>();

/**
 * Renders a view into a fresh container attached to the document.
 *
 * Attached, not detached: layout, focus, events and `:hover` all behave
 * differently in a detached tree, and a test that passes only detached is a
 * test of something else.
 */
export function mount(view: () => View, parent: ParentNode = document.body): Mounted {
  const container = document.createElement('div');
  parent.appendChild(container);
  const dispose = render(view, container);

  let done = false;
  const unmount = (): void => {
    if (done) {
      return;
    }
    done = true;
    active.delete(unmount);
    dispose();
    container.remove();
  };
  active.add(unmount);

  return {
    container,
    unmount,
    text: () => container.textContent,
    get: <E extends Element = HTMLElement>(selector: string): E => {
      const found = container.querySelector<E>(selector);
      if (found === null) {
        throw new Error(
          `No element matched ${selector}. The container holds:\n${container.innerHTML}`,
        );
      }
      return found;
    },
    all: <E extends Element = HTMLElement>(selector: string): E[] => [
      ...container.querySelectorAll<E>(selector),
    ],
  };
}

/** Unmounts everything `mount` created and still holds. */
export function cleanup(): void {
  for (const unmount of [...active]) {
    unmount();
  }
}

type Hook = (fn: () => void) => void;

/**
 * Registers `cleanup` with the surrounding test framework, if there is one.
 *
 * Call it once in a setup file. A test that forgets to unmount then cannot
 * leak into the next one, which is the failure mode that makes a suite
 * mysteriously order-dependent.
 */
export function autoCleanup(): boolean {
  const hook = (globalThis as { afterEach?: Hook }).afterEach;
  if (typeof hook !== 'function') {
    return false;
  }
  hook(cleanup);
  return true;
}

/**
 * Runs `fn` in its own reactive root and returns the result with a disposer.
 *
 * For testing reactivity without any DOM — signals, computeds, effects and
 * context all work in a plain Node environment, because the core has no DOM
 * dependency.
 */
export function withRoot<T>(fn: () => T): { value: T; dispose: Dispose } {
  let dispose!: Dispose;
  const value = createRoot((stop) => {
    dispose = stop;
    return fn();
  });
  return { value, dispose };
}

/**
 * How many live subscribers a signal or computed currently has.
 *
 * The number a leak test wants: after disposing whatever was watching it, a
 * source that still has subscribers is still reachable from the graph, and
 * nothing it references can be collected. This reads the graph rather than
 * guessing from the heap, so it is deterministic in every engine.
 */
export function subscriberCount(source: object): number {
  let link = (source as { subs?: { nextSub?: unknown } }).subs;
  let total = 0;
  while (link !== undefined) {
    total++;
    link = (link as { nextSub?: { nextSub?: unknown } }).nextSub;
  }
  return total;
}

/**
 * Waits for pending microtasks and, optionally, a timer.
 *
 * Firsthand updates the DOM synchronously (ADR-0006), so this is *not* needed
 * after a signal write. It is here for the ordinary reason any test needs it:
 * an `await` in application code, a `fetch`, a `queueMicrotask`.
 */
export async function tick(ms = 0): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
