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
