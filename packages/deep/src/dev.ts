/**
 * Development-only diagnostics for deep state (ADR-0020).
 *
 * There is no `if (DEV)` guard at any call site: the production build aliases
 * this module to `dev.prod.ts`, whose functions have empty bodies. Nothing here
 * is exported from the package's entry, so the calls are removed rather than
 * merely emptied.
 */
import type { DevtoolsHook } from '@firsthandjs/core';

/**
 * The path each raw object sits at, relative to the root it was reached from.
 *
 * A version cell is created per object and property, and on its own that says
 * nothing: a hundred objects all have a `name`. The path is what turns it into
 * `user.address.city`, and it is only knowable at the moment a nested object is
 * reached through its parent — which is where `remember` is called from.
 */
const paths = new WeakMap<object, string>();

function hook(): DevtoolsHook | undefined {
  const installed = globalThis.__FIRSTHAND_DEVTOOLS__;
  return installed !== undefined && installed.attached ? installed : undefined;
}

/** Records where a nested object sits, on the way out of the parent's trap. */
export function devRemember(parent: object, key: PropertyKey, child: object): void {
  if (hook() === undefined || paths.has(child)) {
    return;
  }
  const prefix = paths.get(parent);
  paths.set(child, prefix === undefined ? String(key) : `${prefix}.${String(key)}`);
}

/** Names a version cell after the property it stands for. */
export function devLabelProperty(cell: object, target: object, key: PropertyKey): void {
  const prefix = paths.get(target);
  // The only symbol that reaches here is the package's own `KEYS` marker,
  // which stands for "which keys exist" — what `Object.keys`, `for…in` and
  // spreading subscribe to. A symbol *property* is never tracked, so nothing
  // else can arrive, and `keys` reads better than the marker's description.
  const name = typeof key === 'symbol' ? 'keys' : String(key);
  hook()?.label(cell, 'signal', prefix === undefined ? name : `${prefix}.${name}`);
}
