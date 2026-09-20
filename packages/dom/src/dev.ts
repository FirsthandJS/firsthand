/**
 * Development-only diagnostics.
 *
 * There is deliberately no `if (DEV)` guard at any call site: the production
 * build aliases this module to `dev.prod.ts`, whose functions have empty bodies
 * and are removed by the minifier. That keeps the production bundle free of
 * diagnostics without creating branches that can never be taken in tests — see
 * ARCHITECTURE section 8, item 6.
 */

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
