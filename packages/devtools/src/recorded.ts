/**
 * Everything devtools have written down, and nothing that writes it.
 *
 * One module holding the data so that the two halves above it — the hook that
 * records and the API that reads — can both reach it without reaching each
 * other. Kept as one object rather than eight exports because it is one thing:
 * what this session has observed.
 *
 * All of it is bounded or weak. A tool that made a page leak while you debugged
 * it would be worse than no tool.
 */

import type { CellLike, Label, OwnerLike, QueryEvent, Update } from './types.js';

/** `MUTABLE`, from the core's flags: distinguishes a computed from a signal. */
export const MUTABLE = 1 << 0;

/** Bounded: a long session would otherwise keep every fetch it ever made. */
export const LOG_LIMIT = 200;
/** Bounded, for the same reason the cache log is. */
export const UPDATE_LIMIT = 100;

export const recorded = {
  labels: new WeakMap<object, Label>(),
  /** Which node and property each effect writes, learned while it runs. */
  parts: new WeakMap<object, { node: object; property: string }>(),
  /** The effect a DOM node is written by, for looking a chain up from the page. */
  writers: new WeakMap<object, Set<object>>(),
  /** Why each effect last ran. */
  causes: new WeakMap<object, object>(),
  /** The component each scope belongs to, as the DOM layer reported it. */
  components: new WeakMap<object, string>(),
  /** What the resources have done, newest last. */
  cacheLog: [] as QueryEvent[],
  /**
   * Every update, newest last.
   *
   * The effects are kept beside the update rather than inside it: two parts
   * writing two paragraphs are both called `p.text`, so asking "which updates
   * ran *this* node" has to compare identities, not names.
   */
  updates: [] as { update: Update; effects: object[] }[],
  roots: new Set<WeakRef<OwnerLike>>(),
};

/** Forgets everything. The weak maps need no clearing: nothing holds them. */
export function forget(): void {
  recorded.updates.length = 0;
  recorded.cacheLog.length = 0;
  recorded.roots.clear();
}

/** Appends to a log that must not grow without bound. */
export function append<T>(log: T[], entry: T, limit: number): void {
  log.push(entry);
  if (log.length > limit) {
    log.shift();
  }
}

/** Every live root, with the dead references swept out on the way past. */
export function liveRoots(): OwnerLike[] {
  const live: OwnerLike[] = [];
  for (const ref of recorded.roots) {
    const owner = ref.deref();
    if (owner === undefined) {
      recorded.roots.delete(ref);
    } else {
      live.push(owner);
    }
  }
  return live;
}

export type { CellLike };
