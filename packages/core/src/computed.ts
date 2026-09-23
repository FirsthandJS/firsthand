import { Cell, defaultEquals } from './cell.js';
import { own } from './core.js';
import { DIRTY, MUTABLE } from './flags.js';
import type { CellOptions, ReadonlyCell } from './types.js';
import { devLabel } from './dev.js';

/**
 * Creates a lazy, memoised derived value.
 *
 * The body runs on the first read, and again only when a dependency it actually
 * read has changed. If the recomputed value is equal to the previous one,
 * nothing downstream is notified.
 *
 * The computed is registered with the enclosing scope, so disposing that scope
 * unsubscribes it from every source — including sources that outlive it.
 */
export function computed<T>(fn: () => T, options?: CellOptions<T>): ReadonlyCell<T> {
  const cell = new Cell(MUTABLE | DIRTY, undefined, fn, defaultEquals(options?.equals));
  own(cell);
  devLabel(cell, 'computed', fn.name);
  return cell as unknown as ReadonlyCell<T>;
}
