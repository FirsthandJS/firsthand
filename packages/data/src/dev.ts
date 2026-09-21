/**
 * Development-only diagnostics for resources (ADR-0020).
 *
 * There is no `if (DEV)` guard at any call site: the production build aliases
 * this module to `dev.prod.ts`, whose functions have empty bodies. Nothing here
 * is exported from the package's entry, so the calls are removed rather than
 * merely emptied.
 */
import type { DevtoolsHook } from '@firsthandjs/core';
import type { Tag } from './tags.js';

function hook(): DevtoolsHook | undefined {
  const installed = globalThis.__FIRSTHAND_DEVTOOLS__;
  return installed !== undefined && installed.attached ? installed : undefined;
}

/**
 * Reports what the cache just did.
 *
 * The cache is the one part of the framework whose behaviour is not visible in
 * the reactive graph: a tag match is a decision, not an edge, and an
 * invalidation that hits nothing looks exactly like one that was never sent.
 */
export function devQuery(event: string, key: string, tags: readonly Tag[]): void {
  hook()?.query(event, key, tags.map(readable));
}

/**
 * A tag as a person would write it: `user(id: 7)`.
 *
 * For a person, not for a machine: nothing in this package derives an
 * identity from a tag any more, so there is no other form to confuse it with.
 */
function readable(value: Tag): string {
  const names = Object.keys(value.vars).sort();
  if (names.length === 0) {
    return value.name;
  }
  const vars = names.map((name) => `${name}: ${String(value.vars[name])}`).join(', ');
  return `${value.name}(${vars})`;
}
