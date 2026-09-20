/**
 * Development-only diagnostics.
 *
 * There is deliberately no `if (DEV)` guard at any call site: the production
 * build aliases this module to `dev.prod.ts`, whose functions have empty bodies
 * and are removed by the minifier. That keeps the production bundle free of
 * diagnostics without creating branches that can never be taken in tests — see
 * ARCHITECTURE section 8, item 6.
 */

import type { DevtoolsHook } from './types.js';

export function devWarn(message: string): void {
  console.warn(`[firsthand] ${message}`);
}

/** Reports an error that no boundary handled, so it reaches `window.onerror`. */
export function reportUncaught(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

// ---------------------------------------------------------------------------
// Strict reactivity (ADR-0019)
// ---------------------------------------------------------------------------

/**
 * Off by default, because the honest cases are common.
 *
 * `signal(props.initial)` for a starting value, or `if (props.mode === …)` to
 * decide what to build, are both reads that happen once on purpose. Warning
 * about them unasked would teach people to ignore the warning, so this is
 * opt-in — the compiler plugin turns it on when `strictReactivity` is set, and
 * an application can call it directly.
 */
let strict = false;
/** One frame per setup currently running: a child may be created inside a parent's. */
const setups: { id: string; reads: number }[] = [];
let snapshotDepth = 0;
const reported = new Set<string>();

export function setStrictReactivity(on: boolean): void {
  strict = on;
}

export function devEnterSetup(id: string): void {
  setups.push({ id, reads: 0 });
}

export function devExitSetup(): void {
  setups.pop();
}

export function devEnterSnapshot(): void {
  snapshotDepth++;
}

export function devExitSnapshot(): void {
  snapshotDepth--;
}

/**
 * Warns about a read whose value is taken once and then kept.
 *
 * Called from the read path only where nothing is subscribing. Inside a
 * component setup that means the value is being copied out of the graph: the
 * number is right now and will not move again, and nothing throws to say so.
 *
 * Reported once per read, not once per instance: a list of a thousand rows
 * would otherwise print the same line a thousand times.
 */
export function devCheckSetupRead(): void {
  const frame = setups[setups.length - 1];
  if (!strict || frame === undefined || snapshotDepth > 0) {
    return;
  }
  // The component's build id plus the position of this read within its setup.
  // A thousand instances of one component run the same reads in the same
  // order, so they share a key and report once — which a stack trace would not
  // do, because each `<Label />` in a template is a different call site.
  const site = `${frame.id}#${String(frame.reads++)}`;
  if (reported.has(site)) {
    return;
  }
  reported.add(site);
  devWarn(
    'A signal or prop was read in a component setup without anything subscribing, ' +
      'so the value is read once and then kept. Move the read into the part, ' +
      'handler, effect or computed that should re-read it — or wrap it in ' +
      'snapshot() if reading once is what you meant.',
  );
}

// ---------------------------------------------------------------------------
// Devtools (ADR-0020)
// ---------------------------------------------------------------------------

/**
 * The hook, or `undefined` while nothing is listening.
 *
 * Read through a function rather than captured once, because the frontend may
 * attach after the module is evaluated — an application that imports devtools
 * lazily, or a test that attaches per case.
 */
function hook(): DevtoolsHook | undefined {
  const installed = globalThis.__FIRSTHAND_DEVTOOLS__;
  return installed !== undefined && installed.attached ? installed : undefined;
}

/**
 * Names a cell, if anyone is listening.
 *
 * Nothing is recorded until a frontend attaches: naming every cell costs a
 * `WeakMap` write, and a hundred thousand rows would feel that even in
 * development — which is precisely the size at which devtools matter, so the
 * cost has to be opt-in rather than merely small.
 */
export function devLabel(target: object, kind: string, name: string): void {
  hook()?.label(target, kind, name);
}

/** Reports the source that just changed, so a run can be explained by it. */
export function devCause(dep: object): void {
  hook()?.cause(dep);
}

/** Registers a scope the frontend can enumerate the graph from. */
export function devRoot(owner: object): void {
  hook()?.root(owner);
}

/** Reports the effect that is running, so a write can be attributed to it. */
export function devRunning(effect: object | null): void {
  hook()?.running(effect);
}
