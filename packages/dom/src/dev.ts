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
