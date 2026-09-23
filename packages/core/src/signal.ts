import { Cell, defaultEquals } from './cell.js';
import { devLabel } from './dev.js';
import type { CellOptions, Signal } from './types.js';

/**
 * Creates a mutable reactive cell.
 *
 * ```ts
 * const count = signal(0);
 * count.value++;          // dependents update synchronously (ADR-0006)
 * count.peek();           // read without subscribing
 * count.set(n => n + 1);  // functional update
 * ```
 *
 * A signal is an ordinary object with its own identity. It is not stored in a
 * slot table, so creating one inside a conditional is legal and its lifetime is
 * simply the lifetime of the reference to it.
 */
export function signal<T>(value: T, options?: CellOptions<T>): Signal<T> {
  const cell = new Cell(0, value, undefined, defaultEquals(options?.equals));
  devLabel(cell, 'signal', '');
  return cell as unknown as Signal<T>;
}
