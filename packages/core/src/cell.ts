/**
 * One node of the reactive graph, and the equality it compares with.
 *
 * Signals, computeds and effects are all this class, so that every property
 * access in the graph code sees one hidden class — which `npm run bench:ic`
 * measures rather than assumes.
 *
 * It reads `activeSub` and calls into `core.ts`; it never writes the graph's
 * state, which is what lets it sit beside the algorithm rather than inside it.
 */

import { activeSub, link, refresh, write } from './core.js';
import { devCheckSetupRead } from './dev.js';
import { FirsthandReadonlyError } from './errors.js';
import { MUTABLE, STALE } from './flags.js';
import type { Link } from './link.js';
import type { Owner } from './core.js';

/** Default equality. `Object.is` so that `NaN` settles and `-0`/`+0` differ. */
const is = Object.is;
/** Equality for `{ equals: false }`: every write propagates. */
const never = (): boolean => false;

/**
 * One node of the reactive graph. Signals, computeds and effects all use this
 * class so that every property access in the graph code sees one hidden class.
 */
export class Cell {
  declare flags: number;
  /** Signal value, or the memoised result of `fn`. */
  declare v: unknown;
  /** Computed body, or effect body. `undefined` for signals. */
  declare fn: (() => unknown) | undefined;
  declare equals: (a: unknown, b: unknown) => boolean;
  declare deps: Link | undefined;
  declare depsTail: Link | undefined;
  declare subs: Link | undefined;
  declare subsTail: Link | undefined;
  /** An effect's own scope: re-created on every run. `undefined` otherwise. */
  declare scope: Owner | undefined;

  constructor(
    flags: number,
    value: unknown,
    fn: (() => unknown) | undefined,
    equals: (a: unknown, b: unknown) => boolean,
  ) {
    this.flags = flags;
    this.v = value;
    this.fn = fn;
    this.equals = equals;
    this.deps = undefined;
    this.depsTail = undefined;
    this.subs = undefined;
    this.subsTail = undefined;
    this.scope = undefined;
  }

  get value(): unknown {
    const flags = this.flags;
    if ((flags & MUTABLE) !== 0 && (flags & STALE) !== 0) {
      refresh(this);
    }
    if (activeSub !== undefined) {
      link(this, activeSub);
    } else {
      // Nothing is subscribing. Ordinary outside a component — an event
      // handler reading current state — and the whole of the single-run
      // mistake inside one, which is what strict reactivity reports. Empty in
      // a production build, so the hot path keeps its single branch.
      devCheckSetupRead();
    }
    return this.v;
  }

  set value(next: unknown) {
    if ((this.flags & MUTABLE) !== 0) {
      throw new FirsthandReadonlyError();
    }
    write(this, next);
  }

  /** Reads without subscribing, and without refreshing lazily... except that a
   *  stale computed must still produce a correct value, so it does refresh. */
  peek(): unknown {
    const flags = this.flags;
    if ((flags & MUTABLE) !== 0 && (flags & STALE) !== 0) {
      refresh(this);
    }
    return this.v;
  }

  /** Functional update. The updater runs untracked. */
  set(updater: (previous: never) => unknown): void {
    if ((this.flags & MUTABLE) !== 0) {
      throw new FirsthandReadonlyError();
    }
    write(this, updater(this.v as never));
  }
}

export function defaultEquals<T>(
  equals: ((a: T, b: T) => boolean) | false | undefined,
): (a: unknown, b: unknown) => boolean {
  if (equals === undefined) {
    return is;
  }
  if (equals === false) {
    return never;
  }
  return equals as (a: unknown, b: unknown) => boolean;
}
