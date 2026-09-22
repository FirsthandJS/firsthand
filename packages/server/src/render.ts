/**
 * Turning a view into markup.
 *
 * The same components, the same signals, the same context — compiled to build
 * a string instead of a tree. What differs from the browser is only what
 * cannot exist without one:
 *
 * - **Effects do not run.** An effect is a side effect over time, and a render
 *   that produces one string has none. Anything that must happen before the
 *   markup exists is data, and data has `useResource`.
 * - **Refs and event handlers are not emitted.** A server has no node to hand
 *   to a ref and no one to click. Both are attached during hydration, where
 *   they are the only things left to do.
 */

import {
  createOwner,
  disposeOwner,
  setOwner,
  setRendering,
  untrack,
  type Owner,
} from '@firsthandjs/core';
import { child } from './markup.js';

export type RenderOptions = {
  /**
   * Wraps the markup, so the document a server sends is written in one place.
   *
   * It receives the rendered body and returns the whole response; leaving it
   * out returns the body alone, which is what a fragment or a test wants.
   */
  document?: (body: string) => string;
};

export type AsyncRenderOptions = RenderOptions & {
  /**
   * Waits for whatever the render started.
   *
   * A data store's `settle()`, a cache client's, or both — the server package
   * knows nothing about either, so the application says what waiting means:
   *
   * ```ts
   * const html = await renderToStringAsync(() => <App />, {
   *   settle: () => data.settle(),
   * });
   * ```
   */
  settle?: () => Promise<void>;
  /**
   * How many times to render before giving up on stillness.
   *
   * Each pass renders, waits, and renders again if the wait produced more
   * work. Default 5, which is four chances for one load to reveal the next;
   * past that the last markup is sent as it stands rather than never.
   */
  passes?: number;
  /**
   * How long to wait, in ms, before rendering with what is there.
   *
   * A loader that never answers would otherwise hold the response open for as
   * long as the client is willing to wait, which is a page that never arrives
   * rather than one that arrives incomplete. Left out, the wait is however
   * long the application's own loaders take — which is the right default when
   * they have timeouts of their own, and the wrong one when they do not.
   */
  timeout?: number;
};

/**
 * Renders a view to markup.
 *
 * ```ts
 * const html = renderToString(() => <App />);
 * ```
 *
 * Everything the view creates belongs to a root that is disposed before this
 * returns, so a server that renders a thousand requests holds nothing from any
 * of them.
 */
export function renderToString(view: () => unknown, options: RenderOptions = {}): string {
  const owner = createOwner(null);
  try {
    return finish(pass(view, owner), options);
  } finally {
    disposeOwner(owner);
  }
}

/**
 * Renders a view that loads something first.
 *
 * ```ts
 * const html = await renderToStringAsync(() => <App />, {
 *   settle: () => data.settle(),
 * });
 * ```
 *
 * The view is rendered, the wait is awaited, and the view is rendered again —
 * over the same owner, so a component's setup runs once and its resources are
 * not started twice. What the second pass reads is what the first pass asked
 * for, now answered.
 *
 * Without `settle` this is `renderToString` with a promise around it, which is
 * what a view with nothing to wait for should cost.
 */
export async function renderToStringAsync(
  view: () => unknown,
  options: AsyncRenderOptions = {},
): Promise<string> {
  const owner = createOwner(null);
  try {
    let body = pass(view, owner);
    const settle = options.settle;
    if (settle !== undefined) {
      const passes = options.passes ?? 5;
      for (let i = 1; i < passes; i++) {
        const before = body;
        await waitFor(settle(), options.timeout);
        body = pass(view, owner);
        if (body === before) {
          break;
        }
      }
    }
    return finish(body, options);
  } finally {
    disposeOwner(owner);
  }
}

/**
 * `work`, or the clock, whichever comes first.
 *
 * The timer is cleared either way: a pending one would keep a server's event
 * loop alive past the response it belonged to.
 */
async function waitFor(work: Promise<void>, timeout: number | undefined): Promise<void> {
  if (timeout === undefined) {
    return work;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** One render, under `owner`, with effects off. */
function pass(view: () => unknown, owner: Owner): string {
  const previousOwner = setOwner(owner);
  const previousMode = setRendering(true);
  try {
    return child(untrack(view));
  } finally {
    setRendering(previousMode);
    setOwner(previousOwner);
  }
}

function finish(body: string, options: RenderOptions): string {
  return options.document === undefined ? body : options.document(body);
}
