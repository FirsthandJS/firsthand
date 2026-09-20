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
