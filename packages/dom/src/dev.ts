/**
 * Development-only diagnostics.
 *
 * There is deliberately no `if (DEV)` guard at any call site: the production
 * build aliases this module to `dev.prod.ts`, whose functions have empty bodies
 * and are removed by the minifier. That keeps the production bundle free of
 * diagnostics without creating branches that can never be taken in tests — see
 * ARCHITECTURE section 8, item 6.
 */

import type { DevtoolsHook } from '@firsthandjs/core';

export function devWarn(message: string): void {
  console.warn(`[firsthand] ${message}`);
}

const seen = new Set<string>();

/** Warns at most once for a given key, so a repeated mistake is not spam. */
export function devWarnOnce(key: string, message: string): void {
  if (!seen.has(key)) {
    seen.add(key);
    devWarn(message);
  }
}

/**
 * Warns when an object is about to be rendered as text.
 *
 * `<p>{count}</p>` — a signal without `.value` — is the mistake this exists
 * for: TypeScript rejects it, but plain JavaScript and the runtime JSX path do
 * not, and the result is a silent `[object Object]` in the page. The check
 * lives here rather than at the call site so that production pays nothing for
 * it: `dev.prod.ts` replaces this with an empty function.
 */
export function devWarnRenderedObject(value: object): void {
  const cellish =
    'peek' in value && typeof (value as { peek?: unknown }).peek === 'function' && 'value' in value;
  devWarnOnce(
    cellish ? 'rendered-cell' : 'rendered-object',
    cellish
      ? 'A signal or computed was rendered directly, so the page shows "[object Object]". ' +
          'Read it instead: {count.value} rather than {count}.'
      : `An object was rendered as text, so the page shows "${String(value)}". ` +
          'Render a string, a number or a node.',
  );
}

// ---------------------------------------------------------------------------
// Devtools (ADR-0020)
// ---------------------------------------------------------------------------

/**
 * The devtools hook, or `undefined` while nothing is listening.
 *
 * Deliberately a second, local reading of the same global rather than an
 * import from `@firsthandjs/core`: the packages do not gain a shared devtools
 * surface, and production ships neither side because both modules are replaced.
 */
function hook(): DevtoolsHook | undefined {
  const installed = globalThis.__FIRSTHAND_DEVTOOLS__;
  return installed !== undefined && installed.attached ? installed : undefined;
}

/**
 * Reports the node and property a part is writing.
 *
 * Called from inside the part's own effect, so devtools can attribute it to
 * whatever is running and turn an anonymous effect into `button.disabled`.
 */
export function devPart(node: object, property: string): void {
  hook()?.part(node, property);
}

/** Names the scope a component instance runs in. */
export function devComponent(owner: object, name: string): void {
  hook()?.component(owner, name);
}

/**
 * Names a cell, from a label the compiler wrote.
 *
 * The value is returned so the call can wrap the expression it names, which
 * keeps `signal` unchanged and leaves a cell created any other way simply
 * unnamed. In a production build this is an empty function and the compiler
 * emits no call to it at all.
 */
export function label<T>(value: T, kind: string, name: string): T {
  if (typeof value === 'object' && value !== null) {
    hook()?.label(value, kind, name);
  }
  return value;
}

/** How many runs in a row may change nothing before it is worth saying so. */
const QUIET = 20;

/**
 * Reports a render function that keeps running and keeps changing nothing.
 *
 * Nothing is optimised here and nothing is hidden: this is bookkeeping, said
 * out loud. A run that produces exactly what is already on screen did work for
 * no one, and the reason is always the same — it reads something in a
 * statement that moves more often than what it shows.
 */
export function devRan(store: { name: string; busy?: boolean; quiet?: number }): void {
  if (store.busy === true) {
    store.busy = false;
    store.quiet = 0;
    return;
  }
  const quiet = (store.quiet ?? 0) + 1;
  store.quiet = quiet;
  if (quiet !== QUIET) {
    return;
  }
  devWarnOnce(
    `quiet-run:${store.name}`,
    `<${store.name}> ran ${String(QUIET)} times and wrote nothing.\n` +
      'Something it reads in a statement changes more often than what it shows. ' +
      'Move that read into the markup, where it is a part of its own, or move ' +
      'the derivation into a computed in the setup.',
  );
}

/**
 * Reports a child that is handed a new function on every run.
 *
 * A function made in a run is never equal to the one before it, so the child
 * it is given to runs again every time its parent does — the `useCallback`
 * problem, named rather than papered over.
 */
export function devHandedNewFunction(store: { name: string }, value: unknown): void {
  if (typeof value !== 'function') {
    return;
  }
  devWarnOnce(
    `new-function:${store.name}`,
    `<${store.name}> hands a child a new function on every run, so that child ` +
      'runs again whenever this one does.\n' +
      'If the handler does not depend on the run, define it in the setup.',
  );
}

/**
 * Reports markup a server sent that is not the markup this run describes.
 *
 * Only the element's own attributes are compared, and only in development:
 * what is inside it may already have been hydrated, and parsing the template
 * to compare more is the cost hydration exists to avoid. That is enough to
 * name the mistake, which is always the same mistake — a view that renders
 * one thing on a server and another in a browser, from props or state that
 * differ between them.
 */
export function devHydrationMismatch(node: Element, html: string): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  const expected = template.content.firstElementChild;
  if (expected === null) {
    return;
  }
  for (const attribute of expected.attributes) {
    const found = node.getAttribute(attribute.name);
    if (found !== attribute.value) {
      devWarn(
        `Hydration found <${node.tagName.toLowerCase()} ${attribute.name}=` +
          `"${found ?? ''}"> where this render describes "${attribute.value}". ` +
          'The markup is kept as the server sent it, because static markup is ' +
          'never written again. Render the same thing on both sides, or render ' +
          'this part in the browser only.',
      );
      return;
    }
  }
}
